(() => {
  if (globalThis.followerPrunerLoaded) return;
  globalThis.followerPrunerLoaded = true;
  const { readText, parseCount, reasons, settings, keywords, bioKeywords } = FollowerPrunerCore;
  const counterNames = ['processed', 'matched', 'removed', 'kept', 'skipped'];
  const ruleSignature = JSON.stringify({ keywords, bioKeywords, keywordFields: ['name', 'handle', 'bio'] });
  const primary = () => document.querySelector('[data-testid="primaryColumn"]');
  const path = () => location.pathname.replace(/\/$/, '').toLowerCase();
  const linkPath = link => new URL(link.href, location.href).pathname.replace(/\/$/, '').toLowerCase();
  const links = root => Array.from(root?.querySelectorAll('a[href]') || []);
  const visible = element => element?.isConnected && element.getClientRects().length > 0;
  const owner = () => {
    const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    return link && linkPath(link).slice(1);
  };
  const idle = () => ({ running: false, testMode: true, message: 'Ready.', processed: 0, matched: 0, removed: 0, kept: 0, skipped: 0 });
  let state = idle();
  let controller;
  let config;
  let listPath;
  let account;
  let expectedPath;
  let completed;
  let checkpointKey;
  class UnconfirmedRemoval extends Error {}

  async function saveProgress() {
    const counters = Object.fromEntries(counterNames.map(key => [key, state[key]]));
    try {
      await chrome.storage.local.set({ [checkpointKey]: { rules: ruleSignature, handles: [...completed], counters } });
    } catch (error) {
      throw new Error(`Could not save progress. Stopped: ${error.message}`);
    }
  }

  async function loadProgress(resume) {
    // Bump the schema if non-keyword rules change. Each account/mode is independent.
    checkpointKey = `follower-pruner:progress:2:${account}:${state.testMode ? 'test' : 'live'}`;
    const saved = resume ? (await chrome.storage.local.get(checkpointKey))[checkpointKey] : null;
    check();
    completed = new Set();
    if (saved?.rules === ruleSignature && Array.isArray(saved.handles)
      && saved.handles.every(handle => /^[a-z0-9_]{1,15}$/.test(handle))
      && counterNames.every(key => Number.isSafeInteger(saved.counters?.[key]) && saved.counters[key] >= 0)
      && saved.counters.processed === new Set(saved.handles).size) {
      completed = new Set(saved.handles);
      for (const key of counterNames) state[key] = saved.counters[key];
    }
    await saveProgress();
    check();
    state.message = state.testMode ? 'Running in test mode.' : 'Removing matching followers.';
    if (completed.size) console.info('[Follower Pruner] Resuming', JSON.stringify({ account, testMode: state.testMode, processed: state.processed }));
  }

  function check() {
    controller.signal.throwIfAborted();
    if (path() !== expectedPath || owner() !== account) {
      throw new Error('Page or signed-in account changed. Stopped.');
    }
  }

  async function wait(ms) {
    controller.signal.throwIfAborted();
    await new Promise((resolve, reject) => {
      const signal = controller.signal;
      const cancel = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
      signal.addEventListener('abort', cancel, { once: true });
    });
    check();
  }

  function click(element) {
    check();
    if (!visible(element) || element.matches(':disabled, [aria-disabled="true"]')) {
      throw new Error('Expected control is missing or disabled. Stopped.');
    }
    element.click();
  }

  function rows() {
    // Scope to the timeline, excluding sidebar suggestions and nested recommendations.
    const timeline = primary()?.querySelector('[aria-label="Timeline: Followers"]');
    return Array.from(timeline?.querySelectorAll('[data-testid="UserCell"]') || [])
      .filter(visible).map(element => {
        const accountLinks = links(element).filter(link => /^\/[a-z0-9_]{1,15}$/i.test(linkPath(link)));
        // The name link triggers the card; the first link is usually a hidden avatar.
        const link = accountLinks.find(link => link.getAttribute('aria-hidden') !== 'true' && readText(link).trim()) || accountLinks[0];
        return link ? { element, link, handle: linkPath(link).slice(1) } : null;
      }).filter(Boolean);
  }

  function displayName(root, handle, full = false) {
    if (full) {
      const name = root?.querySelector('[data-testid="UserName"]');
      // Check the handle element itself: textContent joins "@handleFollows you".
      const hasHandle = Array.from(name?.querySelectorAll('[dir]') || [])
        .some(element => readText(element).trim().toLowerCase() === `@${handle}`);
      if (!hasHandle) return null;
      const text = readText(name.querySelector('[dir="auto"], [dir="ltr"]')).trim();
      return text && !text.startsWith('@') ? text : null;
    }
    for (const link of links(root).filter(link => linkPath(link) === `/${handle}`)) {
      const text = readText(link.querySelector('[dir="auto"], [dir="ltr"]')).trim();
      if (text && !text.startsWith('@')) return text;
    }
    return null;
  }

  function bioText(root, full = false) {
    const description = root?.querySelector('[data-testid="UserDescription"]');
    if (description) return readText(description).trim();
    if (full) return null;
    // X's rows and hover cards have no UserDescription marker. Ignore hidden
    // follow-button labels and text inside name/stat/mutual-follower links.
    const candidates = Array.from(root?.querySelectorAll('div[dir="auto"]') || []).filter(element => {
      const control = element.closest('a, button, [role="button"]');
      return visible(element) && (!control || control === root);
    });
    return candidates.length === 1 ? readText(candidates[0]).trim() || null : null;
  }

  function profileData(root, handle, full = false) {
    const followerLink = links(root).find(link => [`/${handle}/followers`, `/${handle}/verified_followers`].includes(linkPath(link)) && !link.closest('article'));
    const followingLink = links(root).find(link => linkPath(link) === `/${handle}/following` && !link.closest('article'));
    // Both links identify the intended, loaded profile. A stale hover card is ignored.
    if (!followerLink || !followingLink) return null;
    const followers = parseCount(readText(followerLink));
    const name = displayName(root, handle, full);
    const text = bioText(root, full);
    // Missing bio on a hover card is unknown; verify on the full profile instead.
    const bio = text ?? (full && name !== null && followers !== null ? '' : null);
    return { name, handle, bio, followers };
  }

  async function hoverData(row) {
    check();
    const rect = row.link.getBoundingClientRect();
    const event = { bubbles: true, view: window, clientX: rect.x + 5, clientY: rect.y + 5 };
    row.link.dispatchEvent(new MouseEvent('mouseover', event));
    row.link.dispatchEvent(new MouseEvent('mouseenter', event));
    try {
      let latest = null;
      for (let attempt = 0; attempt < config.maxHoverAttempts; attempt++) {
        await wait(config.hoverDelay);
        for (const card of document.querySelectorAll('[data-testid="HoverCard"], [data-testid="profile-hover-card"], [role="tooltip"]')) {
          if (!visible(card)) continue;
          const data = profileData(card, row.handle);
          if (!data) continue;
          latest = data;
          if (reasons(data).length || Object.values(data).every(value => value !== null)) return data;
        }
      }
      return latest;
    } finally {
      row.link.dispatchEvent(new MouseEvent('mouseout', { ...event, relatedTarget: document.body }));
      row.link.dispatchEvent(new MouseEvent('mouseleave', event));
    }
  }

  async function visit(row) {
    click(row.link);
    expectedPath = `/${row.handle}`;
    await wait(config.profileLoadDelay);
    for (let attempt = 0; attempt < config.maxFollowerAttempts; attempt++) {
      const data = profileData(primary(), row.handle, true);
      if (data?.name != null && (data.followers !== null || reasons(data).length)) return data;
      await wait(config.profileLoadDelay);
    }
    return null;
  }

  async function returnToList(scrollY) {
    check();
    history.back();
    expectedPath = listPath;
    await wait(config.profileLoadDelay);
    for (let attempt = 1; attempt < config.maxFollowerAttempts
      && !primary()?.querySelector('[aria-label="Timeline: Followers"]'); attempt++) {
      await wait(config.profileLoadDelay);
    }
    if (!primary()?.querySelector('[aria-label="Timeline: Followers"]')) {
      throw new Error('Followers list did not load after returning. Stopped; progress saved.');
    }
    window.scrollTo(0, scrollY);
    await wait(config.scrollDelay);
  }

  async function record(handle, outcome, why, data) {
    const result = { handle, outcome, reasons: why, ...data };
    state.processed++;
    if (outcome === 'would remove' || outcome === 'removed') state.matched++;
    if (outcome === 'removed') state.removed++;
    if (outcome === 'kept') state.kept++;
    if (outcome === 'skipped') state.skipped++;
    completed.add(handle);
    if (outcome === 'would remove' || outcome === 'removed') {
      const label = outcome === 'would remove' ? '🚩 WOULD REMOVE (TEST)' : '✓ REMOVED';
      console.warn(`%c[Follower Pruner] ${label} @${handle}%c — ${why.join('; ')}`,
        'font-weight: bold; color: #fff; background: #a40000; padding: 2px 4px;', '', JSON.stringify(result));
    } else {
      console.info('[Follower Pruner]', JSON.stringify(result));
    }
    // Persist before cleanup or waiting, including a verified removal before Stop.
    await saveProgress();
  }

  function watchRemovalNotices(identity) {
    const selector = '[data-testid="toast"], [role="alert"]';
    const seen = new WeakMap(Array.from(document.querySelectorAll(selector), node => [node, readText(node).trim()]));
    const notices = { success: false, failure: '' };
    const observer = new MutationObserver(() => {
      for (const node of document.querySelectorAll(selector)) {
        const text = readText(node).trim();
        if (!visible(node) || !text || seen.get(node) === text) continue;
        seen.set(node, text);
        // X also says "@handle is no longer following you". Capture the notice
        // when it appears, even if it disappears before the action delay ends.
        if (identity.test(text) && /removed.*followers|follower.*removed|is no longer following you/i.test(text)) notices.success = true;
        else if (/rate limit|too many requests|try again later|something went wrong|could not|unable to|failed/i.test(text)) notices.failure = text;
      }
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    return { notices, disconnect: () => observer.disconnect() };
  }

  async function remove(handle) {
    // This guard is independent of the caller, so test runs never open removal UI.
    if (state.testMode) throw new Error('Removal is disabled in test mode.');
    check();
    if (path() !== `/${handle}` || !displayName(primary(), handle, true)) {
      throw new Error('Cannot verify profile identity before removal.');
    }
    if (document.querySelector('[role="menu"], [role="alertdialog"], [data-testid="confirmationSheetDialog"]')) {
      throw new Error('Close the open menu/dialog and start again.');
    }
    click(primary()?.querySelector('[data-testid="userActions"]'));
    await wait(config.actionDelay);
    const menu = document.querySelector('[role="menu"]');
    const removeItem = Array.from(menu?.querySelectorAll('[role="menuitem"]') || [])
      .find(item => readText(item).trim() === 'Remove this follower');
    if (!removeItem) throw new Error(`Remove this follower is unavailable for @${handle}. Stopped.`);
    click(removeItem);
    await wait(config.actionDelay);
    const dialog = document.querySelector('[data-testid="confirmationSheetDialog"], [role="alertdialog"]');
    const confirm = dialog?.querySelector('[data-testid="confirmationSheetConfirm"]');
    const identity = new RegExp(`@${handle}(?![a-z0-9_])`, 'i');
    if (!identity.test(readText(dialog)) || readText(confirm).trim() !== 'Remove') {
      throw new Error(`Cannot verify removal confirmation for @${handle}. Stopped.`);
    }
    const { notices, disconnect } = watchRemovalNotices(identity);
    let verificationMenu;
    let followerStillListed = false;
    let detail = 'X has not updated the follower relationship.';
    try {
      click(confirm); // Submit once. Subsequent attempts only recheck the result.
      for (let attempt = 0; attempt < config.maxFollowerAttempts; attempt++) {
        await wait(config.actionDelay * (attempt + 1));
        if (!visible(dialog) && notices.success) return verificationMenu;
        if (notices.failure) break;
        if (visible(dialog)) {
          detail = 'The removal confirmation is still open.';
          continue;
        }
        if (visible(verificationMenu)) {
          const closed = await dismissMenu(verificationMenu);
          if (notices.success) return closed ? undefined : verificationMenu;
          if (!closed) {
            detail = 'The verification menu could not be dismissed.';
            break;
          }
        }
        if (notices.failure) break;
        // Reopen the menu: an already-open menu can retain a stale relationship.
        click(primary()?.querySelector('[data-testid="userActions"]'));
        await wait(config.actionDelay);
        verificationMenu = document.querySelector('[role="menu"]');
        if (notices.success) return verificationMenu;
        if (notices.failure) break;
        const items = Array.from(verificationMenu?.querySelectorAll('[role="menuitem"]') || []);
        const stillRemovable = items.some(item => readText(item).trim() === 'Remove this follower');
        const sameAccount = items.some(item => identity.test(readText(item)));
        if (sameAccount && !stillRemovable) return verificationMenu;
        followerStillListed = sameAccount && stillRemovable;
        detail = sameAccount ? 'X still offers “Remove this follower”.' : 'The verification menu has not loaded for this account.';
        console.warn(`[Follower Pruner] Verification ${attempt + 1}/${config.maxFollowerAttempts} for @${handle}: ${detail}`);
      }
      if (visible(verificationMenu)) await dismissMenu(verificationMenu);
      if (!visible(dialog) && notices.success) return visible(verificationMenu) ? verificationMenu : undefined;
      if (followerStillListed && !notices.failure && !visible(dialog)) {
        throw new UnconfirmedRemoval(`Could not verify removal of @${handle}. ${detail}`);
      }
      throw new Error(`Could not verify removal of @${handle}. ${notices.failure || detail} Stopped; progress saved, this account remains unfinished.`);
    } finally {
      disconnect();
    }
  }

  async function dismissMenu(menu) {
    check();
    // X listens for Escape on keyup. Send the complete press/release sequence.
    for (const type of ['keydown', 'keyup']) {
      if (!visible(menu)) return true;
      menu.dispatchEvent(new KeyboardEvent(type, {
        key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true,
      }));
    }
    await wait(config.actionDelay);
    return !visible(menu);
  }

  async function closeVerificationMenu(menu, handle) {
    if (!await dismissMenu(menu)) throw new Error(`Removed @${handle}, but the verification menu did not close. Stopped; removal counted.`);
  }

  async function process(row) {
    const rect = row.element.getBoundingClientRect();
    // Keep visible rows still, allowing space for X's sticky header.
    if (rect.top < 110) window.scrollBy(0, rect.top - 110);
    else if (rect.bottom > window.innerHeight - 20) window.scrollBy(0, rect.bottom - window.innerHeight + 20);
    await wait(config.scrollDelay);
    const scrollY = window.scrollY;
    // Visible row text can establish a match immediately, even if truncated.
    let data = { name: displayName(row.element, row.handle), handle: row.handle, bio: bioText(row.element), followers: null };
    let why = reasons(data);
    if (!why.length) {
      const card = await hoverData(row);
      if (card) data = { ...card, name: card.name ?? data.name };
      why = reasons(data);
    }
    // Incomplete cards cannot establish "no bio" or that an account should be kept.
    if ((!why.length && Object.values(data).some(value => value === null)) || (why.length && !state.testMode)) {
      const profile = await visit(row);
      if (profile) {
        data = profile;
        why = reasons(data);
      } else {
        await record(row.handle, 'skipped', ['profile data unavailable'], data);
        await returnToList(scrollY);
        return;
      }
    }
    if (why.length) {
      if (state.testMode) await record(row.handle, 'would remove', why, data);
      else {
        let verificationMenu;
        try {
          verificationMenu = await remove(row.handle);
        } catch (error) {
          if (!(error instanceof UnconfirmedRemoval)) throw error;
          check();
          console.warn(`[Follower Pruner] ⏭ UNCONFIRMED @${row.handle} — ${error.message} Returning to the followers list; retry on a later run.`);
          await returnToList(scrollY);
          await wait(config.actionDelay);
          return false;
        }
        // Commit the verified result before any fallible or abortable cleanup.
        await record(row.handle, 'removed', why, data);
        if (verificationMenu) await closeVerificationMenu(verificationMenu, row.handle);
      }
    } else {
      await record(row.handle, 'kept', ['no rules matched'], data);
    }
    if (path() !== listPath) await returnToList(scrollY);
    await wait(config.actionDelay);
  }

  async function run(resume) {
    const encountered = new Set();
    const deferred = new Set();
    let emptyScrolls = 0;
    try {
      await loadProgress(resume);
      if (!completed.size) window.scrollTo(0, 0);
      await wait(config.scrollDelay);
      while (emptyScrolls < config.maxScrollAttempts) {
        let next;
        for (let attempt = 0; attempt < config.maxFollowerAttempts; attempt++) {
          check();
          const current = rows();
          // Passing already-completed rows is still progress through a reloaded list.
          // Do not stop after maxScrollAttempts just because those rows are saved.
          if (current.some(row => !encountered.has(row.handle))) emptyScrolls = 0;
          current.forEach(row => encountered.add(row.handle));
          next = current.find(row => !completed.has(row.handle) && !deferred.has(row.handle) && row.handle !== account);
          if (next) break;
          await wait(config.scrollDelay);
        }
        if (next) {
          emptyScrolls = 0;
          // Only skip an unconfirmed account for this run; never persist it as done.
          if (await process(next) === false) deferred.add(next.handle);
        } else {
          const previousY = window.scrollY;
          window.scrollBy(0, Math.max(300, window.innerHeight * 0.75));
          await wait(config.scrollDelay);
          emptyScrolls = window.scrollY > previousY ? 0 : emptyScrolls + 1;
        }
      }
      state.message = `Finished: no new accounts after ${config.maxScrollAttempts} scroll attempts.`;
      if (deferred.size) state.message += ` ${deferred.size} unconfirmed removal(s) left for a later run.`;
    } catch (error) {
      state.message = controller.signal.aborted ? 'Stopped.' : error.message;
      if (!controller.signal.aborted) console.error('[Follower Pruner]', error);
    } finally {
      state.running = false;
      console.info('[Follower Pruner] Run ended', JSON.stringify(state));
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message.app !== 'follower-pruner') return;
    try {
      if (message.action === 'start') {
        if (state.running) throw new Error('Already running in this tab.');
        const match = path().match(/^\/([a-z0-9_]{1,15})\/followers$/);
        account = owner();
        if (!match || !account || account !== match[1]) throw new Error('Open your own Followers list first (x.com/your_handle/followers).');
        if (!primary()?.querySelector('[aria-label="Timeline: Followers"]')) throw new Error('Followers list is not loaded. Wait for it to appear and try again.');
        if (document.documentElement.lang && !document.documentElement.lang.startsWith('en')) throw new Error('Set X’s display language to English before running.');
        config = settings(message.settings);
        listPath = path();
        expectedPath = listPath;
        controller = new AbortController();
        state = { ...idle(), running: true, testMode: message.testMode !== false };
        state.message = 'Loading saved progress…';
        void run(message.resume !== false);
      } else if (message.action === 'stop' && state.running) {
        controller.abort();
        state.message = 'Stopping…';
      }
      reply(state);
    } catch (error) {
      reply({ error: error.message });
    }
  });
})();

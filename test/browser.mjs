import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Optional development check; the extension and its normal tests have no dependencies.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true });
const source = await readFile(new URL('../content.js', import.meta.url), 'utf8');
const core = await readFile(new URL('../core.js', import.meta.url), 'utf8');
const fast = { scrollDelay: 10, actionDelay: 10, hoverDelay: 10, profileLoadDelay: 20,
  maxFollowerAttempts: 2, maxHoverAttempts: 2, maxScrollAttempts: 2 };

async function fixture(accounts, options = {}, storage = {}) {
  const page = await browser.newPage();
  // Model extension-local storage separately from the page so refreshes retain it.
  await page.exposeFunction('readProgress', key => ({ [key]: structuredClone(storage[key]) }));
  await page.exposeFunction('writeProgress', value => {
    if (options.failStorage) throw new Error('Storage unavailable');
    Object.assign(storage, structuredClone(value));
  });
  // All requests are intercepted. No traffic or actions reach X.
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<html lang="en"><body></body></html>' }));
  await page.goto(`https://x.com/${options.owner || 'owner'}/followers`);
  await installFixture(page, accounts, options);
  return page;
}

async function installFixture(page, accounts, options = {}) {
  await page.evaluate(({ accounts, options }) => {
    window.fixture = { accounts, options, removed: [], menuClicks: 0, verificationMenus: 0, confirmClicks: 0, profileVisits: [], hovered: [], rendered: 1 };
    window.chrome = {
      runtime: { onMessage: { addListener: listener => { window.listener = listener; } } },
      storage: { local: { get: key => readProgress(key), set: async value => {
        await writeProgress(value);
        const checkpoint = Object.values(value)[0];
        if (options.stopAfterProcessed && checkpoint.counters.processed === options.stopAfterProcessed) {
          options.stopAfterProcessed = 0;
          send({ action: 'stop' });
        }
      } } },
    };
    window.send = message => {
      let response;
      window.listener({ app: 'follower-pruner', ...message }, {}, value => { response = structuredClone(value); });
      return response;
    };
    const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
    const name = account => account.emoji ? `${escape(account.name)} <img alt="♦️">` : escape(account.name);
    const nameLink = account => `<a href="/${account.handle}"><span dir="ltr"><span>${name(account)}</span></span></a>`;
    const counts = account => `<a href="/${account.handle}/following"><span>50</span><span> Following</span></a><a href="/${account.handle}/verified_followers"><span>${account.followers ?? '—'}</span><span>Followers</span></a>`;
    const description = account => account.bio ? `<div data-testid="UserDescription">${escape(account.bio)}</div>` : '';
    // The real list/cards use an unlabelled div; UserDescription exists only on profiles.
    const compactBio = account => `<div dir="auto" style="display:none">Click to Follow ${account.handle}</div>${account.bio ? `<div><div dir="auto">${escape(account.bio)}</div></div>` : ''}`;
    const render = () => {
      const current = location.pathname;
      const owner = options.owner || 'owner';
      document.body.innerHTML = `<nav><a data-testid="AppTabBar_Profile_Link" href="/${owner}">Profile</a></nav><main data-testid="primaryColumn"></main><aside data-testid="sidebarColumn"></aside>`;
      const main = document.querySelector('main');
      document.querySelector('aside').innerHTML = '<div data-testid="UserCell"><a href="/suggestion"><span dir="auto">crypto suggestion</span></a></div>';
      if (current === `/${owner}/followers`) {
        let list = accounts.filter(account => !fixture.removed.includes(account.handle));
        if (options.virtualized) list = list.slice(fixture.rendered - 1, fixture.rendered);
        main.innerHTML = '<section aria-label="Timeline: Followers">' + list.map(account => `<button data-testid="UserCell" style="display:block;height:80px"><a href="/${account.handle}" aria-hidden="true"><img alt=""></a>${nameLink(account)}<a href="/${account.handle}">@${account.handle}</a>${account.omitRowBio ? '' : compactBio(account)}</button>`).join('') + '</section>';
        if (options.virtualized) {
          window.scrollBy = (_x, y) => { if (y > 0) { fixture.rendered++; render(); } };
        }
      } else {
        const account = accounts.find(account => current === `/${account.handle}`);
        if (!account) return;
        fixture.profileVisits.push(account.handle);
        const shown = account.wrongProfile ? { ...account, handle: 'wrong' } : account;
        // X renders these without text separators: "Alice@aliceFollows you".
        main.innerHTML = `<div data-testid="UserName"><span dir="ltr">${name(shown)}</span><span dir="ltr">@${shown.handle}</span><div dir="ltr" data-testid="userFollowIndicator">Follows you</div></div>${description(shown)}${counts(shown)}<button data-testid="userActions">More</button>`;
        if (options.oldSuccessToast) main.insertAdjacentHTML('beforeend', `<div data-testid="toast">You removed @${account.handle} from your followers</div>`);
      }
    };
    window.addEventListener('popstate', () => {
      if (options.stopOnReturn) void send({ action: 'stop' });
      if (options.wrongReturn) history.replaceState({}, '', '/home');
      if (options.returnDelay) {
        document.querySelector('main').innerHTML = '';
        setTimeout(render, options.returnDelay);
      } else render();
    });
    document.addEventListener('mouseover', event => {
      const link = event.target.closest('a');
      if (!link || !link.closest('[data-testid="UserCell"]')) return;
      const account = accounts.find(account => link.pathname === `/${account.handle}`);
      if (!account || account.noHover || link.getAttribute('aria-hidden') === 'true') return;
      fixture.hovered.push(account.handle);
      const shown = account.staleHover ? { name: 'crypto', handle: 'stale', bio: '', followers: 1 } : account;
      const card = document.createElement('div');
      card.dataset.testid = 'HoverCard';
      card.innerHTML = `${nameLink(shown)}${account.omitHoverBio ? '' : compactBio(shown)}${counts(shown)}`;
      document.body.append(card);
    });
    document.addEventListener('mouseout', () => document.querySelector('[data-testid="HoverCard"]')?.remove());
    // X dismisses this menu on key release, not key down.
    document.addEventListener('keyup', event => {
      if (event.keyCode !== 27) return;
      if (options.stopAtMenuClose) void send({ action: 'stop' });
      if (!options.ignoreEscape) document.querySelector('[role="menu"]')?.remove();
    });
    document.addEventListener('click', event => {
      const target = event.target;
      const link = target.closest('a');
      if (link) {
        event.preventDefault();
        history.pushState({}, '', link.getAttribute('href'));
        render();
        return;
      }
      const handle = location.pathname.slice(1);
      if (target.closest('[data-testid="userActions"]')) {
        fixture.menuClicks++;
        if (fixture.confirmClicks) fixture.verificationMenus++;
        if (options.stopAtVerification && fixture.confirmClicks) void send({ action: 'stop' });
        const menu = document.createElement('div');
        menu.setAttribute('role', 'menu');
        menu.innerHTML = `<button role="menuitem">Block @${options.wrongVerificationMenu && fixture.confirmClicks ? 'different_account' : handle}</button>`;
        const stale = options.staleRemovalMenu || (fixture.confirmClicks && fixture.verificationMenus <= (options.staleMenuAttempts || 0));
        if (!options.missingRemove && (!fixture.removed.includes(handle) || stale)) menu.innerHTML += '<button role="menuitem">Remove this follower</button>';
        document.body.append(menu);
      } else if (target.closest('[role="menuitem"]')?.textContent === 'Remove this follower') {
        document.querySelector('[role="menu"]').remove();
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'alertdialog');
        dialog.dataset.testid = 'confirmationSheetDialog';
        dialog.innerHTML = `<h2>Remove this follower?</h2><p>@${options.wrongDialog ? 'someoneelse' : handle} will be removed from your followers.</p><button data-testid="confirmationSheetConfirm">Remove</button>`;
        document.body.append(dialog);
        if (options.stopAtDialog) void send({ action: 'stop' });
        if (options.navigateAtDialog) history.pushState({}, '', '/home');
      } else if (target.closest('[data-testid="confirmationSheetConfirm"]')) {
        fixture.confirmClicks++;
        if (options.failedRemove) return;
        const unconfirmed = accounts.find(account => account.handle === handle)?.unconfirmedRemoval;
        const finish = () => {
          if (!options.rejectedRemoval && !unconfirmed) fixture.removed.push(handle);
          document.querySelector('[role="alertdialog"]').remove();
          if ((!options.noToast && !unconfirmed) || options.rejectedRemoval) {
            const toast = document.createElement('div');
            toast.dataset.testid = 'toast';
            toast.textContent = options.rejectedRemoval ? 'Rate limit exceeded. Try again later.'
              : options.toastText || `You removed @${handle} from your followers`;
            document.body.append(toast);
            if (options.briefToast) setTimeout(() => toast.remove(), 1);
          }
        };
        if (options.confirmationDelay) setTimeout(finish, options.confirmationDelay);
        else finish();
      }
    });
    render();
  }, { accounts, options });
  await page.addScriptTag({ content: core });
  await page.addScriptTag({ content: source });
}

async function run(page, testMode = true, settings = fast, resume = true) {
  const start = await page.evaluate(({ testMode, settings, resume }) => send({ action: 'start', testMode, settings, resume }), { testMode, settings, resume });
  assert.equal(start.error, undefined, start.error);
  await page.waitForFunction(() => !send({ action: 'status' }).running, null, { timeout: 10000 });
  return page.evaluate(async () => ({ state: await send({ action: 'status' }), fixture }));
}

const clean = { handle: 'alice', name: 'Alice', bio: 'Gardening', followers: 20 };
let passed = 0;
async function check(title, body) {
  await body();
  passed++;
  console.log(`PASS ${title}`);
}

try {
  await check('realistic rows/cards keep ordinary checks on the list, without profile visits', async () => {
    const page = await fixture([
      clean,
      { ...clean, handle: 'nineteen', followers: 19 },
      { ...clean, handle: 'diamond', emoji: true },
      { ...clean, handle: 'biomatch', bio: 'WEB3 builder', noHover: true },
    ]);
    const { state, fixture: result } = await run(page);
    assert.equal(state.kept, 1, state.message);
    assert.equal(state.matched, 3);
    assert.deepEqual(result.profileVisits, []);
    assert.equal(result.menuClicks, 0);
    await page.close();
  });

  await check('an omitted hover bio is unknown even if the row has readable text', async () => {
    const page = await fixture([{ ...clean, omitHoverBio: true }]);
    const { state, fixture: result } = await run(page);
    assert.equal(state.kept, 1, state.message);
    assert.equal(state.matched, 0);
    assert.deepEqual(result.profileVisits, ['alice']);
    await page.close();
  });

  await check('test mode: independent rules, emoji, 20 boundary, stale cards, empty and unreadable profiles', async () => {
    const page = await fixture([
      clean,
      { ...clean, handle: 'diamond', emoji: true },
      { ...clean, handle: 'substring', name: 'MyEthereumApp' },
      { ...clean, handle: 'keywordbio', bio: 'I love WEB3' },
      { ...clean, handle: 'blank', bio: '' },
      { ...clean, handle: 'nineteen', followers: 19 },
      { ...clean, handle: 'unknown', followers: null, bio: '', noHover: true },
      { ...clean, handle: 'staletarget', staleHover: true },
      { ...clean, handle: 'wrongtarget', wrongProfile: true, noHover: true },
    ]);
    const { state, fixture: result } = await run(page);
    assert.equal(state.matched, 5, state.message);
    assert.equal(state.kept, 2);
    assert.equal(state.skipped, 2);
    assert.equal(state.removed, 0);
    assert.equal(state.processed, 9);
    assert.equal(result.menuClicks, 0);
    assert.equal(result.confirmClicks, 0);
    assert.ok(result.profileVisits.includes('blank'));
    await page.close();
  });

  await check('live mode removes successive followers even after the previous row disappears', async () => {
    const page = await fixture([{ ...clean, handle: 'one', name: 'crypto' }, { ...clean, handle: 'two', bio: '' }, clean]);
    const { state, fixture: result } = await run(page, false);
    assert.deepEqual(result.removed, ['one', 'two']);
    assert.equal(state.removed, 2, state.message);
    assert.equal(state.kept, 1);
    assert.equal(state.processed, 3);
    await page.close();
  });

  await check('no-toast removals close the verification menu on key release and continue', async () => {
    const page = await fixture([{ ...clean, name: 'crypto' }, { ...clean, handle: 'next', name: 'crypto' }, { ...clean, handle: 'kept' }], { noToast: true });
    const { state, fixture: result } = await run(page, false);
    assert.equal(state.removed, 2, state.message);
    assert.equal(state.processed, 3);
    assert.equal(state.kept, 1);
    assert.deepEqual(result.removed, ['alice', 'next']);
    assert.equal(result.confirmClicks, 2);
    assert.equal(result.menuClicks, 4);
    assert.match(state.message, /^Finished/);
    assert.equal(new URL(page.url()).pathname, '/owner/followers');
    assert.equal(await page.locator('[role="menu"]').count(), 0);
    await page.close();
  });

  for (const option of ['ignoreEscape', 'stopAtMenuClose']) {
    await check(`${option} preserves the verified removal count and stops before the next account`, async () => {
      const page = await fixture([{ ...clean, name: 'crypto' }, { ...clean, handle: 'next', name: 'crypto' }], { noToast: true, [option]: true });
      const { state, fixture: result } = await run(page, false);
      assert.equal(state.removed, 1, state.message);
      assert.equal(state.processed, 1);
      assert.equal(state.matched, 1);
      assert.deepEqual(result.removed, ['alice']);
      assert.equal(result.confirmClicks, 1);
      assert.ok(!result.profileVisits.includes('next'));
      assert.match(state.message, option === 'ignoreEscape' ? /Removed @alice.*menu/ : /^Stopped\.$/);
      await page.close();
    });
  }

  await check('a stale verification menu is rechecked without submitting removal twice', async () => {
    const page = await fixture([{ ...clean, name: 'crypto' }], { noToast: true, staleMenuAttempts: 1 });
    const { state, fixture: result } = await run(page, false);
    assert.equal(state.removed, 1, state.message);
    assert.equal(state.processed, 1);
    assert.equal(result.confirmClicks, 1);
    assert.equal(result.verificationMenus, 2);
    assert.match(state.message, /^Finished/);
    await page.close();
  });

  for (const options of [{ briefToast: true }, { briefToast: true, toastText: '@alice is no longer following you' }, { confirmationDelay: 25 }]) {
    await check(`success is captured despite transient messages or delayed confirmation: ${JSON.stringify(options)}`, async () => {
      const page = await fixture([{ ...clean, name: 'crypto' }], { ...options, staleRemovalMenu: true });
      const { state, fixture: result } = await run(page, false);
      assert.equal(state.removed, 1, state.message);
      assert.equal(result.confirmClicks, 1);
      assert.equal(result.verificationMenus, 0);
      await page.close();
    });
  }

  for (const options of [{ oldSuccessToast: true, noToast: true }, { toastText: 'You removed @different_account from your followers' }]) {
    await check(`old or unrelated success messages cannot confirm this removal: ${JSON.stringify(options)}`, async () => {
      const page = await fixture([{ ...clean, name: 'crypto' }], { ...options, staleRemovalMenu: true });
      const { state, fixture: result } = await run(page, false);
      assert.equal(state.removed, 0, state.message);
      assert.equal(state.processed, 0);
      assert.equal(result.confirmClicks, 1);
      assert.match(state.message, /1 unconfirmed removal/);
      await page.close();
    });
  }

  await check('an explicit X rejection is reported without repeating the removal request', async () => {
    const storage = {};
    const page = await fixture([{ ...clean, name: 'crypto' }, { ...clean, handle: 'next', name: 'crypto' }], { rejectedRemoval: true, briefToast: true }, storage);
    const { state, fixture: result } = await run(page, false);
    assert.equal(state.removed, 0);
    assert.equal(result.confirmClicks, 1);
    assert.deepEqual(result.removed, []);
    assert.match(state.message, /Rate limit exceeded/);
    assert.deepEqual(Object.values(storage)[0].handles, []);
    assert.ok(!result.profileVisits.includes('next'));
    await page.close();
  });

  await check('Stop during verification prevents further menu or removal clicks', async () => {
    const page = await fixture([{ ...clean, name: 'crypto' }], { noToast: true, staleRemovalMenu: true, stopAtVerification: true });
    const { state, fixture: result } = await run(page, false);
    assert.equal(state.message, 'Stopped.');
    assert.equal(state.removed, 0);
    assert.equal(result.confirmClicks, 1);
    assert.equal(result.verificationMenus, 1);
    await page.close();
  });

  await check('a different account’s menu never verifies removal', async () => {
    const page = await fixture([{ ...clean, name: 'crypto' }], { noToast: true, wrongVerificationMenu: true });
    const { state } = await run(page, false);
    assert.equal(state.removed, 0);
    assert.match(state.message, /Could not verify removal/);
    await page.close();
  });

  await check('unverified removals return to the list and do not count as removed', async () => {
    const page = await fixture([{ ...clean, name: 'crypto' }, { ...clean, handle: 'next', name: 'crypto' }], { noToast: true, staleRemovalMenu: true });
    const { state, fixture: result } = await run(page, false);
    assert.equal(state.removed, 0);
    assert.equal(state.processed, 0);
    assert.match(state.message, /2 unconfirmed removal/);
    assert.equal(result.confirmClicks, 2);
    assert.deepEqual(result.profileVisits, ['alice', 'next']);
    assert.equal(new URL(page.url()).pathname, '/owner/followers');
    assert.equal(await page.locator('[role="menu"]').count(), 0);
    await page.close();
  });

  await check('an unconfirmed follower is deferred once, later accounts complete, and a future run retries it', async () => {
    const storage = {};
    const accounts = [{ ...clean, name: 'crypto', unconfirmedRemoval: true }, { ...clean, handle: 'next', name: 'crypto' }, { ...clean, handle: 'kept' }];
    const page = await fixture(accounts, { returnDelay: 30 }, storage);
    const first = await run(page, false);
    assert.equal(first.state.removed, 1, first.state.message);
    assert.equal(first.state.processed, 2);
    assert.equal(first.state.kept, 1);
    assert.match(first.state.message, /1 unconfirmed removal/);
    assert.equal(first.fixture.confirmClicks, 2);
    assert.deepEqual(first.fixture.removed, ['next']);
    assert.deepEqual(first.fixture.profileVisits, ['alice', 'next']);
    assert.deepEqual(Object.values(storage)[0].handles, ['next', 'kept']);
    await page.reload();
    await installFixture(page, accounts.map(account => ({ ...account, unconfirmedRemoval: false })));
    const resumed = await run(page, false);
    assert.equal(resumed.state.removed, 2, resumed.state.message);
    assert.equal(resumed.state.processed, 3);
    assert.equal(resumed.fixture.confirmClicks, 1);
    assert.deepEqual(resumed.fixture.profileVisits, ['alice']);
    assert.deepEqual(resumed.fixture.removed, ['alice']);
    await page.close();
  });

  for (const option of ['stopOnReturn', 'wrongReturn']) {
    await check(`${option} during recovery halts without starting another removal`, async () => {
      const page = await fixture([{ ...clean, name: 'crypto', unconfirmedRemoval: true }, { ...clean, handle: 'next', name: 'crypto' }], { [option]: true });
      const { state, fixture: result } = await run(page, false);
      assert.equal(state.removed, 0);
      assert.equal(state.processed, 0);
      assert.equal(result.confirmClicks, 1);
      assert.ok(!result.profileVisits.includes('next'));
      assert.match(state.message, option === 'stopOnReturn' ? /^Stopped\.$/ : /Page or signed-in account changed/);
      await page.close();
    });
  }

  await check('a known name rule still matches when the unrelated follower count is unreadable', async () => {
    const page = await fixture([{ ...clean, name: 'crypto', followers: null }]);
    const { state } = await run(page, false);
    assert.equal(state.removed, 1, state.message);
    await page.close();
  });

  for (const option of ['wrongDialog', 'stopAtDialog', 'navigateAtDialog', 'missingRemove', 'failedRemove']) {
    await check(`${option} halts removal and never advances to another account`, async () => {
      const page = await fixture([{ ...clean, name: 'crypto' }, { ...clean, handle: 'next', name: 'crypto' }], { [option]: true });
      const { state, fixture: result } = await run(page, false);
      assert.equal(state.removed, 0, state.message);
      assert.equal(result.confirmClicks, option === 'failedRemove' ? 1 : 0);
      assert.ok(!result.profileVisits.includes('next'));
      assert.doesNotMatch(state.message, /^Finished/);
      await page.close();
    });
  }

  await check('virtualized list can recycle the last processed row', async () => {
    const page = await fixture([clean, { ...clean, handle: 'next' }, { ...clean, handle: 'last' }], { virtualized: true });
    const { state } = await run(page);
    assert.equal(state.kept, 3, state.message);
    await page.close();
  });

  await check('another account’s followers list is rejected', async () => {
    const page = await fixture([clean]);
    await page.evaluate(() => history.replaceState({}, '', '/someoneelse/followers'));
    const state = await page.evaluate(() => send({ action: 'start', settings: {}, testMode: false }));
    assert.match(state.error, /your own/);
    await page.close();
  });

  await check('stop interrupts a long wait immediately', async () => {
    const page = await fixture([clean]);
    await page.evaluate(settings => send({ action: 'start', settings }), { ...fast, scrollDelay: 60000 });
    await page.evaluate(() => send({ action: 'stop' }));
    await page.waitForFunction(() => !send({ action: 'status' }).running, null, { timeout: 1000 });
    assert.equal(await page.evaluate(() => fixture.confirmClicks), 0);
    await page.close();
  });

  await check('stop/resume and refresh preserve totals and skip completed accounts through a virtualized list', async () => {
    const storage = {};
    const accounts = Array.from({ length: 10 }, (_, index) => ({ ...clean, handle: `person${index}` }));
    const page = await fixture(accounts, { virtualized: true, stopAfterProcessed: 3 }, storage);
    const first = await run(page);
    assert.equal(first.state.processed, 3);
    assert.equal(first.state.message, 'Stopped.');
    await page.evaluate(() => { fixture.options.stopAfterProcessed = 6; });
    const second = await run(page);
    assert.equal(second.state.processed, 6);
    assert.deepEqual(second.fixture.hovered, accounts.slice(0, 6).map(account => account.handle));

    await page.reload();
    await installFixture(page, accounts, { virtualized: true });
    const third = await run(page);
    assert.equal(third.state.processed, 10, third.state.message);
    assert.equal(third.state.kept, 10);
    assert.deepEqual(third.fixture.hovered, accounts.slice(6).map(account => account.handle));
    assert.equal(Object.values(storage)[0].handles.length, 10);
    await page.close();
  });

  await check('resume scrolls past long stretches of saved rows before lazy content appears', async () => {
    const storage = {};
    const first = await fixture([clean], {}, storage);
    await run(first);
    await first.close();
    const page = await fixture([clean, { ...clean, handle: 'later' }], {}, storage);
    await page.evaluate(() => {
      const list = document.querySelector('[aria-label="Timeline: Followers"]');
      const later = list.lastElementChild;
      later.remove();
      list.style.paddingBottom = '5000px';
      const loadMore = () => {
        if (window.scrollY <= innerHeight * 3) return;
        list.append(later);
        list.style.paddingBottom = '';
        window.removeEventListener('scroll', loadMore);
      };
      window.addEventListener('scroll', loadMore);
    });
    const { state, fixture: result } = await run(page);
    assert.equal(state.processed, 2, state.message);
    assert.deepEqual(result.hovered, ['later']);
    await page.close();
  });

  await check('test, live, and signed-in account checkpoints stay independent', async () => {
    const storage = {};
    const accounts = [{ ...clean, name: 'Crypto' }, { ...clean, handle: 'bob' }];
    const page = await fixture(accounts, {}, storage);
    const test = await run(page);
    assert.equal(test.state.matched, 1);
    assert.equal(test.state.removed, 0);
    const live = await run(page, false);
    assert.equal(live.state.processed, 2);
    assert.equal(live.state.removed, 1);
    assert.equal(live.fixture.confirmClicks, 1);
    const other = await fixture(accounts, { owner: 'another_owner' }, storage);
    const separate = await run(other);
    assert.equal(separate.state.processed, 2);
    assert.equal(separate.state.matched, 1);
    assert.deepEqual(separate.fixture.hovered, ['bob']);
    assert.equal(Object.keys(storage).length, 3);
    await page.close();
    await other.close();
  });

  await check('an account interrupted before confirmation is retried on resume', async () => {
    const storage = {};
    const page = await fixture([{ ...clean, name: 'Crypto' }], { stopAtDialog: true }, storage);
    const first = await run(page, false);
    assert.equal(first.state.processed, 0);
    assert.deepEqual(Object.values(storage)[0].handles, []);
    await page.evaluate(() => { fixture.options.stopAtDialog = false; });
    await page.goBack();
    const resumed = await run(page, false);
    assert.equal(resumed.state.removed, 1, resumed.state.message);
    assert.equal(resumed.state.processed, 1);
    assert.equal(resumed.fixture.confirmClicks, 1);
    await page.close();
  });

  await check('a verified removal survives cleanup failure and refresh without a second removal', async () => {
    const storage = {};
    const accounts = [{ ...clean, name: 'Crypto' }, { ...clean, handle: 'next', name: 'Crypto' }];
    const page = await fixture(accounts, { noToast: true, ignoreEscape: true }, storage);
    const first = await run(page, false);
    assert.equal(first.state.removed, 1);
    assert.deepEqual(Object.values(storage)[0].handles, ['alice']);
    await page.goto('https://x.com/owner/followers');
    await installFixture(page, accounts, { noToast: true });
    const resumed = await run(page, false);
    assert.equal(resumed.state.removed, 2, resumed.state.message);
    assert.equal(resumed.state.processed, 2);
    assert.deepEqual(resumed.fixture.removed, ['next']);
    assert.equal(resumed.fixture.confirmClicks, 1);
    assert.deepEqual(resumed.fixture.profileVisits, ['next']);
    await page.close();
  });

  await check('starting over resets only the selected checkpoint and rechecks accounts', async () => {
    const storage = {};
    const page = await fixture([clean], {}, storage);
    await run(page, false);
    const liveCheckpoint = structuredClone(Object.values(storage)[0]);
    await run(page);
    const resumed = await run(page);
    assert.equal(resumed.state.processed, 1);
    assert.equal(resumed.fixture.hovered.length, 2);
    const fresh = await run(page, true, fast, false);
    assert.equal(fresh.state.processed, 1);
    assert.equal(fresh.fixture.hovered.length, 3);
    assert.deepEqual(Object.values(storage)[0], liveCheckpoint);
    await page.close();
  });

  await check('the new checkpoint resets old test/live totals and rechecks all accounts', async () => {
    await import('../core.js');
    const old = { rules: JSON.stringify(globalThis.FollowerPrunerCore.keywords),
      handles: ['alice'], counters: { processed: 1, matched: 0, removed: 0, kept: 1, skipped: 0 } };
    const storage = {
      'follower-pruner:progress:1:owner:test': structuredClone(old),
      'follower-pruner:progress:1:owner:live': structuredClone(old),
    };
    const page = await fixture([clean], {}, storage);
    const preview = await run(page);
    assert.equal(preview.state.processed, 1);
    assert.deepEqual(preview.fixture.hovered, ['alice']);
    const live = await run(page, false);
    assert.equal(live.state.processed, 1);
    assert.equal(live.state.removed, 0);
    assert.deepEqual(live.fixture.hovered, ['alice', 'alice']);
    assert.deepEqual(storage['follower-pruner:progress:2:owner:live'].handles, ['alice']);
    await page.close();
  });

  await check('NFT bios previously kept are rechecked in test and live mode', async () => {
    await import('../core.js');
    const old = { rules: JSON.stringify(globalThis.FollowerPrunerCore.keywords.filter(word => word !== 'nft')),
      handles: ['alice'], counters: { processed: 1, matched: 0, removed: 0, kept: 1, skipped: 0 } };
    const storage = {
      'follower-pruner:progress:2:owner:test': structuredClone(old),
      'follower-pruner:progress:2:owner:live': structuredClone(old),
    };
    const page = await fixture([{ ...clean, bio: 'Collecting NFTs', followers: 500 }], {}, storage);
    const preview = await run(page);
    assert.equal(preview.state.processed, 1);
    assert.equal(preview.state.matched, 1);
    assert.equal(preview.state.kept, 0);
    assert.equal(preview.fixture.confirmClicks, 0);
    assert.deepEqual(preview.fixture.profileVisits, []);
    const live = await run(page, false);
    assert.equal(live.state.processed, 1);
    assert.equal(live.state.removed, 1, live.state.message);
    assert.equal(live.state.kept, 0);
    assert.deepEqual(live.fixture.removed, ['alice']);
    await page.close();
  });

  await check('changed keyword rules invalidate saved checks', async () => {
    const storage = {};
    const page = await fixture([clean], {}, storage);
    await run(page);
    Object.values(storage)[0].rules = 'older keywords';
    const result = await run(page);
    assert.equal(result.state.processed, 1);
    assert.equal(result.fixture.hovered.length, 2);
    await page.close();
  });

  await check('new bio rules recheck old kept accounts, respect field scope, and then resume normally', async () => {
    await import('../core.js');
    const accounts = ['sahara', 'follow', 'spaace_ai', 'crypto', 'btc', 'gnoma', 'airdrop', 'cnpynetwork']
      .map((word, i) => ({ ...clean, handle: `bioword${i}`, bio: `prefix${word.toUpperCase()}suffix` }));
    accounts.push({ ...clean, handle: 'sahara', name: 'Follow spaace_ai BTC Gnoma airdrop cnpynetwork' });
    const old = { rules: JSON.stringify(globalThis.FollowerPrunerCore.keywords),
      handles: accounts.map(a => a.handle),
      counters: { processed: accounts.length, matched: 0, removed: 0, kept: accounts.length, skipped: 0 } };
    const storage = {
      'follower-pruner:progress:2:owner:test': structuredClone(old),
      'follower-pruner:progress:2:owner:live': structuredClone(old),
    };
    const page = await fixture(accounts, {}, storage);
    const preview = await run(page);
    assert.equal(preview.state.processed, 9);
    assert.equal(preview.state.matched, 8);
    assert.equal(preview.state.kept, 1);
    assert.equal(preview.fixture.confirmClicks, 0);
    assert.deepEqual(preview.fixture.profileVisits, []);
    const live = await run(page, false);
    assert.equal(live.state.processed, 9);
    assert.equal(live.state.removed, 8, live.state.message);
    assert.equal(live.state.kept, 1);
    assert.deepEqual(live.fixture.removed, accounts.slice(0, 8).map(a => a.handle));
    const resumed = await run(page, false);
    assert.equal(resumed.state.processed, 9);
    assert.equal(resumed.state.removed, 8);
    assert.equal(resumed.fixture.confirmClicks, 8);
    assert.deepEqual(resumed.fixture.hovered, live.fixture.hovered);
    await page.close();
  });

  await check('handle-only matches survive profile reads and recheck prior name/bio-only progress', async () => {
    await import('../core.js');
    const { keywords, bioKeywords } = globalThis.FollowerPrunerCore;
    const old = { rules: JSON.stringify({ keywords, bioKeywords }), handles: ['crypto_person', 'nft_collector'],
      counters: { processed: 2, matched: 0, removed: 0, kept: 2, skipped: 0 } };
    const storage = {
      'follower-pruner:progress:2:owner:test': structuredClone(old),
      'follower-pruner:progress:2:owner:live': structuredClone(old),
    };
    const page = await fixture([
      { ...clean, handle: 'crypto_person', followers: null },
      { ...clean, handle: 'nft_collector', followers: 500 },
      { ...clean, handle: 'beth' },
    ], {}, storage);
    const logs = [];
    page.on('console', message => logs.push(message.text()));
    const preview = await run(page);
    assert.equal(preview.state.processed, 3);
    assert.equal(preview.state.matched, 2);
    assert.equal(preview.state.kept, 1);
    assert.equal(preview.fixture.confirmClicks, 0);
    assert.deepEqual(preview.fixture.profileVisits, []);
    const live = await run(page, false);
    assert.equal(live.state.processed, 3);
    assert.equal(live.state.removed, 2, live.state.message);
    assert.equal(live.state.kept, 1);
    assert.deepEqual(live.fixture.removed, ['crypto_person', 'nft_collector']);
    assert.ok(logs.some(line => line.includes('handle contains crypto')));
    assert.ok(logs.some(line => line.includes('handle contains nft')));
    const resumed = await run(page, false);
    assert.equal(resumed.state.removed, 2);
    assert.equal(resumed.fixture.confirmClicks, 2);
    await page.close();
  });

  await check('a storage failure stops the run before any removal', async () => {
    const page = await fixture([{ ...clean, name: 'Crypto' }], { failStorage: true });
    const { state, fixture: result } = await run(page, false);
    assert.match(state.message, /Could not save progress/);
    assert.equal(state.processed, 0);
    assert.equal(result.confirmClicks, 0);
    assert.deepEqual(result.profileVisits, []);
    await page.close();
  });

  await check('popup defaults to test mode, sends saved settings, toggles live mode and stops', async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const html = await readFile(new URL('../popup.html', import.meta.url), 'utf8');
    const popup = await readFile(new URL('../popup.js', import.meta.url), 'utf8');
    await page.route('**/*', route => {
      const file = new URL(route.request().url()).pathname;
      return route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : 'text/html', body: file === '/core.js' ? core : file === '/popup.js' ? popup : html });
    });
    await page.addInitScript(() => {
      window.calls = [];
      window.saved = {};
      let state = { running: false, testMode: true, message: 'Ready.', processed: 0, matched: 0, removed: 0, kept: 0, skipped: 0 };
      window.chrome = {
        storage: { local: { get: async () => window.saved, set: async value => { window.saved = value; } } },
        scripting: { executeScript: async options => { window.injected = options; } },
        tabs: { query: async () => [{ id: 42, url: 'https://x.com/owner/followers' }], sendMessage: async (_id, message) => {
          window.calls.push(message);
          if (message.action === 'start') state = { ...state, running: true, testMode: message.testMode, message: 'Starting…' };
          if (message.action === 'stop') state = { ...state, running: false, message: 'Stopped.' };
          return structuredClone(state);
        } },
      };
    });
    await page.goto('https://popup.test/');
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Processed:'));
    assert.match(await page.locator('#status').textContent(), /Would remove: 0/);
    assert.equal(await page.locator('#recent').count(), 0);
    assert.equal(await page.locator('#testMode').isChecked(), true);
    assert.equal(await page.locator('#resume').isChecked(), true);
    await page.locator('#testMode').uncheck();
    assert.equal(await page.locator('#start').textContent(), 'Start removing');
    await page.locator('#start').click();
    await page.waitForFunction(() => document.querySelector('#testMode').disabled);
    const data = await page.evaluate(() => ({ calls, saved, injected }));
    assert.equal(data.calls.find(call => call.action === 'start').testMode, false);
    assert.equal(data.calls.find(call => call.action === 'start').resume, true);
    assert.equal(await page.locator('#resume').isDisabled(), true);
    assert.equal(data.saved.settings.actionDelay, 2000);
    assert.equal(data.saved.settings.profileLoadDelay, 1000);
    assert.match(await page.locator('#status').textContent(), /Removed: 0/);
    assert.deepEqual(data.injected.files, ['core.js', 'content.js']);
    await page.locator('#stop').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Stopped.'));
    await page.locator('#resume').uncheck();
    await page.locator('#start').click();
    await page.waitForFunction(() => document.querySelector('#resume').disabled);
    assert.equal(await page.evaluate(() => calls.filter(call => call.action === 'start').at(-1).resume), false);
    await page.locator('#stop').click();
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Processed:'));
    assert.equal(await page.locator('#testMode').isChecked(), true);
    assert.equal(await page.locator('#resume').isChecked(), true);
    assert.deepEqual(errors, []);
    await page.close();
  });

  console.log(`${passed} browser scenarios passed.`);
} finally {
  await browser.close();
}

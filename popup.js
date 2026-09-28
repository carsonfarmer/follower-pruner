const { defaults, settings } = FollowerPrunerCore;
const labels = ['Scroll delay', 'Action delay', 'Hover delay', 'Profile load delay',
  'Max follower find attempts', 'Max hover card attempts', 'Max scroll attempts'];
const $ = id => document.getElementById(id);
let tabId;
let busy = false;

Object.entries(defaults).forEach(([key, value], index) => {
  const label = document.createElement('label');
  label.textContent = labels[index];
  const input = document.createElement('input');
  Object.assign(input, { id: key, type: 'number', value, min: key.startsWith('max') ? '1' : '0', max: '60000', required: true });
  label.append(input);
  $('settings').append(label);
});

function render(state) {
  $('start').disabled = busy || state.running;
  $('stop').disabled = !state.running;
  $('testMode').disabled = state.running;
  $('resume').disabled = state.running;
  $('settings').disabled = state.running;
  if (state.running) $('testMode').checked = state.testMode;
  $('start').textContent = $('testMode').checked ? 'Start test' : 'Start removing';
  const total = state.testMode ? `Would remove: ${state.matched}` : `Removed: ${state.removed}`;
  const status = `${state.message}\nProcessed: ${state.processed} · ${total}`;
  if ($('status').textContent !== status) $('status').textContent = status;
}

async function message(action, extra = {}) {
  const response = await chrome.tabs.sendMessage(tabId, { app: 'follower-pruner', action, ...extra });
  if (response.error) throw new Error(response.error);
  render(response);
}

$('testMode').onchange = () => { $('start').textContent = $('testMode').checked ? 'Start test' : 'Start removing'; };
$('form').onsubmit = async event => {
  event.preventDefault();
  busy = true;
  $('start').disabled = true;
  try {
    const config = settings(Object.fromEntries(Object.keys(defaults).map(key => [key, $(key).value])));
    await chrome.storage.local.set({ settings: config });
    await message('start', { settings: config, testMode: $('testMode').checked, resume: $('resume').checked });
  } catch (error) {
    $('status').textContent = error.message;
  } finally {
    busy = false;
    // A failed start must leave the button usable, without hiding its error.
    const state = await chrome.tabs.sendMessage(tabId, { app: 'follower-pruner', action: 'status' }).catch(() => null);
    $('start').disabled = Boolean(state?.running);
  }
};
$('stop').onclick = () => message('stop').catch(error => { $('status').textContent = error.message; });

try {
  const saved = await chrome.storage.local.get('settings');
  for (const [key, value] of Object.entries(settings(saved.settings))) $(key).value = value;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https:\/\/(x|twitter)\.com\//.test(tab.url)) throw new Error('Open your followers list on x.com first.');
  tabId = tab.id;
  await chrome.scripting.executeScript({ target: { tabId }, files: ['core.js', 'content.js'] });
  await message('status');
  setInterval(async () => {
    try {
      const state = await chrome.tabs.sendMessage(tabId, { app: 'follower-pruner', action: 'status' });
      // Preserve helpful start errors while idle.
      if (state.running || !$('stop').disabled) render(state);
    } catch {
      $('status').textContent = 'Tab reloaded or closed. Reopen this popup to resume saved progress.';
      $('start').disabled = true;
      $('stop').disabled = true;
    }
  }, 500);
} catch (error) {
  $('status').textContent = error.message;
  $('start').disabled = true;
}

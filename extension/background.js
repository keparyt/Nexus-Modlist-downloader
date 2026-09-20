const KEY = 'nexusQueueState';

const DEFAULT_STATE = {
  running: false,
  index: 0,
  urls: [],
  tabId: null,
  log: [],
  downloadWaiting: false
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getState() {
  const data = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_STATE, ...(data[KEY] || {}) };
}

async function saveState(state) {
  await chrome.storage.local.set({ [KEY]: state });
}

async function log(state, message) {
  state.log = [...(state.log || []), new Date().toLocaleTimeString() + ' ' + message].slice(-150);
  await saveState(state);
}

async function openNext() {
  const state = await getState();

  if (!state.running) return;

  if (state.index >= state.urls.length) {
    state.running = false;
    state.downloadWaiting = false;
    await log(state, 'Completed all URLs');
    return;
  }

  const url = state.urls[state.index];
  state.downloadWaiting = false;
  await log(state, `Opening ${state.index + 1}/${state.urls.length}: ${url}`);

  if (state.tabId) {
    try {
      await chrome.tabs.update(state.tabId, { url, active: true });
      return;
    } catch (error) {
      await log(state, `Existing tab unavailable: ${error.message}`);
      state.tabId = null;
    }
  }

  const tab = await chrome.tabs.create({ url, active: true });
  state.tabId = tab.id;
  await saveState(state);
}

chrome.runtime.onMessage.addListener((message, sender) => {
  (async () => {
    const state = await getState();

    if (message.type === 'START') {
      const urls = [...new Set(message.urls || [])];

      state.urls = urls;
      state.index = 0;
      state.running = urls.length > 0;
      state.tabId = null;
      state.log = [];
      state.downloadWaiting = false;

      await saveState(state);
      await log(state, `Queue started with ${urls.length} URL(s)`);
      await openNext();
      return;
    }

    if (message.type === 'STOP') {
      state.running = false;
      state.downloadWaiting = false;
      await log(state, 'Stopped by user');
      return;
    }

    if (message.type === 'STEP_LOG') {
      if (state.running) await log(state, message.text || '');
      return;
    }

    if (message.type === 'DOWNLOAD_STARTED') {
      if (!state.running || state.downloadWaiting) return;

      state.downloadWaiting = true;
      await log(state, 'Slow download clicked; waiting 10 seconds before next URL');

      await sleep(10000);

      const latest = await getState();
      if (!latest.running || !latest.downloadWaiting) {
        await log(latest, '10-second wait ended, but queue is no longer active');
        return;
      }

      latest.downloadWaiting = false;
      latest.index += 1;
      await saveState(latest);
      await openNext();
    }
  })().catch(error => {
    console.error('[Nexus Modlist Downloader] Background error:', error);
  });

  return true;
});

chrome.tabs.onRemoved.addListener(async tabId => {
  const state = await getState();

  if (state.tabId === tabId && state.running) {
    state.tabId = null;
    await log(state, 'Queue tab was closed; queue remains paused');
  }
});

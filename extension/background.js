const KEY = 'nexusQueueState';

const DEFAULT_STATE = {
  running: false,
  index: 0,
  urls: [],
  tabId: null,
  log: [],
  downloadWaiting: false,
  downloadMethod: 'vortex',
  capturedUrls: [],
  gatewayUrl: 'http://127.0.0.1:8765',
  downloadResolveUrl: ''
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function stripTrailingSlashes(value) {
  return String(value || '').replace(/\/$/, '');
}

async function getState() {
  const data = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_STATE, ...(data[KEY] || {}) };
}

async function saveState(state) {
  await chrome.storage.local.set({ [KEY]: state });
}

async function log(state, message) {
  state.log = [
    ...(state.log || []),
    new Date().toLocaleTimeString() + ' ' + message
  ].slice(-150);
  await saveState(state);
}

async function sendToGateway(url, state) {
  const base = stripTrailingSlashes(
    state.gatewayUrl || DEFAULT_STATE.gatewayUrl
  );

  try {
    const response = await fetch(base + '/api/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok) {
      await log(
        state,
        'Gateway rejected URL: ' + (data.error || response.statusText)
      );
      return false;
    }

    await log(state, 'Sent URL to gateway: ' + url);
    return true;
  } catch (error) {
    await log(
      state,
      'Gateway unavailable at ' + base + ': ' + error.message
    );
    return false;
  }
}

async function openNext() {
  const state = await getState();

  if (!state.running) return;

  if (state.index >= state.urls.length) {
    state.running = false;
    state.downloadWaiting = false;

    const message =
      state.downloadMethod === 'manual-urlgrab' || state.downloadMethod === 'gateway'
        ? 'Completed all URLs; captured ' + state.capturedUrls.length + ' download URL(s)'
        : 'Completed all URLs';

    await log(state, message);
    return;
  }

  const url = state.urls[state.index];
  state.downloadWaiting = false;

  await log(
    state,
    'Opening ' + (state.index + 1) + '/' + state.urls.length + ': ' + url
  );

  if (state.tabId) {
    try {
      await chrome.tabs.update(state.tabId, {
        url,
        active: true
      });
      return;
    } catch (error) {
      await log(
        state,
        'Existing queue tab unavailable: ' + error.message
      );
      state.tabId = null;
    }
  }

  const tab = await chrome.tabs.create({
    url,
    active: true
  });

  state.tabId = tab.id;
  await saveState(state);
}

chrome.runtime.onMessage.addListener((message, sender) => {
  (async () => {
    const state = await getState();

    if (
      message.type !== 'START' &&
      message.type !== 'STOP' &&
      sender.tab?.id &&
      state.tabId &&
      sender.tab.id !== state.tabId
    ) {
      return;
    }

    if (message.type === 'START') {
      const urls = [...new Set(message.urls || [])];

      state.urls = urls;
      state.index = 0;
      state.running = urls.length > 0;
      state.tabId = null;
      state.log = [];
      state.downloadWaiting = false;
      state.downloadResolveUrl = '';

      state.downloadMethod = [
        'vortex',
        'manual',
        'manual-urlgrab',
        'gateway'
      ].includes(message.downloadMethod)
        ? message.downloadMethod
        : 'vortex';

      state.capturedUrls = [];

      state.gatewayUrl =
        typeof message.gatewayUrl === 'string' &&
        message.gatewayUrl.trim()
          ? stripTrailingSlashes(message.gatewayUrl.trim())
          : DEFAULT_STATE.gatewayUrl;

      await saveState(state);
      await log(
        state,
        'Queue started with ' + urls.length + ' URL(s)'
      );
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
      if (state.running) {
        await log(state, message.text || '');
      }
      return;
    }

    if (message.type === 'NAVIGATE_DOWNLOAD') {
      if (
        !state.running ||
        !state.tabId ||
        sender.tab?.id !== state.tabId
      ) {
        return;
      }

      const url = message.url;

      if (
        !url ||
        !/^https:\/\/www\.nexusmods\.com\/api\/files\/\d+\/download(?:[/?]|$)/i.test(url)
      ) {
        await log(
          state,
          'Rejected invalid ' +
            (state.downloadMethod === 'manual' ? 'Manual' : 'Vortex') +
            ' download URL'
        );
        return;
      }

      state.downloadResolveUrl = url;
      await saveState(state);

      await log(
        state,
        'Navigating queue tab to ' +
          (state.downloadMethod === 'manual' ? 'Manual' : 'Vortex') +
          ' URL: ' +
          url
      );

      try {
        await chrome.tabs.update(state.tabId, {
          url,
          active: true
        });
      } catch (error) {
        await log(
          state,
          'Download URL navigation failed: ' + error.message
        );
      }

      return;
    }

    if (message.type === 'CAPTURE_URL') {
      if (
        !state.running ||
        !['manual-urlgrab', 'gateway'].includes(state.downloadMethod) ||
        state.downloadWaiting
      ) {
        return;
      }

      const url =
        typeof message.url === 'string'
          ? message.url.trim()
          : '';

      if (!url || !/^nxm:\/\//i.test(url)) {
        await log(state, 'Ignored non-NXM captured value: ' + url);
        return;
      }

      if (!state.capturedUrls.includes(url)) {
        state.capturedUrls.push(url);
      }

      state.downloadWaiting = true;

      await log(
        state,
        'Captured download URL ' +
          state.capturedUrls.length +
          ': ' +
          url
      );

      if (state.downloadMethod === 'gateway') {
        await sendToGateway(url, state);
      }

      await log(
        state,
        'URL captured; waiting 10 seconds before next URL (' +
          state.capturedUrls.length +
          ' captured)'
      );

      await sleep(10000);

      const latest = await getState();

      if (
        !latest.running ||
        !latest.downloadWaiting ||
        !['manual-urlgrab', 'gateway'].includes(latest.downloadMethod)
      ) {
        return;
      }

      latest.downloadWaiting = false;
      latest.downloadResolveUrl = '';
      latest.index += 1;

      await saveState(latest);
      await openNext();
      return;
    }

    if (message.type === 'DOWNLOAD_STARTED') {
      if (!state.running || state.downloadWaiting) {
        return;
      }

      state.downloadWaiting = true;

      await log(
        state,
        'Slow download clicked; waiting 10 seconds before next URL'
      );

      await sleep(10000);

      const latest = await getState();

      if (!latest.running || !latest.downloadWaiting) {
        return;
      }

      latest.downloadWaiting = false;
      latest.index += 1;

      await saveState(latest);
      await openNext();
    }
  })().catch(error => {
    console.error(
      '[Nexus Modlist Downloader] Background error:',
      error
    );
  });

  return true;
});

chrome.webRequest.onBeforeRedirect.addListener(
  details => {
    if (!/^nxm:\/\//i.test(details.redirectUrl || '')) return;
    (async () => {
      const state = await getState();
      if (
        !state.running ||
        state.tabId !== details.tabId ||
        !['manual-urlgrab', 'gateway'].includes(state.downloadMethod) ||
        state.downloadWaiting
      ) {
        return;
      }

      await log(
        state,
        'Intercepted NXM redirect before native downloader: ' +
          details.redirectUrl
      );

      try {
        await chrome.tabs.sendMessage(details.tabId, {
          type: 'CAPTURE_URL_FROM_NETWORK',
          url: details.redirectUrl
        });
      } catch (error) {
        await log(
          state,
          'Could not forward intercepted NXM URL to content script: ' +
            error.message
        );
      }
    })().catch(error => {
      console.error(
        '[Nexus Modlist Downloader] NXM redirect handler error:',
        error
      );
    });
  },
  { urls: ['https://www.nexusmods.com/api/files/*/download*'] }
);

chrome.tabs.onRemoved.addListener(async tabId => {
  const state = await getState();

  if (state.tabId === tabId && state.running) {
    state.tabId = null;
    await log(
      state,
      'Queue tab was closed; queue remains paused'
    );
  }
});

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

function methodLabel(method) {
  if (method === 'gateway') return 'Gateway';
  if (method === 'manual-urlgrab') return 'Manual URL Grab';
  if (method === 'manual') return 'Manual';
  return 'Vortex';
}

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

function extractNxmUrl(text) {
  if (!text) return '';
  const decoded = String(text)
    .replace(/&amp;/g, '&')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/g, '&');

  const match = decoded.match(/nxm:\/\/[^\s"'<>]+/i);
  return match ? match[0] : '';
}

async function captureResolvedUrl(url, source = 'resolver') {
  const state = await getState();

  if (
    !state.running ||
    !['manual-urlgrab', 'gateway'].includes(state.downloadMethod) ||
    state.downloadWaiting ||
    !/^nxm:\/\//i.test(url || '')
  ) {
    return false;
  }

  const captured = String(url).trim();

  if (!state.capturedUrls.includes(captured)) {
    state.capturedUrls.push(captured);
  }

  state.downloadWaiting = true;

  await log(
    state,
    'Captured download URL ' +
      state.capturedUrls.length +
      ' [' +
      source +
      ']: ' +
      captured
  );

  if (state.downloadMethod === 'gateway') {
    await sendToGateway(captured, state);
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
    return true;
  }

  latest.downloadWaiting = false;
  latest.downloadResolveUrl = '';
  latest.index += 1;

  await saveState(latest);
  await openNext();
  return true;
}

async function resolveDownloadInBackground(state, url) {
  state.downloadResolveUrl = url;
  await saveState(state);

  await log(
    state,
    'Resolving ' +
      (state.downloadMethod === 'gateway' ? 'Gateway' : 'Manual URL Grab') +
      ' download without browser navigation: ' +
      url
  );

  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      redirect: 'follow',
      cache: 'no-store',
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain,*/*'
      }
    });

    const text = await response.text().catch(() => '');
    const nxm = extractNxmUrl(text);

    if (nxm) {
      await captureResolvedUrl(nxm, 'API response');
    } else if (response.url && /^nxm:\/\//i.test(response.url)) {
      await captureResolvedUrl(response.url, 'API final URL');
    } else {
      await log(
        state,
        'Gateway resolver response contained no nxm:// URL; waiting for redirect interceptor'
      );
    }
  } catch (error) {
    const latest = await getState();

    if (
      latest.running &&
      !latest.downloadWaiting &&
      latest.downloadResolveUrl === url
    ) {
      await log(
        latest,
        'Resolver request ended before readable response: ' + error.message
      );
    }
  }
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
    'Opening ' + (state.index + 1) + '/' + state.urls.length + ' [' + methodLabel(state.downloadMethod) + ']: ' + url
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
        'Queue started with ' + urls.length + ' URL(s) [Method: ' + methodLabel(state.downloadMethod) + ']'
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

    if (message.type === 'RESOLVE_DOWNLOAD') {
      if (
        !state.running ||
        !state.tabId ||
        sender.tab?.id !== state.tabId ||
        !['manual-urlgrab', 'gateway'].includes(message.method || state.downloadMethod) ||
        state.downloadWaiting
      ) {
        return;
      }

      const url = typeof message.url === 'string' ? message.url.trim() : '';

      if (
        !url ||
        !/^https:\/\/www\.nexusmods\.com\/api\/files\/\d+\/download(?:[/?]|$)/i.test(url)
      ) {
        await log(state, 'Rejected invalid resolver URL: ' + url);
        return;
      }

      const requestedMethod = ['manual-urlgrab', 'gateway'].includes(message.method)
        ? message.method
        : state.downloadMethod;

      state.downloadMethod = requestedMethod;
      state.downloadResolveUrl = url;
      await saveState(state);

      await resolveDownloadInBackground(state, url);
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
      const requestedMethod = [
        'vortex',
        'manual',
        'manual-urlgrab',
        'gateway'
      ].includes(message.method)
        ? message.method
        : state.downloadMethod;

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

      state.downloadMethod = requestedMethod;
      state.downloadResolveUrl = url;
      await saveState(state);

      const methodLabel =
        requestedMethod === 'gateway'
          ? 'Gateway'
          : requestedMethod === 'manual-urlgrab'
            ? 'Manual URL Grab'
            : requestedMethod === 'manual'
              ? 'Manual'
              : 'Vortex';

      await log(
        state,
        'Navigating queue tab to ' +
          methodLabel +
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

      if (state.downloadMethod === 'gateway' || state.downloadMethod === 'manual-urlgrab') {
        await log(
          state,
          'Ignoring native download completion in ' +
            (state.downloadMethod === 'gateway' ? 'Gateway' : 'Manual URL Grab') +
            ' mode; waiting for captured nxm:// URL'
        );
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
        state.downloadWaiting ||
        !['manual-urlgrab', 'gateway'].includes(state.downloadMethod) ||
        !state.downloadResolveUrl ||
        details.url !== state.downloadResolveUrl
      ) {
        return;
      }

      await captureResolvedUrl(details.redirectUrl, 'network redirect');
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

(() => {
  if (!location.hostname.endsWith('nexusmods.com')) return;

  const KEY = 'nexusQueueState';
  let busy = false;
  let downloadMode = false;
  let downloadMethod = 'vortex';
  let downloadResolveUrl = '';
  let captureClickSent = false;
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const debug = text => {
    const message = `[${location.pathname}] ${text}`;
    console.debug('[Nexus Modlist Downloader]', message);
    chrome.runtime.sendMessage({ type: 'STEP_LOG', text: message }).catch(() => {});
  };

  const isDownloadUrl = () =>
    /\/api\/files\/\d+\/download(?:[/?]|$)/i.test(location.pathname) ||
    /^nxm:\/\//i.test(location.href);

  const parseFile = modal => {
    const raw = modal?.getAttribute('file');
    if (!raw) return null;
    try { return JSON.parse(raw); }
    catch (e) {
      debug(`mod-download-modal JSON parse failed: ${e.message}`);
      return null;
    }
  };

  const isVisible = el => {
    try {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' &&
        s.opacity !== '0' && r.width > 0 && r.height > 0;
    } catch { return false; }
  };

  function allRoots(root = document, path = 'document', out = [], seen = new Set()) {
    if (!root || seen.has(root)) return out;
    seen.add(root);
    out.push({ root, path });

    // The starting root can itself be a custom element with a shadow root.
    // querySelectorAll('*') does not include the root element, so inspect its
    // own shadowRoot before walking descendant elements.
    try {
      if (root instanceof Element && root.shadowRoot) {
        allRoots(root.shadowRoot, path + '::shadow', out, seen);
      }
    } catch {}

    let nodes = [];
    try { nodes = [...root.querySelectorAll('*')]; } catch {}
    for (const node of nodes) {
      try {
        if (node.shadowRoot) {
          allRoots(
            node.shadowRoot,
            path + ' > ' + node.tagName.toLowerCase() + '::shadow',
            out,
            seen
          );
        }
      } catch {}
    }
    return out;
  }

  const describe = el => {
    const parts = [
      el.tagName,
      el.id && '#' + el.id,
      el.getAttribute('class'),
      el.getAttribute('part'),
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.getAttribute('data-testid'),
      el.getAttribute('data-action'),
      el.getAttribute('value'),
      el.textContent
    ].filter(Boolean).map(String);
    return norm(parts.join(' '));
  };

  const slowMatch = el => {
    const s = describe(el);
    return s.includes('slow download') || s.includes('slow_download') ||
      s.includes('slow-download');
  };

  const findActionInModal = (modal, matcher) => {
    if (!modal) return null;
    const roots = allRoots(modal, 'mod-download-modal');
    const selectors = [
      'button', 'a', '[role="button"]', '[part]', '[data-testid]',
      'input[type="button"]', 'input[type="submit"]'
    ];

    for (const { root, path } of roots) {
      for (const selector of selectors) {
        let els = [];
        try { els = [...root.querySelectorAll(selector)]; } catch {}
        for (const el of els) {
          if (isVisible(el) && matcher(el)) {
            debug(`FOUND ${downloadMethod === 'manual' ? 'Manual' : 'Vortex'} action in ${path}: <${el.tagName.toLowerCase()}> text="${norm(el.textContent).slice(0,160)}"`);
            return el;
          }
        }
      }
      let els = [];
      try { els = [...root.querySelectorAll('*')]; } catch {}
      for (const el of els) {
        if (isVisible(el) && matcher(el)) {
          debug(`FOUND ${downloadMethod === 'manual' ? 'Manual' : 'Vortex'} custom action in ${path}: <${el.tagName.toLowerCase()}> text="${norm(el.textContent).slice(0,160)}"`);
          return el;
        }
      }
    }
    return null;
  };

  const manualMatch = el => {
    const s = describe(el);
    return s === 'manual' || s.includes(' manual ') || s.startsWith('manual ') ||
      s.endsWith(' manual') || s.includes('manual download');
  };

  const findManualAction = () => findActionInModal(document.querySelector('mod-download-modal'), manualMatch);

  const findSlowDownload = () => {
    const component = document.querySelector('mod-file-download');
    if (!component) return null;

    const roots = allRoots(component, 'mod-file-download');
    const selectors = [
      'button', 'a', '[role="button"]', '[part]', '[data-testid]',
      'input[type="button"]', 'input[type="submit"]'
    ];

    for (const { root, path } of roots) {
      for (const selector of selectors) {
        let els = [];
        try { els = [...root.querySelectorAll(selector)]; } catch {}
        for (const el of els) {
          if (isVisible(el) && slowMatch(el)) {
            debug(`FOUND Slow Download in ${path}: <${el.tagName.toLowerCase()}> id="${el.id || ''}" part="${el.getAttribute('part') || ''}" text="${norm(el.textContent).slice(0,160)}"`);
            return el;
          }
        }
      }

      // Also inspect custom elements themselves because Nexus may expose the
      // CTA as another web component rather than a native button.
      let els = [];
      try { els = [...root.querySelectorAll('*')]; } catch {}
      for (const el of els) {
        if (isVisible(el) && slowMatch(el)) {
          debug(`FOUND Slow Download custom candidate in ${path}: <${el.tagName.toLowerCase()}> text="${norm(el.textContent).slice(0,160)}"`);
          return el;
        }
      }
    }

    const componentDesc = describe(component);
    if (componentDesc.includes('slow download') || componentDesc.includes('slow_download')) {
      debug('Slow Download is present in mod-file-download content but no clickable descendant was exposed');
    }

    return null;
  };

  const normalizeNxmUrl = value => {
    const text = String(value || '').trim();
    return /^nxm:\/\//i.test(text) ? text : '';
  };

  const findNxmUrl = component => {
    if (!component) return '';

    const direct = [
      component.getAttribute('download-url'),
      component.downloadUrl,
      component.downloadURL,
      component.dataset?.downloadUrl,
      component.file?.downloadUrl,
      component.file?.downloadURL
    ];

    for (const value of direct) {
      const url = normalizeNxmUrl(value);
      if (url) return url;
    }

    for (const { root } of allRoots(component, 'mod-file-download')) {
      let nodes = [];
      try { nodes = [root, ...root.querySelectorAll('*')]; } catch {}

      for (const node of nodes) {
        try {
          for (const name of node.getAttributeNames?.() || []) {
            const url = normalizeNxmUrl(node.getAttribute(name));
            if (url) return url;
          }
        } catch {}

        const props = [
          node.downloadUrl,
          node.downloadURL,
          node.fileUri,
          node.fileURI,
          node.file?.downloadUrl,
          node.file?.downloadURL
        ];

        for (const value of props) {
          const url = normalizeNxmUrl(value);
          if (url) return url;
        }
      }
    }

    return '';
  };

  const clickAction = el => {
    debug('Attempting action click');
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    try { el.focus?.(); } catch {}
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      try {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, composed: true, view: window,
          buttons: type === 'mousedown' || type === 'mouseup' ? 1 : 0
        }));
      } catch {}
    }
    try {
      el.click();
      debug('Action .click() completed');
      return true;
    } catch (e) {
      debug(`Action .click() failed: ${e.message}`);
      return false;
    }
  };

  const clickSlow = el => {
    debug('Attempting Slow Download click');
    if (!el) return false;

    try {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    } catch {}

    try {
      el.focus?.();
    } catch {}

    try {
      if (el instanceof HTMLButtonElement) {
        HTMLButtonElement.prototype.click.call(el);
      } else if (el instanceof HTMLElement && HTMLElement.prototype.click) {
        HTMLElement.prototype.click.call(el);
      } else if (typeof el.click === 'function') {
        el.click();
      } else {
        throw new Error('Element has no click method');
      }

      debug('Slow Download native click completed');
      return true;
    } catch (e) {
      debug(`Slow Download native click failed: ${e.message}`);
    }

    try {
      el.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      }));
      debug('Slow Download fallback click event dispatched');
      return true;
    } catch (e) {
      debug(`Slow Download fallback click failed: ${e.message}`);
      return false;
    }
  };

  const parseNxmFromResponse = text => {
    if (!text) return '';
    const raw = String(text)
      .replace(/&amp;/g, '&')
      .replace(/\\\//g, '/')
      .replace(/\\u0026/g, '&');

    try {
      const json = JSON.parse(raw);
      const candidates = [
        json?.downloadUrl,
        json?.url,
        json?.vortexDownloadUrl,
        json?.nmmDownloadUrl,
        json?.data?.url
      ];
      for (const value of candidates) {
        const url = normalizeNxmUrl(value);
        if (url) return url;
      }
    } catch {}

    const match = raw.match(/nxm:\/\/[^\s"'<>]+/i);
    return match ? normalizeNxmUrl(match[0]) : '';
  };

  async function resolveSlowDownloadFromPage(component) {
    const fileId = component?.getAttribute('file-id') || '';
    const gameId = component?.getAttribute('game-id') || '';

    if (!fileId || !gameId) {
      debug(`Gateway cannot resolve Slow Download: file-id="${fileId}" game-id="${gameId}"`);
      return '';
    }

    const body = new URLSearchParams();
    body.set('fid', fileId);
    body.set('game_id', gameId);
    body.set('nmm', '1');

    try {
      debug(`Gateway requesting Nexus GenerateDownloadUrl for file-id=${fileId}, game-id=${gameId}`);
      const response = await fetch('/Core/Libs/Common/Managers/Downloads?GenerateDownloadUrl', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: body.toString()
      });

      const text = await response.text().catch(() => '');
      const nxm = parseNxmFromResponse(text);
      if (nxm) return nxm;

      debug(`Gateway GenerateDownloadUrl returned status=${response.status} without a usable nxm:// URL`);
    } catch (error) {
      debug(`Gateway GenerateDownloadUrl request failed: ${error.message}`);
    }

    return '';
  };

  async function interceptSlowDownload(button, component) {
    if (!button || button.dataset.nexusGatewayIntercepted === '1') return;

    button.dataset.nexusGatewayIntercepted = '1';

    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    debug('Attempting Slow Download click');
    try {
      button.click();
      debug('Slow Download click intercepted; native nxm:// launch is blocked');
    } catch (error) {
      debug(`Slow Download click dispatch failed: ${error.message}`);
    }

    const componentUrlBefore = findNxmUrl(component);
    if (componentUrlBefore) {
      debug(`Gateway captured existing nxm:// URL: ${componentUrlBefore}`);
      chrome.runtime.sendMessage({ type: 'CAPTURE_URL', url: componentUrlBefore }).catch(() => {});
      busy = false;
      return true;
    }

    const url = await resolveSlowDownloadFromPage(component);
    if (url) {
      debug(`Gateway captured generated nxm:// URL: ${url}`);
      chrome.runtime.sendMessage({ type: 'CAPTURE_URL', url }).catch(() => {});
      busy = false;
      return true;
    }

    return false;
  };

  async function handleDownloadPage(reason = 'detected') {
    if (downloadMode) return;
    downloadMode = true;
    debug(`DOWNLOAD MODE (${reason}): ${location.href}`);

    const started = Date.now();
    let scans = 0;
    let loggedComponent = false;
    let captureClickSent = false;

    while (Date.now() - started < 90000) {
      scans++;
      const component = document.querySelector('mod-file-download');

      if (component && !loggedComponent) {
        loggedComponent = true;
        debug(`mod-file-download found: filename="${component.getAttribute('filename') || ''}" file-id="${component.getAttribute('file-id') || ''}" is-nmm-download="${component.getAttribute('is-nmm-download') || ''}"`);
        debug(`download-url="${component.getAttribute('download-url') || ''}"`);
      }

      const button = findSlowDownload();
      if (button) {
        if (downloadMethod === 'manual-urlgrab' || downloadMethod === 'gateway') {
          if (!button.dataset.nexusGatewayClickStarted) {
            button.dataset.nexusGatewayClickStarted = '1';

            const intercepted = await interceptSlowDownload(button, component);
            if (intercepted) return;

            delete button.dataset.nexusGatewayClickStarted;
            debug(`${downloadMethod === 'gateway' ? 'Gateway' : 'URL Grab'} could not resolve nxm:// yet; will retry`);
          }

          const componentUrl = findNxmUrl(component);
          if (componentUrl) {
            debug(`${downloadMethod === 'gateway' ? 'Gateway' : 'URL Grab'} captured nxm:// URL from Nexus: ${componentUrl}`);
            chrome.runtime.sendMessage({ type: 'CAPTURE_URL', url: componentUrl }).catch(() => {});
            busy = false;
            return;
          }

          if (scans === 1 || scans % 5 === 0) {
            debug(`${downloadMethod === 'gateway' ? 'Gateway' : 'URL Grab'} waiting for generated nxm:// URL`);
          }
        } else if (clickSlow(button)) {
          debug('Slow Download click sent; notifying background');
          chrome.runtime.sendMessage({ type: 'DOWNLOAD_STARTED' }).catch(() => {});
          busy = false;
          return;
        }
      }
      if (scans === 1 || scans % 10 === 0)
        debug(`Slow Download scan=${scans}; component=${!!component}; url=${location.href}`);

      await sleep(500);
    }

    debug('TIMEOUT: Slow Download was not exposed after 90 seconds');
    busy = false;
  }

  function watchForDownloadComponent() {
    const check = () => {
      if (!busy || downloadMode) return;
      const component = document.querySelector('mod-file-download');
      if (component) {
        debug('Detected <mod-file-download> dynamically; switching from mod-page handling to DOWNLOAD MODE');
        handleDownloadPage('dynamic component detected');
      }
    };

    try {
      const observer = new MutationObserver(check);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      check();
    } catch (e) {
      debug(`MutationObserver unavailable: ${e.message}`);
    }

    const interval = setInterval(() => {
      if (!busy || downloadMode) {
        clearInterval(interval);
        return;
      }
      check();
    }, 250);
  }

  async function handleModPage() {
    debug('Waiting 3 seconds before reading mod-download-modal');
    await sleep(3000);

    const started = Date.now();
    let scans = 0;
    let manualClicked = false;

    while (Date.now() - started < 45000) {
      scans++;
      const modals = [...document.querySelectorAll('mod-download-modal')];

      if (['manual', 'manual-urlgrab', 'gateway'].includes(downloadMethod) && !manualClicked) {
        const manualButton = findManualAction();
        if (manualButton) {
          debug('Manual option found next to the Vortex option; clicking it');
          clickAction(manualButton);
          manualClicked = true;
          await sleep(500);
          continue;
        }
      }

      const usable = modals.map((modal, index) => ({
        modal, index, file: parseFile(modal)
      })).filter(x => ['manual', 'manual-urlgrab', 'gateway'].includes(downloadMethod)
        ? x.file?.downloadUrl
        : x.file?.vortexDownloadUrl);

      if (usable.length) {
        const selected = usable[0];
        const url = ['manual', 'manual-urlgrab', 'gateway'].includes(downloadMethod)
          ? selected.file.downloadUrl
          : selected.file.vortexDownloadUrl;

        const captureMode = downloadMethod === 'gateway' || downloadMethod === 'manual-urlgrab';

        debug(`Exact ${captureMode ? (downloadMethod === 'gateway' ? 'Gateway' : 'Manual URL Grab') : (downloadMethod === 'manual' ? 'Manual' : 'Vortex')} URL available: ${url}`);

        chrome.runtime.sendMessage({
          type: 'NAVIGATE_DOWNLOAD',
          url,
          method: downloadMethod
        }).catch(e => debug(`Navigation request failed: ${e.message}`));
        return;
      }

      if (scans === 1 || scans % 10 === 0)
        debug(`mod-download-modal scan=${scans}; method=${downloadMethod}; usable=${usable.length}; manualClicked=${manualClicked}`);
      await sleep(500);
    }

    debug(`TIMEOUT: usable ${downloadMethod === 'manual' ? 'Manual' : 'Vortex'} URL after 45 seconds`);
    busy = false;
  }

  async function run() {
    if (busy) return;
    busy = true;
    debug(`Content script loaded: ${location.href}; readyState=${document.readyState}`);
    const state = await new Promise(resolve => chrome.storage.local.get(KEY, data => resolve(data[KEY] || {})));
    downloadMethod = ['vortex', 'manual', 'manual-urlgrab', 'gateway'].includes(state.downloadMethod) ? state.downloadMethod : 'vortex';
    downloadResolveUrl = typeof state.downloadResolveUrl === 'string' ? state.downloadResolveUrl : '';
    debug(`Download method: ${downloadMethod}`);

    if (isDownloadUrl()) {
      await handleDownloadPage('URL detected');
      return;
    }

    // Nexus can redirect the API request into a download UI without changing
    // the visible pathname. Detect the actual <mod-file-download> component
    // instead of relying on the URL.
    if (document.querySelector('mod-file-download')) {
      await handleDownloadPage('component already present');
      return;
    }

    watchForDownloadComponent();
    await handleModPage();
  }

  debug('Content script initialized');

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'CAPTURE_URL_FROM_NETWORK') return;

    const url = typeof message.url === 'string' ? message.url.trim() : '';
    if (!/^nxm:\/\//i.test(url)) return;

    debug(`Intercepted network NXM URL: ${url}`);
    chrome.runtime.sendMessage({ type: 'CAPTURE_URL', url }).catch(() => {});
  });

  chrome.storage.local.get(KEY, ({ nexusQueueState: state }) => {
    if (!state?.running) {
      debug('Queue not running');
      return;
    }
    debug(`Queue running: index=${state.index}; total=${state.urls?.length || 0}`);
    run();
  });
})();
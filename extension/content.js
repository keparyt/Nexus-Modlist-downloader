(() => {
  if (!location.hostname.endsWith('nexusmods.com')) return;

  const KEY = 'nexusQueueState';
  let busy = false;
  let downloadMode = false;
  let downloadMethod = 'vortex';
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
      debug('Slow Download .click() completed');
      return true;
    } catch (e) {
      debug(`Slow Download .click() failed: ${e.message}`);
      return false;
    }
  };

  async function handleDownloadPage(reason = 'detected') {
    if (downloadMode) return;
    downloadMode = true;
    debug(`DOWNLOAD MODE (${reason}): ${location.href}`);

    const started = Date.now();
    let scans = 0;
    let loggedComponent = false;

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
          const componentUrl = component?.getAttribute('download-url') || '';
          if (componentUrl) {
            debug(`${downloadMethod === 'gateway' ? 'Gateway' : 'URL Grab'} found final download URL: ${componentUrl}`);
            // CAPTURE_URL atomically records the URL and starts the queue wait.
            // Keeping this as one message prevents a race that could overwrite the
            // captured URL with an older background state.
            chrome.runtime.sendMessage({ type: 'CAPTURE_URL', url: componentUrl }).catch(() => {});
            busy = false;
            return;
          }
          debug(`${downloadMethod === 'gateway' ? 'Gateway' : 'URL Grab'}: Slow Download is visible but download-url is not available yet`);
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

        debug(`Exact ${['manual', 'manual-urlgrab', 'gateway'].includes(downloadMethod) ? 'Manual' : 'Vortex'} URL available: ${url}`);
        debug(`Sending ${['manual', 'manual-urlgrab', 'gateway'].includes(downloadMethod) ? 'Manual' : 'Vortex'} URL to background for queue-tab navigation`);
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

  chrome.storage.local.get(KEY, ({ nexusQueueState: state }) => {
    if (!state?.running) {
      debug('Queue not running');
      return;
    }
    debug(`Queue running: index=${state.index}; total=${state.urls?.length || 0}`);
    run();
  });
})();
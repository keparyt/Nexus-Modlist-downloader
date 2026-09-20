(() => {
  if (!location.hostname.endsWith('nexusmods.com')) return;

  const KEY = 'nexusQueueState';
  let busy = false;
  let downloadMode = false;
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

    let nodes = [];
    try { nodes = [...root.querySelectorAll('*')]; } catch {}
    for (const node of nodes) {
      try {
        if (node.shadowRoot) allRoots(node.shadowRoot, path + ' > ' + node.tagName.toLowerCase() + '::shadow', out, seen);
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

  async function handleDownloadPage() {
    downloadMode = true;
    debug(`DOWNLOAD MODE: ${location.href}`);

    const started = Date.now();
    let lastSignature = '';
    let scans = 0;

    while (Date.now() - started < 90000) {
      scans++;
      const component = document.querySelector('mod-file-download');

      if (component && !lastSignature) {
        lastSignature = [
          component.getAttribute('filename'),
          component.getAttribute('file-id'),
          component.getAttribute('is-nmm-download'),
          component.getAttribute('download-url')
        ].join('|');
        debug(`mod-file-download found: ${lastSignature}`);
      }

      const button = findSlowDownload();
      if (button) {
        if (clickSlow(button)) {
          debug('Slow Download click sent; waiting for downloadStarted/download state');
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

  async function handleModPage() {
    debug('Waiting 3 seconds before reading mod-download-modal');
    await sleep(3000);

    const started = Date.now();
    let scans = 0;
    while (Date.now() - started < 45000) {
      scans++;
      const modals = [...document.querySelectorAll('mod-download-modal')];
      const usable = modals.map((modal, index) => ({
        modal, index, file: parseFile(modal)
      })).filter(x => x.file?.vortexDownloadUrl);

      if (usable.length) {
        const selected = usable[0];
        const url = selected.file.vortexDownloadUrl;
        debug(`Exact Vortex URL available: ${url}`);
        debug('Sending Vortex URL to background for queue-tab navigation');
        chrome.runtime.sendMessage({ type: 'NAVIGATE_DOWNLOAD', url }).catch(e =>
          debug(`Navigation request failed: ${e.message}`));
        return;
      }

      if (scans === 1 || scans % 10 === 0)
        debug(`mod-download-modal scan=${scans}; usable=${usable.length}`);
      await sleep(500);
    }

    debug('TIMEOUT: usable mod-download-modal after 45 seconds');
    busy = false;
  }

  async function run() {
    if (busy) return;
    busy = true;
    debug(`Content script loaded: ${location.href}; readyState=${document.readyState}`);

    if (isDownloadUrl()) {
      await handleDownloadPage();
      return;
    }

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
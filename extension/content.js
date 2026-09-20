(() => {
  if (!location.hostname.endsWith('nexusmods.com')) return;

  const KEY = 'nexusQueueState';
  let busy = false;
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const debug = text => {
    const message = `[${location.pathname}] ${text}`;
    console.debug('[Nexus Modlist Downloader]', message);
    chrome.runtime.sendMessage({ type: 'STEP_LOG', text: message }).catch(() => {});
  };

  const parseFile = modal => {
    const raw = modal?.getAttribute('file');
    if (!raw) return null;
    try { return JSON.parse(raw); }
    catch (e) {
      debug(`Failed to parse mod-download-modal file attribute: ${e.message}`);
      return null;
    }
  };

  const findUsableModal = () => {
    const modals = [...document.querySelectorAll('mod-download-modal')];
    const usable = modals.map((modal, index) => ({
      modal,
      index,
      file: parseFile(modal)
    })).filter(x =>
      x.file?.vortexDownloadUrl &&
      x.modal.getAttribute('show-vortex-button') !== 'false'
    );

    debug(`mod-download-modal count=${modals.length}; usable=${usable.length}`);

    if (!usable.length) return null;

    // Prefer a modal that represents a real downloadable file and has an actual
    // Nexus API Vortex URL. This avoids depending on the rendered Vortex button.
    const selected = usable[0];
    debug(`Selected modal #${selected.index}: name="${selected.file.name || ''}" uid=${selected.file.uid || ''}`);
    debug(`available: ${selected.file.vortexDownloadUrl}`);

    return selected;
  };

  const findSlowDownload = () => {
    const selectors = [
      '#upsell-cards button',
      '#upsell-cards a',
      '#upsell-cards [role="button"]',
      'button',
      'a',
      '[role="button"]'
    ];

    const seen = new Set();
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (seen.has(el)) continue;
        seen.add(el);

        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' ||
            style.opacity === '0' || rect.width <= 0 || rect.height <= 0) continue;

        const text = norm(el.textContent);
        const aria = norm(el.getAttribute('aria-label'));
        if (text.includes('slow download') || aria.includes('slow download')) return el;
      }
    }
    return null;
  };

  const clickNative = (el, label) => {
    try {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.click();
      debug(`${label}: native click on <${el.tagName.toLowerCase()}> text="${norm(el.textContent).slice(0,100)}"`);
      return true;
    } catch (e) {
      debug(`${label}: native click failed: ${e.message}`);
      try {
        el.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window
        }));
        return true;
      } catch (e2) {
        debug(`${label}: fallback click failed: ${e2.message}`);
        return false;
      }
    }
  };

  async function handleDownloadPage() {
    debug(`Download page detected: ${location.href}`);

    const started = Date.now();
    let scans = 0;

    while (Date.now() - started < 45000) {
      scans++;
      const button = findSlowDownload();

      if (button) {
        if (clickNative(button, 'Slow download')) {
          debug('Slow download clicked; notifying background');
          chrome.runtime.sendMessage({ type: 'DOWNLOAD_STARTED' }).catch(() => {});
          busy = false;
          return;
        }
      }

      if (scans === 1 || scans % 10 === 0)
        debug(`Slow download scan=${scans}; waiting for button`);

      await sleep(500);
    }

    debug('TIMEOUT: Slow download after 45 seconds');
    busy = false;
  }

  async function handleModPage() {
    debug('Waiting 3 seconds before reading mod-download-modal');
    await sleep(3000);

    const started = Date.now();
    let scans = 0;

    while (Date.now() - started < 45000) {
      scans++;
      const selected = findUsableModal();

      if (selected) {
        const vortexUrl = selected.file.vortexDownloadUrl;

        // The file attribute is the authoritative source for the Vortex URL.
        // Navigate directly instead of trying to find/click a shadow-DOM button.
        debug(`Exact Vortex URL available: ${vortexUrl}`);
        debug('Navigating directly to the Vortex download URL');
        location.assign(vortexUrl);
        return;
      }

      if (scans === 1 || scans % 10 === 0)
        debug(`mod-download-modal scan=${scans}; waiting for file data`);

      await sleep(500);
    }

    debug('TIMEOUT: usable mod-download-modal after 45 seconds');
    busy = false;
  }

  async function run() {
    if (busy) return;
    busy = true;

    debug(`Started URL=${location.href}; readyState=${document.readyState}`);

    if (/\/download(?:[/?]|$)/i.test(location.pathname)) {
      await handleDownloadPage();
      return;
    }

    await handleModPage();
  }

  debug('Content script loaded');

  chrome.storage.local.get(KEY, ({ nexusQueueState: state }) => {
    debug(`Queue running=${!!state?.running}, index=${state?.index ?? 'n/a'}, total=${state?.urls?.length ?? 0}`);
    if (state?.running) run();
  });
})();
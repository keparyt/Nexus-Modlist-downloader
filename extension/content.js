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

  const visible = el => {
    if (!el) return false;
    try {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' &&
        r.width > 0 && r.height > 0;
    } catch { return false; }
  };

  const parseFile = modal => {
    const raw = modal?.getAttribute('file');
    if (!raw) return null;
    try { return JSON.parse(raw); }
    catch (e) {
      debug(`mod-download-modal file JSON parse failed: ${e.message}`);
      return null;
    }
  };

  function collectRoots(start) {
    const result = [];
    const seen = new Set();

    const walk = (root, path) => {
      if (!root || seen.has(root)) return;
      seen.add(root);
      result.push({ root, path });

      let nodes = [];
      try { nodes = [...root.querySelectorAll('*')]; } catch {}
      for (const node of nodes) {
        if (node.shadowRoot) {
          walk(node.shadowRoot, path + ' > ' + node.tagName.toLowerCase() + '::shadow');
        }
      }
    };

    walk(start, start === document ? 'document' : 'component');
    return result;
  }

  const findUsableModal = () => {
    const modals = [...document.querySelectorAll('mod-download-modal')];
    const usable = modals.map((modal, index) => ({
      modal, index, file: parseFile(modal)
    })).filter(x =>
      x.file?.vortexDownloadUrl &&
      x.modal.getAttribute('show-vortex-button') !== 'false'
    );

    debug(`mod-download-modal count=${modals.length}; usable=${usable.length}`);

    if (!usable.length) return null;

    const selected = usable[0];
    debug(`Selected modal #${selected.index}: name="${selected.file.name || ''}" uid=${selected.file.uid || ''}`);
    debug(`available: ${selected.file.vortexDownloadUrl}`);
    return selected;
  };

  const findSlowDownload = () => {
    const component = document.querySelector('mod-file-download');

    if (!component) return null;

    const roots = collectRoots(component);
    const selectors = [
      '#upsell-cards button',
      '#upsell-cards a',
      '#upsell-cards [role="button"]',
      'button',
      'a',
      '[role="button"]',
      '[part]'
    ];

    const candidates = [];
    const seen = new Set();

    for (const { root, path } of roots) {
      for (const selector of selectors) {
        let elements = [];
        try { elements = [...root.querySelectorAll(selector)]; } catch {}

        for (const el of elements) {
          if (seen.has(el)) continue;
          seen.add(el);
          if (!visible(el)) continue;

          const text = norm(el.textContent);
          const aria = norm(el.getAttribute('aria-label'));
          const title = norm(el.getAttribute('title'));
          const value = norm(el.getAttribute('value'));
          const dataAction = norm(el.getAttribute('data-action'));

          if (text.includes('slow download') ||
              aria.includes('slow download') ||
              title.includes('slow download') ||
              value.includes('slow download') ||
              dataAction.includes('slow download')) {
            candidates.push({ el, path, score: (text === 'slow download' ? 100 : 0) });
          }
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    if (candidates[0]) {
      debug(`Slow download candidate found in ${candidates[0].path}: tag=<${candidates[0].el.tagName.toLowerCase()}> text="${norm(candidates[0].el.textContent).slice(0,150)}"`);
      return candidates[0].el;
    }

    // Log the component's rendered text once it exists. This is useful when
    // Nexus changes the internal CTA markup.
    const componentText = norm(component.textContent);
    if (componentText.includes('slow download')) {
      debug('Slow download text exists inside <mod-file-download>, but its control is not yet exposed by the component DOM');
    }

    return null;
  };

  const clickNative = (el, label) => {
    try {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
    } catch {}

    try {
      el.focus?.({ preventScroll: true });
    } catch {}

    try {
      el.click();
      debug(`${label}: native click dispatched`);
      return true;
    } catch (e) {
      debug(`${label}: native click failed: ${e.message}`);
    }

    try {
      el.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, composed: true, view: window
      }));
      debug(`${label}: composed click fallback dispatched`);
      return true;
    } catch (e) {
      debug(`${label}: click fallback failed: ${e.message}`);
      return false;
    }
  };

  async function handleDownloadPage() {
    debug(`Download page detected: ${location.href}`);

    const started = Date.now();
    let scans = 0;

    while (Date.now() - started < 60000) {
      scans++;
      const component = document.querySelector('mod-file-download');

      if (component && scans === 1) {
        debug(`<mod-file-download> found: filename="${component.getAttribute('filename') || ''}" file-id="${component.getAttribute('file-id') || ''}" is-nmm-download="${component.getAttribute('is-nmm-download') || ''}"`);
        debug(`download-url="${component.getAttribute('download-url') || ''}"`);
      }

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
        debug(`Slow download scan=${scans}; mod-file-download=${!!component}; waiting for rendered CTA`);

      await sleep(500);
    }

    debug('TIMEOUT: Slow download after 60 seconds');
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
        debug(`Exact Vortex URL available: ${vortexUrl}`);
        debug('Navigating directly to the exact Vortex API URL exposed by mod-download-modal');
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
(() => {
  if (!location.hostname.endsWith('nexusmods.com')) return;

  let busy = false;
  const KEY = 'nexusQueueState';
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const debug = text => {
    const message = `[${location.pathname}] ${text}`;
    console.debug('[Nexus Modlist Downloader]', message);
    chrome.runtime.sendMessage({ type: 'STEP_LOG', text: message }).catch(() => {});
  };

  const isVisible = el => {
    if (!el) return false;
    try {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        rect.width > 0 &&
        rect.height > 0;
    } catch {
      return false;
    }
  };

  const describe = el => {
    if (!el) return 'none';
    let href = '';
    try { href = el.href || el.getAttribute('href') || ''; } catch {}
    return `${el.tagName?.toLowerCase() || 'unknown'} class="${String(el.className || '')}" text="${norm(el.textContent).slice(0, 120)}" href="${href}"`;
  };

  function parseFileAttribute(modal) {
    const raw = modal?.getAttribute('file');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      debug(`mod-download-modal file JSON parse failed: ${error.message}`);
      return null;
    }
  }

  function rootsDeep(root, path = 'document', output = []) {
    output.push({ root, path });
    let elements = [];
    try { elements = [...root.querySelectorAll('*')]; } catch {}
    for (const el of elements) {
      if (el.shadowRoot) {
        rootsDeep(el.shadowRoot, path + ' > ' + el.tagName.toLowerCase() + '::shadow', output);
      }
    }
    return output;
  }

  function allElementsDeep(root = document) {
    const result = [];
    for (const { root: r } of rootsDeep(root)) {
      try { result.push(...r.querySelectorAll('*')); } catch {}
    }
    return result;
  }

  function findModal() {
    const modals = [...document.querySelectorAll('mod-download-modal')];
    const usable = modals.filter(modal => {
      const file = parseFileAttribute(modal);
      return !!file?.vortexDownloadUrl && modal.getAttribute('show-vortex-button') !== 'false';
    });

    debug(`mod-download-modal count=${modals.length}; usable=${usable.length}`);

    if (usable[0]) {
      const file = parseFileAttribute(usable[0]);
      debug(`Selected modal: file="${file?.name || ''}" uid=${file?.uid || ''} vortexUrl="${file?.vortexDownloadUrl || ''}"`);
    }
    return usable[0] || null;
  }

  function findModalDownload(modal) {
    const file = parseFileAttribute(modal);
    const vortexUrl = file?.vortexDownloadUrl || '';

    const roots = rootsDeep(modal);
    const candidates = [];

    for (const { root, path } of roots) {
      let elements = [];
      try {
        elements = [...root.querySelectorAll('a, button, [role="button"]')];
      } catch {}

      for (const el of elements) {
        if (!isVisible(el)) continue;

        const text = norm(el.textContent);
        const aria = norm(el.getAttribute('aria-label'));
        const title = norm(el.getAttribute('title'));
        const href = el.href || el.getAttribute('href') || '';

        const exactVortex = /\/api\/files\/\d+\/download\?nmm=1(?:&|$)/i.test(href) ||
          (vortexUrl && href === vortexUrl);

        const downloadText = text === 'download' || text.startsWith('download ') ||
          aria === 'download' || title === 'download';

        if (exactVortex || downloadText) {
          candidates.push({
            el,
            path,
            score: (exactVortex ? 1000 : 0) +
              (href === vortexUrl ? 500 : 0) +
              (text === 'download' ? 200 : 0) +
              (el.tagName.toLowerCase() === 'button' ? 50 : 0)
          });
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    debug(`Modal Download candidates=${candidates.length}`);
    if (candidates[0]) {
      debug(`Selected modal download: ${describe(candidates[0].el)} root=${candidates[0].path}`);
      return candidates[0].el;
    }

    if (vortexUrl) {
      debug(`No rendered Download control found; exact vortexDownloadUrl is available: ${vortexUrl}`);
    }

    return null;
  }

  function nativeClick(el, label) {
    try {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
    } catch {}

    try {
      el.focus?.({ preventScroll: true });
    } catch {}

    try {
      el.click();
      debug(`${label}: native .click() dispatched on ${describe(el)}`);
      return true;
    } catch (error) {
      debug(`${label}: native .click() failed: ${error.message}`);
    }

    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      try {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window
        }));
      } catch {}
    }

    debug(`${label}: fallback mouse events dispatched on ${describe(el)}`);
    return true;
  }

  function clickWhenFound(finder, label, timeout = 30000) {
    return new Promise(resolve => {
      const started = Date.now();
      let scans = 0;

      const scan = () => {
        scans++;

        let result = null;
        try { result = finder(); } catch (error) {
          debug(`${label}: finder error=${error.message}`);
        }

        const el = result?.el || result;
        if (scans === 1 || scans % 5 === 0) {
          debug(`${label}: scan=${scans}; candidate=${describe(el)}`);
        }

        if (el) {
          const clicked = nativeClick(el, label);
          resolve(clicked);
          return;
        }

        if (Date.now() - started >= timeout) {
          debug(`TIMEOUT: ${label} after ${scans} scans`);
          resolve(false);
          return;
        }

        setTimeout(scan, 400);
      };

      debug(`Waiting for ${label}`);
      scan();
    });
  }

  function findSlowDownload() {
    const elements = [
      ...document.querySelectorAll('#upsell-cards button, #upsell-cards a, button, a, [role="button"]')
    ];

    return elements.find(el => {
      if (!isVisible(el)) return false;
      const text = norm(el.textContent);
      const aria = norm(el.getAttribute('aria-label'));
      return text.includes('slow download') || aria.includes('slow download');
    });
  }

  async function handleDownloadPage() {
    debug(`Download page detected: ${location.href}`);

    const ok = await clickWhenFound(findSlowDownload, 'Slow download', 45000);
    if (!ok) {
      debug('Slow download was not found; current queue item will remain pending');
      busy = false;
      return;
    }

    debug('Slow download clicked; notifying background');
    chrome.runtime.sendMessage({ type: 'DOWNLOAD_STARTED' }).catch(() => {});
    busy = false;
  }

  async function handleModPage() {
    debug('Waiting 3 seconds before inspecting mod-download-modal');
    await sleep(3000);

    const modal = await new Promise(resolve => {
      const started = Date.now();
      let scans = 0;

      const scan = () => {
        scans++;
        const found = findModal();

        if (found) {
          resolve(found);
          return;
        }

        if (Date.now() - started >= 45000) {
          debug(`TIMEOUT: mod-download-modal after ${scans} scans`);
          resolve(null);
          return;
        }

        setTimeout(scan, 500);
      };

      scan();
    });

    if (!modal) {
      debug('No usable mod-download-modal found; stopping current item');
      busy = false;
      return;
    }

    const file = parseFileAttribute(modal);
    const vortexUrl = file?.vortexDownloadUrl || '';

    debug(`Modal file="${file?.name || ''}" uid=${file?.uid || ''}`);
    debug(`Exact Vortex download URL=${vortexUrl}`);

    const download = await new Promise(resolve => {
      const started = Date.now();
      let scans = 0;

      const scan = () => {
        scans++;
        const found = findModalDownload(modal);

        if (found) {
          resolve(found);
          return;
        }

        if (Date.now() - started >= 15000) {
          debug(`Rendered Download control not found after ${scans} scans`);
          resolve(null);
          return;
        }

        setTimeout(scan, 400);
      };

      scan();
    });

    if (download) {
      const ok = nativeClick(download, 'Modal Download');
      if (ok) {
        debug('Modal Download clicked; waiting for Nexus download navigation');
        busy = false;
        return;
      }
    }

    if (vortexUrl) {
      debug('Falling back to exact vortexDownloadUrl navigation');
      debug('Navigating directly to the URL exposed by mod-download-modal');
      location.href = vortexUrl;
      return;
    }

    debug('No Vortex download URL available; stopping current item');
    busy = false;
  }

  async function run() {
    if (busy) {
      debug('Already busy; ignoring duplicate run');
      return;
    }

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

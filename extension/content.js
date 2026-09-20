(() => {
  if (!location.hostname.endsWith('nexusmods.com')) return;

  let busy = false;
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const isVisible = el => {
    if (!el) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      rect.width > 0 && rect.height > 0;
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const debug = text => {
    const message = `[${location.pathname}] ${text}`;
    console.debug('[Nexus Modlist Downloader]', message);
    chrome.runtime.sendMessage({ type: 'STEP_LOG', text: message });
  };
  const describe = el => el ? `${el.tagName.toLowerCase()} class="${el.className || ''}" text="${norm(el.textContent).slice(0, 120)}" href="${el.href || ''}"` : 'none';

  const findVortex = () => {
    const elements = [...document.querySelectorAll('.nxm-button.nxm-button-flamework')];
    const candidates = elements.filter(el => {
      if (!isVisible(el)) return false;
      const text = norm(el.textContent);
      const aria = norm(el.getAttribute('aria-label'));
      const title = norm(el.getAttribute('title'));
      return text === 'vortex' || aria === 'vortex' || title === 'vortex' ||
        (text.includes('vortex') && !text.includes('discover'));
    });
    debug(`Vortex class candidates=${candidates.length}; all matching elements=${elements.length}; selected=${describe(candidates[0])}`);
    return candidates[0] || null;
  };

  const clickWhenFound = (finder, label, timeout = 30000) => new Promise(resolve => {
    const started = Date.now();
    let scans = 0;
    const scan = () => {
      scans++;
      let el = null;
      try { el = finder(); } catch (error) { debug(`${label}: finder error=${error.message}`); }
      if (scans === 1 || scans % 5 === 0) debug(`${label}: scan=${scans}; candidate=${describe(el)}`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        if (el.tagName.toLowerCase() === 'span') el = el.closest('button, a, [role="button"]') || el;
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type =>
          el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
        );
        debug(`${label}: clicked ${describe(el)}`);
        resolve(true);
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

  async function run() {
    if (busy) return;
    busy = true;
    debug(`Started URL=${location.href}; readyState=${document.readyState}`);

    if (location.pathname.includes('/download')) {
      const ok = await clickWhenFound(
        () => [...document.querySelectorAll('#upsell-cards button, button')]
          .find(button => isVisible(button) && norm(button.textContent).includes('slow download')),
        'Slow download'
      );
      if (ok) {
        debug('Slow download clicked; notifying background');
        chrome.runtime.sendMessage({ type: 'DOWNLOAD_STARTED' });
      }
      busy = false;
      return;
    }

    debug('Waiting 3 seconds before searching for Vortex');
    await sleep(3000);
    const vortex = await clickWhenFound(findVortex, 'Vortex');
    if (!vortex) {
      debug('Vortex not found; stopping current URL');
      busy = false;
      return;
    }

    const download = await clickWhenFound(
      () => [...document.querySelectorAll('button, a')].find(el =>
        isVisible(el) && norm(el.textContent) === 'download' &&
        (/\/download\?nmm=1/i.test(el.href || '') || el.closest('.nxm-modal-body'))
      ),
      'Modal Download'
    );
    if (!download) debug('Modal Download not found');
    busy = false;
  }

  debug('Content script loaded');
  chrome.storage.local.get('nexusQueueState', ({ nexusQueueState: state }) => {
    debug(`Queue running=${!!state?.running}, index=${state?.index ?? 'n/a'}`);
    if (state?.running) run();
  });
})();
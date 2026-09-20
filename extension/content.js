(() => {
  if (!location.hostname.endsWith('nexusmods.com')) return;
  let busy = false;
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visible = el => !!(el && (el.getClientRects().length || el.getBoundingClientRect().width || el.getBoundingClientRect().height));
  const debug = text => {
    const message = `[${location.pathname}] ${text}`;
    console.log('[Nexus Modlist Downloader]', message);
    try { chrome.runtime.sendMessage({ type: 'STEP_LOG', text: message }); } catch (_) {}
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const describe = el => {
    if (!el) return 'none';
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} text="${norm(el.innerText || el.textContent).slice(0, 160)}" aria="${el.getAttribute('aria-label') || ''}" title="${el.getAttribute('title') || ''}" href="${el.href || ''}"`;
  };
  const realClick = el => {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });
  };
  const clickWhenFound = (finder, label, timeout = 30000) => new Promise(resolve => {
    const started = Date.now(); let scans = 0;
    const scan = () => {
      scans++; let el = null;
      try { el = finder(); } catch (error) { debug(`${label}: finder error ${error.message}`); }
      if (scans === 1 || scans % 5 === 0) debug(`${label}: scan=${scans}, candidate=${describe(el)}, visible=${visible(el)}`);
      if (el && visible(el)) {
        debug(`${label}: clicking ${describe(el)}`);
        realClick(el); debug(`${label}: click dispatched`); resolve(true); return;
      }
      if (Date.now() - started > timeout) { debug(`TIMEOUT ${label} after ${scans} scans`); resolve(false); return; }
      setTimeout(scan, 400);
    };
    debug(`Waiting for ${label}`); scan();
  });
  const findVortex = () => {
    const all = [...document.querySelectorAll('button, a, span, [role="button"]')];
    const candidates = all.filter(el => {
      const text = norm(el.innerText || el.textContent);
      const aria = norm(el.getAttribute('aria-label'));
      const title = norm(el.getAttribute('title'));
      return text === 'vortex' || text.includes('vortex') || aria.includes('vortex') || title.includes('vortex');
    });
    const best = candidates.find(el => ['BUTTON', 'A'].includes(el.tagName) || el.getAttribute('role') === 'button') || candidates[0];
    if (candidates.length) debug(`Vortex candidates=${candidates.length}; selected=${describe(best)}`);
    return best;
  };
  async function run() {
    if (busy) return; busy = true;
    debug(`Started URL=${location.href}; readyState=${document.readyState}`);
    if (location.pathname.includes('/download')) {
      const ok = await clickWhenFound(() => [...document.querySelectorAll('#upsell-cards button, button')].find(b => norm(b.innerText || b.textContent).includes('slow download')), 'Slow download');
      if (ok) chrome.runtime.sendMessage({ type: 'DOWNLOAD_STARTED' });
      busy = false; return;
    }
    await sleep(3000);
    debug('Searching for Vortex after 3-second delay');
    const vortex = await clickWhenFound(findVortex, 'Vortex');
    if (!vortex) { debug('Vortex not found'); busy = false; return; }
    await clickWhenFound(() => [...document.querySelectorAll('button, a')].find(e => norm(e.innerText || e.textContent) === 'download' && (/\/download\?nmm=1/i.test(e.href || '') || e.closest('.nxm-modal-body'))), 'Modal Download');
    busy = false;
  }
  debug('Content script loaded');
  chrome.storage.local.get('nexusQueueState', ({ nexusQueueState: state }) => { debug(`Queue running=${!!state?.running}, index=${state?.index ?? 'n/a'}`); if (state?.running) run(); });
})();

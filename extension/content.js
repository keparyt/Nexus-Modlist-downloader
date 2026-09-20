(() => {
  if (!location.hostname.endsWith('nexusmods.com')) return;
  let busy = false;
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visible = el => !!(el && el.offsetParent !== null);
  const debug = text => {
    const message = `[${location.pathname}] ${text}`;
    console.debug('[Nexus Modlist Downloader]', message);
    chrome.runtime.sendMessage({ type: 'STEP_LOG', text: message });
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const describe = el => {
    if (!el) return 'none';
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().replace(/\s+/g, '.')}` : ''} text="${norm(el.textContent).slice(0, 120)}" href="${el.href || ''}"`;
  };

  const clickWhenFound = (finder, label, timeout = 30000) => new Promise(resolve => {
    const started = Date.now();
    let scans = 0;
    const scan = () => {
      scans++;
      let el = null;
      try { el = finder(); } catch (error) { debug(`${label}: finder error: ${error.message}`); }
      if (scans === 1 || scans % 5 === 0) debug(`${label}: scan ${scans}, candidate=${describe(el)}, visible=${visible(el)}`);
      if (el && visible(el)) {
        debug(`${label}: clicking ${describe(el)}`);
        el.click();
        debug(`${label}: click completed`);
        resolve(true);
        return;
      }
      if (Date.now() - started > timeout) {
        debug(`TIMEOUT: ${label} after ${scans} scans`);
        resolve(false);
        return;
      }
      setTimeout(scan, 400);
    };
    debug(`Waiting for: ${label}`);
    scan();
  });

  async function run() {
    if (busy) { debug('Already busy; skipping duplicate run'); return; }
    busy = true;
    debug(`Started processing. URL=${location.href}`);
    debug(`Document readyState=${document.readyState}, buttons=${document.querySelectorAll('button').length}, links=${document.querySelectorAll('a').length}`);

    if (location.pathname.includes('/download')) {
      debug('Download page detected; searching for Slow download');
      const ok = await clickWhenFound(
        () => [...document.querySelectorAll('#upsell-cards button, button')]
          .find(b => norm(b.textContent).includes('slow download')),
        'Slow download'
      );
      if (ok) {
        debug('Slow download clicked; notifying background worker');
        chrome.runtime.sendMessage({ type: 'DOWNLOAD_STARTED' });
      } else {
        debug('Slow download was not clicked; queue will not advance');
      }
      busy = false;
      return;
    }

    debug('Mod page detected; waiting 3 seconds before clicking Vortex');
    await sleep(3000);
    debug('3-second page-load delay finished; searching for Vortex');

    const vortex = await clickWhenFound(
      () => [...document.querySelectorAll('span, button, a')]
        .find(e => norm(e.textContent) === 'vortex'),
      'Vortex'
    );
    if (!vortex) {
      debug('Vortex button not found; stopping this URL');
      busy = false;
      return;
    }

    debug('Vortex clicked; waiting for modal Download button');
    const download = await clickWhenFound(
      () => [...document.querySelectorAll('button, a')]
        .find(e => norm(e.textContent) === 'download' && (/\/download\?nmm=1/i.test(e.href || '') || e.closest('.nxm-modal-body'))),
      'Modal Download'
    );
    if (!download) debug('Modal Download button not found; queue will not advance');
    busy = false;
  }

  debug('Content script loaded');
  chrome.storage.local.get('nexusQueueState', ({ nexusQueueState: state }) => {
    debug(`Queue state: running=${!!state?.running}, index=${state?.index ?? 'n/a'}, total=${state?.urls?.length ?? 0}`);
    if (state?.running) run();
    else debug('Queue is not running; idle');
  });
})();

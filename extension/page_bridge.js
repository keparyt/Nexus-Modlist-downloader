(() => {
  'use strict';

  let mode = 'vortex';

  const post = (type, payload = {}) => {
    window.postMessage({
      source: 'NexusModlistDownloaderBridge',
      type,
      ...payload
    }, '*');
  };

  const normalizeNxm = value => {
    const text = String(value || '').trim();
    return /^nxm:\/\//i.test(text) ? text : '';
  };

  const parseResponse = text => {
    if (!text) return '';

    const raw = String(text)
      .replace(/&amp;/g, '&')
      .replace(/\\\//g, '/')
      .replace(/\\u0026/g, '&');

    try {
      const data = JSON.parse(raw);
      const url = normalizeNxm(
        data?.url ||
        data?.downloadUrl ||
        data?.downloadURL ||
        data?.data?.url
      );
      if (url) return url;
    } catch {}

    const match = raw.match(/nxm:\/\/[^\s"'<>]+/i);
    return match ? normalizeNxm(match[0]) : '';
  };

  const getComponentFromPath = path => {
    for (const node of path || []) {
      if (node?.tagName?.toLowerCase?.() === 'mod-file-download') {
        return node;
      }
    }
    return document.querySelector('mod-file-download');
  };

  const findSlowInPath = path => {
    for (const node of path || []) {
      const text = String(node?.textContent || '').trim().toLowerCase();
      const label = String(
        node?.getAttribute?.('aria-label') ||
        node?.getAttribute?.('title') ||
        node?.getAttribute?.('data-testid') ||
        ''
      ).toLowerCase();

      if (
        (node?.tagName?.toLowerCase?.() === 'button' ||
          node?.getAttribute?.('role') === 'button' ||
          node?.tagName?.toLowerCase?.() === 'a') &&
        (text.includes('slow download') ||
          label.includes('slow download') ||
          label.includes('slow_download'))
      ) {
        return node;
      }
    }
    return null;
  };

  async function generate(component) {
    const fileId = component?.getAttribute('file-id') || '';
    const gameId = component?.getAttribute('game-id') || '';

    if (!fileId || !gameId) {
      post('NXM_ERROR', {
        error: 'Missing file-id or game-id',
        fileId,
        gameId
      });
      return;
    }

    try {
      post('SLOW_CLICK_ACCEPTED', { fileId, gameId });

      const body = `fid=${encodeURIComponent(fileId)}&game_id=${encodeURIComponent(gameId)}`;

      const response = await fetch(
        '/Core/Libs/Common/Managers/Downloads?GenerateDownloadUrl',
        {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
          },
          body
        }
      );

      const text = await response.text();
      post('GENERATE_RESPONSE', {
        status: response.status,
        responsePreview: text.slice(0, 500)
      });

      if (!response.ok) {
        post('NXM_ERROR', {
          error: `GenerateDownloadUrl HTTP ${response.status}`,
          responsePreview: text.slice(0, 500)
        });
        return;
      }

      let data = null;
      try {
        data = JSON.parse(text);
      } catch {}

      const candidates = [
        data?.url,
        data?.downloadUrl,
        data?.downloadURL
      ];

      let url = '';
      for (const value of candidates) {
        url = normalizeNxm(value);
        if (url) break;
      }

      if (!url) {
        const match = text
          .replace(/&amp;/g, '&')
          .match(/nxm:\/\/[^\s"'<>]+/i);
        url = match ? normalizeNxm(match[0]) : '';
      }

      if (!url) {
        post('NXM_ERROR', {
          error: 'GenerateDownloadUrl returned no nxm:// URL',
          responsePreview: text.slice(0, 500)
        });
        return;
      }

      post('NXM_CAPTURED', { url });
    } catch (error) {
      post('NXM_ERROR', {
        error: error.message
      });
    }
  };

  window.addEventListener('message', event => {
    if (event.source !== window || !event.data) return;
    if (event.data.source !== 'NexusModlistDownloaderExtension') return;

    if (event.data.type === 'SET_MODE') {
      mode = String(event.data.mode || 'vortex');
      return;
    }

    if (event.data.type === 'GENERATE_FROM_COMPONENT') {
      const component = document.querySelector('mod-file-download');
      if (component) {
        generate(component);
      }
    }
  });

  document.addEventListener('click', event => {
    if (!['gateway', 'manual-urlgrab'].includes(mode)) return;

    const path = event.composedPath?.() || [];
    const button = findSlowInPath(path);
    if (!button) return;

    const component = getComponentFromPath(path);
    if (!component) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    post('SLOW_CLICK_INTERCEPTED', {
      fileId: component.getAttribute('file-id') || '',
      gameId: component.getAttribute('game-id') || ''
    });

    generate(component);
  }, true);
})();

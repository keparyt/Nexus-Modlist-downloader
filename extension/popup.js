const $ = id => document.getElementById(id);

const example = [
  100, 95, 93, 92, 89, 87, 86, 79, 76, 51,
  229, 228, 220, 219, 215, 216, 217, 210, 201, 178,
  177, 163, 140, 138, 131, 120, 119, 117, 115, 101
].map(id => 'https://www.nexusmods.com/supermarkettogether/mods/' + id);

function parse(raw) {
  const value = String(raw || '').trim();
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch (error) {
    console.debug('Input is not JSON; using line parsing.');
  }

  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function validNexusUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' &&
      parsed.hostname === 'www.nexusmods.com' &&
      /\/mods\/\d+/i.test(parsed.pathname);
  } catch (error) {
    return false;
  }
}

async function refresh() {
  const result = await chrome.storage.local.get('nexusQueueState');
  const state = result.nexusQueueState;

  if (!state) {
    $('status').textContent = 'Idle';
    $('count').textContent = '0 URL(s)';
    $('captured').value = '';
    $('log').textContent = '';
    return;
  }

  if (state.running) {
    const current = Math.min((state.index || 0) + 1, (state.urls || []).length);
    $('status').textContent = state.downloadWaiting
      ? 'Waiting 10s - ' + current + '/' + state.urls.length
      : 'Running - ' + current + '/' + state.urls.length;
  } else {
    $('status').textContent = state.index >= state.urls.length && state.urls.length
      ? 'Completed'
      : 'Idle / Stopped';
  }

  $('count').textContent = (state.urls || []).length + ' URL(s)';
  $('captured').value = (state.capturedUrls || []).join('\n');
  $('log').textContent = (state.log || []).join('\n');
  $('log').scrollTop = $('log').scrollHeight;
}

$('load').addEventListener('click', async () => {
  $('list').value = JSON.stringify(example, null, 2);
  $('status').textContent = 'Example list loaded';
  await refresh();
});

$('start').addEventListener('click', async () => {
  const rawUrls = parse($('list').value);
  const urls = [...new Set(rawUrls.filter(validNexusUrl))];
  const rejected = rawUrls.length - urls.length;

  if (!urls.length) {
    $('status').textContent = 'No valid Nexus mod URLs';
    return;
  }

  const gatewayUrl = $('gatewayUrl').value.trim() || 'http://127.0.0.1:8765';
  await chrome.storage.local.set({ nexusGatewayUrl: gatewayUrl });

  try {
    await chrome.runtime.sendMessage({
      type: 'START',
      urls: urls,
      downloadMethod: $('method').value,
      gatewayUrl: gatewayUrl
    });
    $('status').textContent = 'Starting ' + urls.length + ' URL(s)';
  } catch (error) {
    $('status').textContent = 'Start failed: ' + error.message;
    console.error(error);
  }

  if (rejected) {
    $('status').textContent += ' - ignored ' + rejected + ' invalid URL(s)';
  }
  await refresh();
});

$('stop').addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'STOP' });
    $('status').textContent = 'Stopped';
  } catch (error) {
    $('status').textContent = 'Stop failed: ' + error.message;
    console.error(error);
  }
  await refresh();
});

chrome.storage.local.get('nexusGatewayUrl', data => {
  if (data.nexusGatewayUrl) $('gatewayUrl').value = data.nexusGatewayUrl;
});

$('gatewayUrl').addEventListener('change', () => {
  chrome.storage.local.set({
    nexusGatewayUrl: $('gatewayUrl').value.trim() || 'http://127.0.0.1:8765'
  });
});

$('copyCaptured').addEventListener('click', async () => {
  const result = await chrome.storage.local.get('nexusQueueState');
  const urls = (result.nexusQueueState?.capturedUrls || []).join('\n');
  if (!urls) return;
  await navigator.clipboard.writeText(urls);
  $('copyCaptured').textContent = 'Copied';
  setTimeout(() => { $('copyCaptured').textContent = 'Copy captured URLs'; }, 1200);
});

refresh().catch(error => {
  $('status').textContent = 'Popup error: ' + error.message;
  console.error(error);
});
setInterval(() => refresh().catch(console.error), 500);

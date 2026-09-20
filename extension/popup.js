const $ = id => document.getElementById(id);

const example = [
  100, 95, 93, 92, 89, 87, 86, 79, 76, 51,
  229, 228, 220, 219, 215, 216, 217, 210, 201, 178,
  177, 163, 140, 138, 131, 120, 119, 117, 115, 101
].map(id => `https://www.nexusmods.com/supermarkettogether/mods/${id}`);

function parse(raw) {
  const value = raw.trim();
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {}

  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function validNexusUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' &&
      parsed.hostname === 'www.nexusmods.com' &&
      /\/mods\/\d+/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function refresh() {
  const { nexusQueueState: state } = await chrome.storage.local.get('nexusQueueState');

  if (!state) {
    $('status').textContent = 'Idle';
    $('log').textContent = '';
    return;
  }

  if (state.running) {
    const current = Math.min(state.index + 1, state.urls.length);
    $('status').textContent = state.downloadWaiting
      ? `Waiting 10s · ${current}/${state.urls.length}`
      : `Running · ${current}/${state.urls.length}`;
  } else {
    $('status').textContent = state.index >= state.urls.length && state.urls.length
      ? 'Completed'
      : 'Idle / Stopped';
  }

  $('count').textContent = `${state.urls?.length || 0} URL(s)`;
  $('captured').value = (state.capturedUrls || []).join('\n');
  $('log').textContent = (state.log || []).join('\n');
  $('log').scrollTop = $('log').scrollHeight;
}

$('load').onclick = async () => {
  $('list').value = JSON.stringify(example, null, 2);
  await refresh();
};

$('start').onclick = async () => {
  const rawUrls = parse($('list').value);
  const urls = [...new Set(rawUrls.filter(validNexusUrl))];
  const rejected = rawUrls.length - urls.length;

  if (!urls.length) {
    $('status').textContent = 'No valid Nexus mod URLs';
    return;
  }

  await chrome.runtime.sendMessage({
    type: 'START',
    urls,
    downloadMethod: $('method').value,
    gatewayUrl: $('gatewayUrl').value.trim()
  });

  if (rejected) {
    $('status').textContent = `Started ${urls.length}; ignored ${rejected} invalid URL(s)`;
  }

  await refresh();
};

$('stop').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'STOP' });
  await refresh();
};

chrome.storage.local.get('nexusGatewayUrl', data => {\n  if (data.nexusGatewayUrl) $('gatewayUrl').value = data.nexusGatewayUrl;\n});\n$('gatewayUrl').addEventListener('change', () => {\n  chrome.storage.local.set({ nexusGatewayUrl: $('gatewayUrl').value.trim() });\n});\n\nrefresh();\nsetInterval(refresh, 500);

$('copyCaptured').onclick = async () => {
  const { nexusQueueState: state } = await chrome.storage.local.get('nexusQueueState');
  const urls = (state?.capturedUrls || []).join('\n');
  if (!urls) return;
  await navigator.clipboard.writeText(urls);
  $('copyCaptured').textContent = 'Copied';
  setTimeout(() => $('copyCaptured').textContent = 'Copy captured URLs', 1200);
};

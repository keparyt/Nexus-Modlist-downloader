# Chrome Extension — Nexus Modlist Downloader

This directory contains the Chrome Manifest V3 extension.

For the full project architecture, state machine, Gateway protocol, Nexus DOM model, debugging rules, and agent instructions, read the repository root `README.md`.

## Files

```text
manifest.json      MV3 manifest, permissions, content-script worlds
background.js      queue state machine, popup messages, Gateway forwarding
content.js         isolated-world Nexus DOM automation
page_bridge.js     MAIN-world Nexus interaction/capture bridge
popup.html         extension UI
popup.js           popup state, start/stop, captured URL display
popup.css          popup styling
```

## Execution worlds

Two content-script worlds are intentional.

### MAIN world

`page_bridge.js`

Runs at:

```text
document_start
world: MAIN
```

Use it for page-side Nexus behavior that must interact with the page's own JavaScript/event system.

### Isolated world

`content.js`

Runs at:

```text
document_idle
```

Use it for extension logic, DOM discovery, Shadow DOM traversal, logging, and messaging the MV3 service worker.

Do not collapse these into one script without understanding the execution-world consequences.

## Current Gateway capture design

Gateway/Manual URL Grab must capture the final:

```text
nxm://...
```

without opening the native `nxm://` protocol handler.

The intended sequence is:

```text
mod-download-modal
    ↓
Manual action
    ↓
Nexus download page
    ↓
mod-file-download
    ↓
Slow Download action
    ↓
capture generated nxm://
    ↓
CAPTURE_URL
    ↓
background capturedUrls
    ↓
Gateway POST /api/url
```

The bridge knows the Nexus file and game IDs from:

```html
<mod-file-download
  file-id="223"
  game-id="6766">
```

and uses Nexus' download-generation request:

```text
/Core/Libs/Common/Managers/Downloads?GenerateDownloadUrl
```

with:

```text
fid=<file-id>
game_id=<game-id>
```

The returned `nxm://` URL is passed to the extension through `window.postMessage`.

## Important values

Do not treat:

```text
#ERROR-download-location-not-found
```

as a valid download URL.

The only useful capture target for Gateway/URL Grab is a real:

```text
nxm://...
```

URL.

## Development

After editing extension files:

1. Open `chrome://extensions`.
2. Reload the unpacked extension.
3. Reload the Nexus tab.
4. Start a small test queue first.
5. Watch the extension popup log and the Nexus DevTools console.

Useful log markers:

```text
Download method: ...
FOUND Slow Download ...
SLOW_CLICK_INTERCEPTED
SLOW_CLICK_ACCEPTED
GENERATE_RESPONSE
NXM_CAPTURED
Captured download URL
Sent URL to gateway
```

If the first missing marker is:

```text
FOUND Slow Download
```

debug Shadow DOM discovery.

If `FOUND Slow Download` exists but `SLOW_CLICK_INTERCEPTED` does not, debug `page_bridge.js`/MAIN-world execution.

If `NXM_CAPTURED` never appears, debug the Nexus download-generation request and response.

If `Captured download URL` appears but `Sent URL to gateway` does not, debug `background.js`.

If `Sent URL to gateway` appears but the Gateway GUI does not show the URL, debug `gateway/gateway.py`.

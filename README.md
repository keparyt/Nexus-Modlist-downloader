# Nexus Modlist Downloader

A proof-of-concept (POC) Chrome MV3 extension plus local Python Gateway for sequentially processing a Nexus Mods modlist.

The project exists to automate this general workflow:

```text
Nexus modlist
   |
   v
Open mod page
   |
   +--> choose Manual/Vortex action
   |
   v
Nexus download UI
   |
   v
Find file + Slow Download
   |
   +--> normal Vortex/Manual mode: allow the normal download flow
   |
   +--> URL Grab/Gateway mode:
           capture the generated nxm:// URL
           WITHOUT opening the native nxm:// handler
           |
           v
        capturedUrls
           |
           +--> copy in extension
           |
           +--> Gateway POST /api/url
                    |
                    v
              local Python downloader
```

This repository is intentionally documented as a POC and as an **agent-maintenance guide**. The goal is that another coding agent (Claude Code, Codex, OpenCode, Aider, etc.) can clone the repository, understand the architecture, recognize known Nexus-specific constraints, and modify the correct layer without rediscovering the entire project history.

---

## 1. What this project is

The repository has two cooperating programs:

1. **Chrome extension**
   - Reads a list of Nexus Mods mod URLs.
   - Processes them sequentially.
   - Understands Nexus' `<mod-download-modal>` and `<mod-file-download>` web components.
   - Recursively scans Shadow DOM.
   - Supports Vortex, Manual, Manual (URL Grab), and Gateway modes.
   - Maintains queue state in `chrome.storage.local`.
   - Displays logs and captured `nxm://` URLs in the popup.

2. **Local Gateway**
   - Runs on `127.0.0.1:8765` by default.
   - Accepts captured `nxm://` URLs over HTTP.
   - Queues them.
   - Converts `nxm://` URLs to HTTPS downloads.
   - Downloads files directly with Python instead of launching the browser's native `nxm://` protocol handler.
   - Provides a small Tkinter UI.
   - Supports duplicate protection, download history, custom folder, timeout, overwrite behavior, and automatic downloading.

The extension and Gateway are deliberately separate. The extension is responsible for **Nexus interaction and URL capture**. The Gateway is responsible for **local download execution**.

---

# 2. Repository layout

```text
.
├── README.md
├── modlist.example.txt
│
├── extension/
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── page_bridge.js
│   ├── popup.html
│   ├── popup.js
│   ├── popup.css
│   └── README.md
│
└── gateway/
    ├── gateway.py
    ├── downloader.py
    ├── settings.json
    ├── urls.txt
    ├── run.bat
    ├── setup_venv.bat
    └── README.md
```

Runtime/generated files that may appear:

```text
gateway/.venv/
gateway/downloads/
gateway/download_history.txt
```

The exact download directory depends on `gateway/settings.json`.

---

# 3. The most important architecture rule

## Do not mix responsibilities

This is the single most important maintenance rule.

### `extension/content.js`

Owns:

- Nexus page DOM inspection.
- Nexus Shadow DOM traversal.
- `<mod-download-modal>` parsing.
- Finding Manual/Vortex buttons.
- Finding the rendered Slow Download button.
- Detecting the current page type.
- Logging page-level events.
- Sending queue messages to the background worker.

It should NOT own:

- Queue progression.
- Gateway HTTP downloads.
- Persistent queue state.
- Direct filesystem downloads.

### `extension/page_bridge.js`

Owns:

- Code that must run in the Nexus page's **MAIN world**.
- Observing/intercepting the actual page-side Slow Download action.
- Calling Nexus page APIs with the page's authenticated session.
- Extracting an `nxm://` result.
- Sending bridge events back through `window.postMessage`.

It should NOT own:

- `chrome.storage`
- `chrome.runtime.sendMessage`
- Popup UI
- Queue advancement

The bridge communicates with `content.js` through `window.postMessage`.

### `extension/background.js`

Owns:

- Persistent queue state.
- Current index.
- Active queue tab.
- Selected download method.
- Captured URL list.
- Gateway forwarding.
- Queue advancement.
- 10-second waits.
- Browser tab navigation for modes that intentionally use it.
- Background logging.
- Network redirect interception.

It should NOT inspect Nexus DOM directly.

### `extension/popup.js`

Owns:

- User input.
- Modlist parsing.
- Start/Stop.
- Download method selection.
- Gateway URL configuration.
- Displaying queue status.
- Displaying captured URLs.
- Copying captured URLs.

### `gateway/gateway.py`

Owns:

- Local HTTP server.
- Gateway GUI.
- Gateway queue.
- Gateway settings.
- Gateway logging.
- Passing jobs to the downloader.

### `gateway/downloader.py`

Owns:

- `nxm://` normalization.
- HTTPS request creation.
- Filename extraction.
- File writing.
- `.part` files.
- Unique filename handling.

---

# 4. Chrome MV3 architecture

The extension is Manifest V3.

Current version:

```text
2.5.0
```

The manifest intentionally defines TWO Nexus content scripts:

```text
MAIN world:
    page_bridge.js
    run_at=document_start

ISOLATED world:
    content.js
    run_at=document_idle
```

This distinction is critical.

## Why two worlds exist

Chrome extension content scripts normally run in an isolated world. That is good for extension safety, but it means page JavaScript behavior is not identical to the page's own JavaScript environment.

Nexus uses custom elements and page-side event handlers.

Therefore:

- `content.js` is used for extension-controlled DOM work.
- `page_bridge.js` runs in the page's MAIN world where it can observe/intercept page-side behavior.

Do NOT merge these two scripts casually.

If you move page-specific logic back into `content.js`, you may recreate the exact regression this project has repeatedly hit.

---

# 5. Nexus DOM model

The project depends on two important Nexus web components.

## 5.1 `<mod-download-modal>`

Example shape:

```html
<mod-download-modal
  file="{&quot;name&quot;:&quot;Vinyls&quot;,
         &quot;uid&quot;:29059748724959,
         &quot;category&quot;:1,
         &quot;downloadUrl&quot;:&quot;https:\/\/www.nexusmods.com\/api\/files\/29059748724959\/download&quot;,
         &quot;vortexDownloadUrl&quot;:&quot;https:\/\/www.nexusmods.com\/api\/files\/29059748724959\/download?nmm=1&quot;}"
  show-vortex-button="true">
</mod-download-modal>
```

The extension parses the `file` attribute as JSON.

Important fields commonly used:

```text
file.name
file.uid
file.downloadUrl
file.vortexDownloadUrl
file.category
```

The project prefers this deterministic data over generic text selectors.

---

# 6. Nexus download page model

After the API URL is opened, Nexus commonly produces a page containing:

```html
<mod-file-download
  filename="Vinyls"
  file-uri="Vinyls-100-1-0-1755458518.rar"
  file-id="223"
  game-id="6766"
  game-domain="/supermarkettogether"
  download-url="nxm://supermarkettogether/mods/100/files/223?key=...&expires=...&user_id=..."
  is-managed-download-enabled="true">
</mod-file-download>
```

Important fields:

```text
filename
file-id
game-id
game-domain
download-url
```

The `download-url` value may initially be:

```text
#ERROR-download-location-not-found
```

Do **not** treat that string as an `nxm://` URL.

Historically, it has been observed before the final URL is generated.

The actual capture target is:

```text
nxm://...
```

---

# 7. Shadow DOM is mandatory

Nexus frequently places the visible controls inside Shadow DOM.

A normal:

```js
document.querySelector('button')
```

may not find the control.

The extension therefore uses an `allRoots()` helper that recursively walks:

```text
document
  |
  +-- element shadowRoot
  |
  +-- descendant element shadowRoots
  |
  +-- nested shadowRoots
```

This is especially important for:

```text
<mod-download-modal>
<mod-file-download>
```

When debugging a selector regression, verify Shadow DOM traversal before inventing a new selector.

---

# 8. Slow Download detection

The extension searches the `<mod-file-download>` component's reachable DOM/shadow roots for controls matching:

```text
button
a
[role="button"]
[part]
[data-testid]
input[type="button"]
input[type="submit"]
```

It then checks visible text/accessibility data for strings such as:

```text
slow download
slow_download
slow-download
```

The page bridge additionally watches the actual composed click path.

This distinction matters:

- `content.js` is good at **finding** the button.
- `page_bridge.js` is used when we need to interact with Nexus's **page-side click behavior** without triggering the native `nxm://` handler.

---

# 9. Desired Gateway flow

This is the behavior the POC is designed to achieve.

```text
1. Open mod page
2. Wait 3 seconds
3. Read <mod-download-modal>
4. Select Manual
5. Enter Nexus download UI
6. Find <mod-file-download>
7. Find Slow Download
8. Activate the Nexus Slow Download action
9. Prevent the browser/OS from opening nxm://
10. Capture the generated nxm:// URL
11. Store it in capturedUrls
12. Show it in the popup
13. POST it to Gateway
14. Gateway downloads it directly
15. Wait 10 seconds
16. Open next mod
```

The key invariant is:

> **Gateway mode must capture `nxm://` without giving `nxm://` to Chrome's native protocol handler.**

If a change causes a browser/Vortex download prompt, the Gateway flow is broken.

---

# 10. Download modes

The extension supports four methods.

## Vortex

Intended behavior:

```text
Mod page
→ Vortex URL
→ Nexus download page
→ Slow Download
→ normal Vortex/browser flow
→ wait
→ next
```

Vortex mode is allowed to use the normal download behavior.

## Manual

Intended behavior:

```text
Mod page
→ Manual URL
→ Nexus download page
→ Slow Download
→ normal manual/browser flow
→ wait
→ next
```

## Manual (URL Grab)

Intended behavior:

```text
Mod page
→ Manual URL
→ Nexus download page
→ generate/capture nxm://
→ do NOT launch nxm://
→ show captured URL
→ wait
→ next
```

## Gateway

Intended behavior:

```text
Mod page
→ Manual URL
→ Nexus download page
→ generate/capture nxm://
→ do NOT launch nxm://
→ show captured URL
→ POST /api/url
→ Gateway downloads
→ wait
→ next
```

Gateway and Manual URL Grab should therefore share most of their capture logic.

---

# 11. Queue state

The background worker persists a state object under:

```text
chrome.storage.local["nexusQueueState"]
```

Current default shape:

```js
{
  running: false,
  index: 0,
  urls: [],
  tabId: null,
  log: [],
  downloadWaiting: false,
  downloadMethod: 'vortex',
  capturedUrls: [],
  gatewayUrl: 'http://127.0.0.1:8765',
  downloadResolveUrl: ''
}
```

## Meaning of important fields

### `running`

Whether queue execution is active.

### `index`

Zero-based index into `urls`.

### `urls`

The normalized mod-page URL queue.

### `tabId`

The single browser tab used as the queue tab.

### `downloadWaiting`

Prevents duplicate queue advancement while a capture/download wait is active.

### `downloadMethod`

One of:

```text
vortex
manual
manual-urlgrab
gateway
```

### `capturedUrls`

Captured `nxm://` links displayed in the popup.

### `gatewayUrl`

Default:

```text
http://127.0.0.1:8765
```

### `downloadResolveUrl`

Tracks the current Nexus API download URL being resolved.

---

# 12. Queue progression rules

The queue should be sequential.

Only one mod should be active at a time.

For capture modes, the intended progression is:

```text
CAPTURE_URL
    ↓
capturedUrls.push(url)
    ↓
downloadWaiting = true
    ↓
Gateway POST (if Gateway mode)
    ↓
wait 10 seconds
    ↓
downloadWaiting = false
    ↓
index++
    ↓
openNext()
```

Do not split the capture state transition into multiple independent messages unless there is a strong reason.

A previous regression came from:

```text
CAPTURE_URL
+
DOWNLOAD_CAPTURED
```

being handled separately.

That created a race where an older background state could overwrite the newly captured URL.

The preferred pattern is a single atomic `CAPTURE_URL` operation.

---

# 13. Extension message protocol

The extension communicates primarily with:

```text
chrome.runtime.sendMessage(...)
```

## START

Popup → background.

Shape:

```js
{
  type: 'START',
  urls,
  downloadMethod,
  gatewayUrl
}
```

## STOP

Popup → background.

```js
{
  type: 'STOP'
}
```

## STEP_LOG

Content → background.

```js
{
  type: 'STEP_LOG',
  text
}
```

## NAVIGATE_DOWNLOAD

Content → background.

Used for modes that intentionally navigate the queue tab to Nexus' API download URL.

```js
{
  type: 'NAVIGATE_DOWNLOAD',
  url,
  method
}
```

## RESOLVE_DOWNLOAD

Historically introduced for an API-resolution approach.

```js
{
  type: 'RESOLVE_DOWNLOAD',
  url,
  method
}
```

This path is experimental and should not automatically replace the proven Nexus download-page flow.

## CAPTURE_URL

Content/bridge → background.

```js
{
  type: 'CAPTURE_URL',
  url: 'nxm://...'
}
```

This is the important capture message.

Gateway mode should result in:

```text
CAPTURE_URL
→ capturedUrls
→ sendToGateway()
```

## DOWNLOAD_STARTED

Used by normal Vortex/Manual download paths.

It tells the background that the normal Slow Download action was activated and the queue should wait before advancing.

Gateway/URL Grab should not use this as a substitute for `CAPTURE_URL`.

---

# 14. Page bridge protocol

`page_bridge.js` cannot call Chrome extension APIs directly.

It uses:

```js
window.postMessage(...)
```

The extension content script listens for bridge messages.

Bridge source:

```text
NexusModlistDownloaderBridge
```

Extension source:

```text
NexusModlistDownloaderExtension
```

Important bridge events:

### `SET_MODE`

Content → page bridge.

```js
{
  source: 'NexusModlistDownloaderExtension',
  type: 'SET_MODE',
  mode: 'gateway'
}
```

### `SLOW_CLICK_INTERCEPTED`

Bridge → content script.

Used for diagnostics.

### `SLOW_CLICK_ACCEPTED`

Bridge → content script.

Indicates that the bridge recognized the Slow Download action and started Nexus URL generation.

### `GENERATE_RESPONSE`

Bridge → content script.

Contains HTTP status and a response preview.

### `NXM_CAPTURED`

Bridge → content script.

```js
{
  source: 'NexusModlistDownloaderBridge',
  type: 'NXM_CAPTURED',
  url: 'nxm://...'
}
```

The content script then sends:

```js
{
  type: 'CAPTURE_URL',
  url
}
```

### `NXM_ERROR`

Bridge → content script.

Contains the failure reason and, where available, a response preview.

---

# 15. Nexus URL generation POC

The current page bridge uses this Nexus endpoint:

```text
/Core/Libs/Common/Managers/Downloads?GenerateDownloadUrl
```

The request is a POST using:

```text
fid=<file-id>
game_id=<game-id>
```

The bridge expects a response containing an `nxm://` URL, usually in a JSON `url` field.

Conceptually:

```http
POST /Core/Libs/Common/Managers/Downloads?GenerateDownloadUrl
Content-Type: application/x-www-form-urlencoded

fid=223&game_id=6766
```

Expected conceptual result:

```json
{
  "url": "nxm://supermarkettogether/mods/100/files/223?key=..."
}
```

Do not hard-code credentials or cookies. The request must use the existing logged-in Nexus browser session.

---

# 16. Important Nexus-specific rule

The extension should not treat:

```text
#ERROR-download-location-not-found
```

as the final download URL.

It is a placeholder/error-state value.

The actual useful URL is:

```text
nxm://...
```

If a code change says:

```js
if (component.getAttribute('download-url')) {
    // capture
}
```

that is unsafe because the placeholder is also non-empty.

The capture condition must validate the scheme:

```js
/^nxm:\/\//i
```

---

# 17. Gateway API

Default endpoint:

```text
http://127.0.0.1:8765
```

## GET /api/status

Returns Gateway status.

Conceptual response:

```json
{
  "ok": true,
  "running": true,
  "auto_download": true,
  "queue_size": 0,
  "download_folder": "..."
}
```

## POST /api/url

Accepts:

```json
{
  "url": "nxm://supermarkettogether/mods/100/files/223?key=..."
}
```

Successful response is conceptually:

```json
{
  "ok": true,
  "queued": true,
  "auto_download": true
}
```

Duplicate URLs may return:

```json
{
  "ok": true,
  "duplicate": true,
  "queued": false
}
```

The extension uses:

```text
POST http://127.0.0.1:8765/api/url
Content-Type: application/json
```

---

# 18. Gateway downloader behavior

The Gateway receives an `nxm://` URL and converts it to HTTPS.

Example:

```text
nxm://supermarkettogether/mods/100/files/223?key=...&expires=...
```

becomes conceptually:

```text
https://www.nexusmods.com/supermarkettogether/mods/100/files/223?key=...&expires=...
```

The downloader:

1. Normalizes the URL.
2. Creates the destination directory.
3. Sends a Python HTTP request.
4. Reads `Content-Disposition` for the filename.
5. Falls back to the URL path if needed.
6. Writes to a `.part` file.
7. Replaces the `.part` file with the final filename.
8. Avoids overwriting by default.

This means the local Gateway does not need Chrome to handle `nxm://`.

That separation is intentional.

---

# 19. Gateway configuration

Current defaults in `gateway/settings.json`:

```json
{
  "host": "127.0.0.1",
  "port": 8765,
  "download_folder": "downloads",
  "auto_download": true,
  "overwrite_existing": false,
  "save_history": true,
  "max_queue_size": 1000,
  "request_timeout": 120,
  "user_agent": "Nexus-Modlist-Downloader-Gateway/1.0"
}
```

Do not commit secrets into this file.

---

# 20. Running the Gateway

From the `gateway` directory:

```bat
run.bat
```

The launcher:

1. Finds `python`.
2. Creates `.venv` if needed.
3. Starts `gateway.py` with:

```text
.venv\Scripts\python.exe
```

Manual environment creation:

```bat
setup_venv.bat
```

The repository intentionally uses `python`, not `py`, in its batch launchers.

---

# 21. Installing the extension

1. Open:

```text
chrome://extensions
```

2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select:

```text
<repo>\extension
```

5. Click the extension's **Reload** button after source changes.

When debugging a content script or MAIN-world script, always reload the extension and then reload the Nexus page.

A stale content script is a common source of misleading debugging results.

---

# 22. Input formats

The popup accepts either:

## JSON array

```json
[
  "https://www.nexusmods.com/supermarkettogether/mods/100",
  "https://www.nexusmods.com/supermarkettogether/mods/95"
]
```

## One URL per line

```text
https://www.nexusmods.com/supermarkettogether/mods/100
https://www.nexusmods.com/supermarkettogether/mods/95
```

The popup validates that URLs are HTTPS Nexus Mods mod URLs.

Example data is available in:

```text
modlist.example.txt
```

---

# 23. Popup behavior

The popup exposes:

- Mod list textarea.
- Download method selector.
- Gateway URL.
- Load example.
- Start.
- Stop.
- Captured URLs textarea.
- Copy captured URLs.
- Live queue log.
- Current running/waiting state.

The popup polls queue state every 500ms.

Captured URLs come from:

```text
state.capturedUrls
```

Do not create a second independent popup-only capture list. The background state is the source of truth.

---

# 24. Debugging methodology for agents

When something stops working, do not immediately rewrite selectors.

Follow this order.

## Step 1 - Identify the mode

Look for:

```text
Queue started with N URL(s) [Method: Gateway]
```

and:

```text
Download method: gateway
```

If the log says Vortex when Gateway was selected, the bug is state propagation, not Nexus DOM.

## Step 2 - Identify the page stage

There are three major stages:

```text
MOD PAGE
DOWNLOAD PAGE
CAPTURE
```

If the log stops before:

```text
Navigating queue tab to ...
```

the problem is `mod-download-modal` handling.

If the log reaches:

```text
<mod-file-download>
```

the problem is download-page handling.

If Slow Download is found but no URL is captured, inspect the bridge/capture path.

## Step 3 - Confirm the actual component

Check:

```text
<mod-download-modal>
<mod-file-download>
```

and their attributes.

Do not assume Nexus has the same DOM on every file.

## Step 4 - Confirm Shadow DOM

If the log says:

```text
FOUND Slow Download in mod-file-download::shadow
```

then the selector is already working.

Do not rewrite `findSlowDownload()` unless that line disappears.

## Step 5 - Check the placeholder

If:

```text
download-url="#ERROR-download-location-not-found"
```

do not conclude that capture is impossible.

That value is not the target.

## Step 6 - Check the bridge

For Gateway/URL Grab, look for:

```text
SLOW_CLICK_INTERCEPTED
SLOW_CLICK_ACCEPTED
GENERATE_RESPONSE
NXM_CAPTURED
NXM_ERROR
```

The absence of `SLOW_CLICK_INTERCEPTED` points toward the MAIN-world bridge.

The presence of `SLOW_CLICK_ACCEPTED` but absence of `NXM_CAPTURED` points toward the Nexus GenerateDownloadUrl request or response parsing.

## Step 7 - Check Gateway separately

Only after the extension says:

```text
Captured download URL
```

should you debug Gateway HTTP delivery.

Then look for:

```text
Sent URL to gateway
```

If that is present but the Gateway window does not show:

```text
Received URL
```

debug the local HTTP server.

Do not modify Nexus code for a Gateway-only problem.

---

# 25. Known bad approaches

Several regressions happened because of these patterns.

## Bad: trust any non-empty download-url

Wrong:

```js
const url = component.getAttribute('download-url');
if (url) capture(url);
```

Why:

```text
#ERROR-download-location-not-found
```

is also non-empty.

Use an `nxm://` validation.

## Bad: directly open nxm:// in Gateway mode

Wrong:

```text
chrome.tabs.update(..., { url: "nxm://..." })
```

Why:

The browser/OS/Vortex handler receives the protocol.

Result:

```text
download prompt
Vortex launch
native protocol handling
```

Gateway mode exists specifically to avoid that.

## Bad: use DOWNLOAD_STARTED for Gateway

`DOWNLOAD_STARTED` is for the normal download path.

Gateway needs:

```text
CAPTURE_URL
```

because the captured URL itself is the product of the operation.

## Bad: add multiple messages for one capture

Avoid:

```text
CAPTURE_URL
+
DOWNLOAD_CAPTURED
```

The project previously suffered state races from this.

Use one atomic capture operation.

## Bad: move page logic entirely into isolated content.js

If Nexus changes page-side behavior, the isolated world may not see the same handlers.

Keep MAIN-world bridge logic separate.

## Bad: remove the manual click step

The expected path is:

```text
mod page
→ Manual action
→ download page
→ Slow Download action
→ generated nxm://
```

The API URL from `mod-download-modal` is not itself necessarily the final downloadable archive URL.

---

# 26. Historical commits / recovery points

The repository has several useful historical checkpoints.

## Initial automation

```text
9527cf71b91240a0614340bad526a5fb461acd1a
Add Nexus page automation content script
```

Basic Nexus content automation.

## Deterministic modal flow

```text
5be8fee9ac2f1f813a08fd5e8e01b2834f15c5b8
Rework Nexus automation around mod-download-modal
```

Important transition toward using Nexus' `mod-download-modal`.

## Slow Download improvements

```text
dee46a13c1010c54ba78cec591d32c96e6ccc554
Improve mod-file-download Slow download detection
```

```text
a953a6e3d6b409fc60d32d255d1eb34d37010f93
Fix Slow Download detection and clicking
```

```text
0d9b9d04732d467990f6d228ecfa8844c508e5e0
Fix Slow Download shadow root scanning
```

These are important when DOM detection regresses.

## Manual / URL Grab

```text
cc31b935fc99dc1154edff2370d011b030b7a338
Add Manual URL Grab mode
```

```text
1e8eb24f07299ab33b39dd3a34da5b13d03c46b0
Make URL Grab capture atomic
```

The latter is especially important for queue-state correctness.

## Gateway

```text
dbfc49527ea47e3eb1843fb7282b50967df58f32
Add Gateway capture mode
```

```text
adc8bee77a6d6b6ac778e284252c1e1454fb9a9e
Use Manual scan flow for Gateway mode
```

These are useful recovery points for the Gateway architecture.

---

# 27. Current POC status

This repository is actively evolving because Nexus is a dynamic site and its frontend behavior is not a stable API contract.

The important invariants are more stable than individual selectors:

1. Read the mod file information from `mod-download-modal`.
2. Navigate through the Nexus download UI when necessary.
3. Detect `mod-file-download`.
4. Work through Shadow DOM.
5. Capture the final `nxm://` URL.
6. Never launch `nxm://` in Gateway mode.
7. Put the captured URL into the persistent queue state.
8. Send the captured URL to Gateway.
9. Advance only after the capture transaction has completed.

At the time of writing, the Gateway capture path is considered a **POC/active development area**. If Nexus changes the Slow Download implementation, start by inspecting `page_bridge.js` and the current `mod-file-download` DOM rather than rewriting the background queue.

---

# 28. Agent instructions

This section is intentionally explicit.

## Before editing

Read:

```text
README.md
extension/manifest.json
extension/background.js
extension/content.js
extension/page_bridge.js
extension/popup.js
gateway/gateway.py
gateway/downloader.py
```

Then inspect recent commits if the task says:

```text
restore
used to work
previous version
before regression
```

Use the Git history to identify the last working behavior.

## When changing Gateway capture

Usually edit:

```text
extension/page_bridge.js
extension/content.js
extension/background.js
```

Do NOT start by changing:

```text
gateway/downloader.py
```

unless the extension has already proven:

```text
Captured download URL
Sent URL to gateway
```

## When changing queue behavior

Edit:

```text
extension/background.js
```

The background state machine is authoritative.

## When changing UI

Edit:

```text
extension/popup.html
extension/popup.js
extension/popup.css
```

Do not duplicate queue state in popup memory.

## When changing local downloading

Edit:

```text
gateway/gateway.py
gateway/downloader.py
gateway/settings.json
```

Do not add browser download logic to the Gateway.

---

# 29. Safe change procedure

For every significant change:

### 1. Fetch current source

Do not edit an old local copy without first checking `main`.

### 2. Identify the state transition

Write down:

```text
current state
→ event
→ new state
```

For example:

```text
downloadWaiting=false
→ CAPTURE_URL
→ downloadWaiting=true
```

### 3. Change the smallest layer

Avoid rewriting all three layers for a one-line bug.

### 4. Syntax-check

At minimum:

```text
new Function(content)
```

for JavaScript files.

For Python:

```text
python -m py_compile gateway.py downloader.py
```

### 5. Verify the manifest

Especially after changing content scripts, permissions, or execution world.

### 6. Verify message names

A typo between:

```text
CAPTURE_URL
CAPTURE_URL_FROM_NETWORK
NXM_CAPTURED
```

can silently stop the queue.

### 7. Commit one logical change

Good:

```text
Fix Gateway NXM capture
```

Bad:

```text
Fix everything
```

---

# 30. Agent prompt

A coding agent can use this starting prompt:

```text
You are working on the repository Nexus-Modlist-downloader.

Read README.md first.

This is a Chrome MV3 extension plus a local Python Gateway.

Never assume Nexus DOM behavior. Inspect:
- mod-download-modal
- mod-file-download
- Shadow DOM
- Slow Download button
- generated nxm:// URL

Architecture:
- extension/content.js = isolated Nexus DOM automation
- extension/page_bridge.js = MAIN-world Nexus page bridge
- extension/background.js = queue/state/Gateway
- extension/popup.js/html/css = UI
- gateway/gateway.py = local HTTP server + queue
- gateway/downloader.py = actual file download

Important invariant:
Gateway and Manual URL Grab must capture nxm:// without launching the nxm:// protocol handler.

Use:
chrome.storage.local["nexusQueueState"]

Capture flow:
Slow Download action
→ capture nxm://
→ CAPTURE_URL
→ capturedUrls
→ Gateway POST /api/url when Gateway mode
→ wait 10 seconds
→ next queue item

Do not use #ERROR-download-location-not-found as a valid URL.

Do not replace atomic CAPTURE_URL with separate state-changing messages without a demonstrated reason.

Before editing, inspect recent Git history if the task mentions a behavior that previously worked.

Make the smallest safe change, syntax-check the modified files, and explain exactly which state transition changed.
```

---

# 31. Example debugging checklist

If Gateway appears stuck:

```text
[ ] Popup says Running - Gateway
[ ] Queue log says [Method: Gateway]
[ ] Content script says Download method: gateway
[ ] Manual button click occurred
[ ] API download page opened
[ ] mod-file-download exists
[ ] Slow Download was found
[ ] MAIN-world bridge is loaded
[ ] SLOW_CLICK_INTERCEPTED appears
[ ] SLOW_CLICK_ACCEPTED appears
[ ] GENERATE_RESPONSE appears
[ ] NXM_CAPTURED appears
[ ] CAPTURE_URL appears
[ ] Captured URLs box contains the URL
[ ] Sent URL to gateway appears
[ ] Gateway GUI says Received URL
[ ] Gateway says Starting download
```

Stop debugging at the first missing step.

That tells you which layer is broken.

---

# 32. Security / session model

The extension uses the user's existing logged-in Nexus browser session.

The project does not attempt to:

- bypass Nexus login
- bypass CAPTCHA
- bypass rate limits
- obtain credentials
- scrape authenticated cookies for external use

The Gateway receives the generated `nxm://` URL and uses the URL's signed/query parameters to request the actual file.

Treat captured `nxm://` URLs as temporary authenticated download URLs. Do not publish them in logs, issues, or source control.

---

# 33. Why this project is a POC

Nexus is a modern web application using custom elements, Shadow DOM, dynamic rendering, and page-side JavaScript.

The project therefore has two different kinds of stability:

### Stable concepts

```text
mod list
mod ID
file ID
download URL
nxm:// URL
sequential queue
Gateway
```

### Unstable implementation details

```text
CSS selectors
Shadow DOM paths
button markup
custom element internals
event handler implementation
Nexus API response shape
download-page routing
```

Agents should preserve the stable concepts and isolate the unstable implementation details into small helper functions.

---

# 34. Final maintenance rule

When a change breaks something that "used to work":

**Do not immediately add another workaround.**

First:

```text
1. Find the last known-good commit.
2. Compare current behavior against it.
3. Identify the exact state transition or DOM interaction that changed.
4. Restore that behavior.
5. Only then add the smallest necessary enhancement.
```

This repository has deliberately retained historical commits because that workflow has proven more reliable than repeatedly layering new Nexus-specific guesses on top of a regression.

---

## Related documentation

Extension-specific notes:

```text
extension/README.md
```

Gateway-specific notes:

```text
gateway/README.md
```

Example modlist:

```text
modlist.example.txt
```

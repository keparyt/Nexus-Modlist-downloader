# Nexus Modlist Sequential Downloader

Chrome Manifest V3 extension for processing a Nexus Mods URL list sequentially.

## Automation flow

For each mod URL:

1. Open the Nexus Mods mod page.
2. Wait 3 seconds.
3. Find the page's `<mod-download-modal>`.
4. Read its `file` attribute.
5. Extract the exact `vortexDownloadUrl`, for example:
   `https://www.nexusmods.com/api/files/29059748724959/download?nmm=1`
6. Inspect the modal's normal DOM and shadow DOM for its real **Download** control.
7. Click that control when available.
8. If Nexus does not expose a rendered Download control, navigate to the exact `vortexDownloadUrl` exposed by the modal.
9. On the resulting download page, find **Slow download**, preferably inside `#upsell-cards`.
10. Click **Slow download**.
11. Wait 10 seconds.
12. Move to the next mod URL.

## Slow download detection

The redirected Nexus page is handled through its `<mod-file-download>` web component. The extension recursively inspects that component's Shadow DOM and waits up to 60 seconds for the rendered **Slow download** control. It supports buttons, links, role buttons, and component parts whose text or accessibility attributes identify Slow download.

## Why the modal is used

The extension no longer depends on finding a generic visible element whose text happens to say **Vortex**. Nexus exposes the file information directly on:

`<mod-download-modal file="...">`

The JSON in that attribute contains `vortexDownloadUrl`, making the automation substantially more deterministic.

The extension also recursively inspects shadow DOM because `mod-download-modal` can render its buttons outside the normal light DOM.

## Debugging

Open Chrome DevTools on the Nexus page and look for:

`[Nexus Modlist Downloader]`

The extension logs:

- queue state
- selected mod-download-modal
- mod/file name and UID
- exact Vortex download URL
- shadow-DOM search paths
- Download candidates
- selected Download control
- Slow download detection
- 10-second queue delay
- timeouts and errors

The popup also displays the latest queue log.

## Install / update

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the repository's `extension` folder.
5. After changing extension files, click **Reload** for the extension.
6. Open the extension popup and paste a JSON array or one Nexus mod URL per line.
7. Click **Start**.

The extension uses the existing logged-in Nexus Mods browser session. It does not bypass CAPTCHA, login, rate limits, or other security controls.

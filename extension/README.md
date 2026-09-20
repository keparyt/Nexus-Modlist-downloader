# Nexus Modlist Sequential Downloader

Chrome Manifest V3 extension for processing a Nexus URL list one at a time.

## Flow

1. Open a URL from the queue.
2. Click **Vortex**.
3. In the modal, click **Download** (preferably the `/download?nmm=1` link).
4. On the download page, click **Slow download** inside `#upsell-cards`.
5. Wait 10 seconds, then continue with the next URL.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `extension` folder.
5. Open the extension popup and paste either a JSON array or one URL per line.

The extension uses the existing logged-in Nexus Mods browser session. Site layouts can change, so inspect the popup log if a step times out. It does not bypass CAPTCHA, login, or other security checks.

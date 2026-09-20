# Nexus URL Gateway & Downloader

A standalone local gateway/downloader for the Nexus Modlist Downloader extension.

## Features

- Accepts captured `nxm://...` URLs from the Chrome extension.
- Accepts pasted URLs manually in the GUI.
- Reads `urls.txt` when requested.
- Converts Nexus `nxm://...` URLs to HTTPS download requests.
- Downloads archives using the filename supplied by Nexus / Content-Disposition.
- Configurable download folder.
- Configurable gateway host/port.
- Auto-download on URL receive can be enabled/disabled.
- Sequential download queue.
- Duplicate protection.
- Download history and live activity log.
- Start/stop queue controls.
- Settings are stored in `settings.json`.

## Start

Run:

```bat
run.bat
```

Or:

```bat
python gateway.py
```

The GUI starts the HTTP gateway automatically.

Default endpoint:

`http://127.0.0.1:8765`

## urls.txt

Put one captured `nxm://...` URL per line.

The GUI has **Load urls.txt** and **Download list** controls.

## Extension

Select **Gateway** as the fourth download method. Captured URLs are sent to the local gateway.

The extension does not need the gateway to be running to scan; if it is unavailable, the extension records the error in its log and continues.

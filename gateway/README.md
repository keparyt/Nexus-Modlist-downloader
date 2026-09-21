# Nexus URL Gateway & Downloader

A standalone local gateway/downloader for the Nexus Modlist Downloader extension.

## Python virtual environment

The gateway uses a local Python virtual environment at:

```text
.venv\
```

Run `setup_venv.bat` to create it manually, or simply run `run.bat`; it automatically creates the environment using:

```bat
python -m venv .venv
```

The launcher always starts the gateway with `.venv\Scripts\python.exe`.

## Start

```bat
run.bat
```

## Features

- Accepts captured `nxm://...` URLs from the Chrome extension.
- Accepts pasted URLs manually in the GUI.
- Reads `urls.txt` when requested.
- Converts Nexus `nxm://...` URLs to HTTPS download requests.
- Downloads archives using the filename supplied by Nexus / Content-Disposition.
- Configurable download folder, host, port, timeout, and auto-download mode.
- Sequential queue, duplicate protection, history, and live activity log.

Default endpoint: `http://127.0.0.1:8765`

## Extension

Select **Gateway** as the fourth download method. Captured URLs are sent to the local gateway.

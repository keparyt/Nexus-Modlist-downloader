# Nexus URL Gateway & Downloader

Standalone local Python gateway/downloader used by the Chrome extension.

For the complete project architecture, queue state machine, Nexus DOM model, agent instructions, debugging workflow, and extension/Gateway protocol, read the repository root `README.md`.

## Role of the Gateway

The Gateway is intentionally **not** responsible for Nexus page automation.

The extension does:

```text
Nexus page
→ find file
→ obtain nxm:// URL
→ capture URL
→ POST /api/url
```

The Gateway does:

```text
POST /api/url
→ validate/normalize nxm://
→ queue
→ HTTPS request
→ save archive
```

This separation is important. Do not move browser/Nexus DOM logic into the Gateway when the bug is in URL capture.

## HTTP API

Default endpoint:

```text
http://127.0.0.1:8765
```

### GET /api/status

Returns Gateway health/status.

### POST /api/url

Request:

```json
{
  "url": "nxm://supermarkettogether/mods/100/files/223?key=..."
}
```

The Gateway validates the URL, prevents duplicates, queues it, and automatically downloads when `auto_download` is enabled.

## URL conversion

`downloader.py` converts Nexus `nxm://` URLs into HTTPS requests.

Example:

```text
nxm://game-domain/mods/100/files/223?key=...
```

becomes conceptually:

```text
https://www.nexusmods.com/game-domain/mods/100/files/223?key=...
```

The downloader then uses the Nexus response headers to determine the filename.

## Settings

`settings.json` controls:

- host
- port
- download folder
- auto-download
- overwrite behavior
- history
- queue size
- request timeout
- user agent

Default port:

```text
8765
```

## Running

Use:

```bat
run.bat
```

It automatically creates:

```text
.venv\
```

and launches:

```text
.venv\Scripts\python.exe gateway.py
```

The project intentionally uses `python`, not `py`, in the batch scripts.

## Debugging

When the extension says:

```text
Sent URL to gateway: nxm://...
```

but the Gateway does not show:

```text
Received URL: ...
```

debug the Gateway HTTP server.

When the Gateway receives the URL but download fails, debug `downloader.py`.

Do not change the extension capture logic for a downloader-only error.

## Runtime files

Possible generated files:

```text
.venv/
downloads/
download_history.txt
```

These are runtime artifacts, not source code.

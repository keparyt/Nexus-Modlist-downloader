from __future__ import annotations

import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def normalize_url(url: str) -> str:
    url = url.strip()
    if url.lower().startswith("nxm://"):
        # Nexus nxm URLs normally look like:
        # nxm://game-domain/mods/123/files/456?key=...&expires=...
        parsed = urllib.parse.urlsplit(url)
        host = parsed.netloc
        path = parsed.path
        query = parsed.query
        if host.lower() == "www.nexusmods.com":
            return urllib.parse.urlunsplit(("https", host, path, query, ""))
        return urllib.parse.urlunsplit(
            ("https", "www.nexusmods.com", f"/{host}{path}", query, "")
        )
    if url.lower().startswith("https://"):
        return url
    raise ValueError("URL must start with nxm:// or https://")


def filename_from_headers(headers, fallback_url: str) -> str:
    value = headers.get("Content-Disposition", "")
    match = re.search(r"filename\*=UTF-8''([^;]+)", value, re.I)
    if match:
        name = urllib.parse.unquote(match.group(1))
    else:
        match = re.search(r'filename="?([^";]+)"?', value, re.I)
        name = match.group(1).strip() if match else ""

    if not name:
        name = Path(urllib.parse.urlsplit(fallback_url).path).name or "nexus-download"
    name = os.path.basename(name).strip()
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)
    return name or "nexus-download"


def unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    for index in range(1, 10000):
        candidate = path.with_name(f"{stem} ({index}){suffix}")
        if not candidate.exists():
            return candidate
    raise RuntimeError("Could not find an available filename")


def download(url: str, folder: str, timeout: int = 120, overwrite: bool = False,
             user_agent: str = "Nexus-Modlist-Downloader-Gateway/1.0",
             progress=None) -> dict:
    original = url.strip()
    https_url = normalize_url(original)
    target_folder = Path(folder).expanduser().resolve()
    target_folder.mkdir(parents=True, exist_ok=True)

    request = urllib.request.Request(
        https_url,
        headers={
            "User-Agent": user_agent,
            "Accept": "*/*",
        },
        method="GET",
    )

    with urllib.request.urlopen(request, timeout=timeout) as response:
        filename = filename_from_headers(response.headers, https_url)
        target = target_folder / filename
        if target.exists() and not overwrite:
            target = unique_path(target)

        temp = target.with_name(target.name + ".part")
        total = int(response.headers.get("Content-Length", "0") or 0)
        received = 0

        with open(temp, "wb") as handle:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)
                received += len(chunk)
                if progress:
                    progress(received, total)

        temp.replace(target)

    return {
        "original_url": original,
        "https_url": https_url,
        "filename": target.name,
        "path": str(target),
        "bytes": received,
        "status": "downloaded",
    }

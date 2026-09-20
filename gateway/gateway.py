from __future__ import annotations

import json
import queue
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from downloader import download, normalize_url


BASE = Path(__file__).resolve().parent
SETTINGS_FILE = BASE / "settings.json"
URLS_FILE = BASE / "urls.txt"
HISTORY_FILE = BASE / "download_history.txt"

DEFAULTS = {
    "host": "127.0.0.1",
    "port": 8765,
    "download_folder": "downloads",
    "auto_download": True,
    "overwrite_existing": False,
    "save_history": True,
    "max_queue_size": 1000,
    "request_timeout": 120,
    "user_agent": "Nexus-Modlist-Downloader-Gateway/1.0",
}


def load_settings():
    try:
        data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        merged = {**DEFAULTS, **data}
        SETTINGS_FILE.write_text(json.dumps(merged, indent=2), encoding="utf-8")
        return merged
    except Exception:
        SETTINGS_FILE.write_text(json.dumps(DEFAULTS, indent=2), encoding="utf-8")
        return dict(DEFAULTS)


def save_settings(settings):
    SETTINGS_FILE.write_text(json.dumps(settings, indent=2), encoding="utf-8")


class GatewayApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Nexus URL Gateway & Downloader")
        self.root.geometry("900x680")
        self.root.minsize(760, 560)

        self.settings = load_settings()
        self.jobs = queue.Queue(maxsize=int(self.settings["max_queue_size"]))
        self.seen = set()
        self.history = []
        self.server = None
        self.server_thread = None
        self.worker_thread = threading.Thread(target=self.worker, daemon=True)
        self.worker_thread.start()
        self.running = True

        self.host_var = tk.StringVar(value=self.settings["host"])
        self.port_var = tk.StringVar(value=str(self.settings["port"]))
        self.folder_var = tk.StringVar(value=self.settings["download_folder"])
        self.auto_var = tk.BooleanVar(value=self.settings["auto_download"])
        self.overwrite_var = tk.BooleanVar(value=self.settings["overwrite_existing"])
        self.history_var = tk.BooleanVar(value=self.settings["save_history"])
        self.timeout_var = tk.StringVar(value=str(self.settings["request_timeout"]))
        self.status_var = tk.StringVar(value="Gateway stopped")

        self.build_ui()
        self.start_server()

        self.root.protocol("WM_DELETE_WINDOW", self.close)
        self.root.after(300, self.refresh_status)

    def log(self, text):
        stamp = datetime.now().strftime("%H:%M:%S")
        line = f"{stamp} {text}"
        self.root.after(0, lambda: self._append_log(line))

    def _append_log(self, line):
        self.log_box.configure(state="normal")
        self.log_box.insert("end", line + "\n")
        self.log_box.see("end")
        self.log_box.configure(state="disabled")

    def build_ui(self):
        main = ttk.Frame(self.root, padding=12)
        main.pack(fill="both", expand=True)

        top = ttk.Frame(main)
        top.pack(fill="x")
        ttk.Label(top, text="Nexus URL Gateway", font=("Segoe UI", 18, "bold")).pack(side="left")
        ttk.Label(top, textvariable=self.status_var).pack(side="right")

        settings = ttk.LabelFrame(main, text="Settings", padding=8)
        settings.pack(fill="x", pady=(10, 8))

        ttk.Label(settings, text="Host").grid(row=0, column=0, sticky="w")
        ttk.Entry(settings, textvariable=self.host_var, width=18).grid(row=0, column=1, padx=5)
        ttk.Label(settings, text="Port").grid(row=0, column=2, sticky="w")
        ttk.Entry(settings, textvariable=self.port_var, width=8).grid(row=0, column=3, padx=5)
        ttk.Label(settings, text="Download folder").grid(row=1, column=0, sticky="w", pady=5)
        ttk.Entry(settings, textvariable=self.folder_var).grid(row=1, column=1, columnspan=2, sticky="ew", padx=5)
        ttk.Button(settings, text="Browse", command=self.browse_folder).grid(row=1, column=3, padx=5)
        ttk.Label(settings, text="Timeout (s)").grid(row=2, column=0, sticky="w")
        ttk.Entry(settings, textvariable=self.timeout_var, width=8).grid(row=2, column=1, padx=5)
        ttk.Checkbutton(settings, text="Auto-download received URLs", variable=self.auto_var).grid(row=2, column=2, columnspan=2, sticky="w")
        ttk.Checkbutton(settings, text="Allow overwrite", variable=self.overwrite_var).grid(row=3, column=1, sticky="w")
        ttk.Checkbutton(settings, text="Save download history", variable=self.history_var).grid(row=3, column=2, sticky="w")
        ttk.Button(settings, text="Apply / Restart Gateway", command=self.apply_settings).grid(row=3, column=3, padx=5)

        paste = ttk.LabelFrame(main, text="Manual URL input", padding=8)
        paste.pack(fill="x", pady=(0, 8))
        self.input_box = tk.Text(paste, height=5, wrap="none")
        self.input_box.pack(fill="x")
        buttons = ttk.Frame(paste)
        buttons.pack(fill="x", pady=(6, 0))
        ttk.Button(buttons, text="Add URLs", command=self.add_pasted).pack(side="left")
        ttk.Button(buttons, text="Add & Download", command=lambda: self.add_pasted(True)).pack(side="left", padx=5)
        ttk.Button(buttons, text="Load urls.txt", command=self.load_file).pack(side="left")
        ttk.Button(buttons, text="Download queued", command=self.start_queued).pack(side="left", padx=5)
        ttk.Button(buttons, text="Clear input", command=lambda: self.input_box.delete("1.0", "end")).pack(side="right")

        queue_frame = ttk.LabelFrame(main, text="Queue / activity", padding=8)
        queue_frame.pack(fill="both", expand=True)
        self.log_box = tk.Text(queue_frame, wrap="none", state="disabled")
        self.log_box.pack(fill="both", expand=True)

        footer = ttk.Frame(main)
        footer.pack(fill="x", pady=(8, 0))
        ttk.Label(footer, text="Gateway endpoint:").pack(side="left")
        self.endpoint_label = ttk.Label(footer, text="")
        self.endpoint_label.pack(side="left", padx=5)
        ttk.Button(footer, text="Stop downloads", command=self.stop_downloads).pack(side="right")

    def browse_folder(self):
        folder = filedialog.askdirectory(initialdir=self.folder_var.get() or str(BASE))
        if folder:
            self.folder_var.set(folder)

    def settings_from_ui(self):
        try:
            port = int(self.port_var.get())
            timeout = int(self.timeout_var.get())
            if not 1 <= port <= 65535:
                raise ValueError("Port must be 1-65535")
            if timeout < 1:
                raise ValueError("Timeout must be positive")
        except ValueError as exc:
            raise ValueError(str(exc))
        return {
            "host": self.host_var.get().strip() or "127.0.0.1",
            "port": port,
            "download_folder": self.folder_var.get().strip() or str(BASE / "downloads"),
            "auto_download": self.auto_var.get(),
            "overwrite_existing": self.overwrite_var.get(),
            "save_history": self.history_var.get(),
            "max_queue_size": int(self.settings.get("max_queue_size", 1000)),
            "request_timeout": timeout,
            "user_agent": self.settings.get("user_agent", DEFAULTS["user_agent"]),
        }

    def apply_settings(self):
        try:
            new_settings = self.settings_from_ui()
        except ValueError as exc:
            messagebox.showerror("Invalid settings", str(exc))
            return
        self.settings = new_settings
        save_settings(self.settings)
        self.stop_server()
        self.start_server()
        self.log("Settings applied")

    def start_server(self):
        host = self.settings["host"]
        port = int(self.settings["port"])
        app = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, fmt, *args):
                app.log("HTTP " + (fmt % args))

            def send_json(self, code, payload):
                body = json.dumps(payload).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Access-Control-Allow-Methods", "POST,GET,OPTIONS")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_OPTIONS(self):
                self.send_json(200, {"ok": True})

            def do_GET(self):
                if self.path == "/api/status":
                    self.send_json(200, app.status_payload())
                else:
                    self.send_json(404, {"ok": False, "error": "Not found"})

            def do_POST(self):
                if self.path != "/api/url":
                    self.send_json(404, {"ok": False, "error": "Not found"})
                    return
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    body = self.rfile.read(length)
                    data = json.loads(body.decode("utf-8"))
                    url = str(data.get("url", "")).strip()
                    result = app.receive_url(url)
                    self.send_json(200 if result["ok"] else 400, result)
                except Exception as exc:
                    self.send_json(400, {"ok": False, "error": str(exc)})

        try:
            self.server = ThreadingHTTPServer((host, port), Handler)
            self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
            self.server_thread.start()
            self.endpoint_label.configure(text=f"http://{host}:{port}")
            self.status_var.set("Gateway running")
            self.log(f"Gateway listening on http://{host}:{port}")
        except OSError as exc:
            self.status_var.set("Gateway failed")
            self.log(f"Gateway start failed: {exc}")

    def stop_server(self):
        if self.server:
            try:
                self.server.shutdown()
                self.server.server_close()
            except Exception:
                pass
            self.server = None

    def receive_url(self, url):
        try:
            normalized = normalize_url(url)
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

        if normalized in self.seen:
            return {"ok": True, "duplicate": True, "queued": False}

        self.seen.add(normalized)
        try:
            self.jobs.put_nowait(normalized)
        except queue.Full:
            self.seen.discard(normalized)
            return {"ok": False, "error": "Download queue is full"}

        auto = bool(self.settings["auto_download"])
        self.log(f"Received URL: {url}")
        if auto:
            self.log("Queued for automatic download")
        else:
            self.log("Queued; auto-download is disabled")
        return {"ok": True, "queued": True, "auto_download": auto}

    def add_pasted(self, start=False):
        raw = self.input_box.get("1.0", "end")
        urls = [x.strip() for x in raw.splitlines() if x.strip() and not x.lstrip().startswith("#")]
        added = 0
        for url in urls:
            result = self.receive_url(url)
            if result.get("ok") and not result.get("duplicate"):
                added += 1
        self.log(f"Added {added} URL(s) from manual input")
        if start:
            self.start_queued()

    def load_file(self):
        if not URLS_FILE.exists():
            messagebox.showinfo("urls.txt", "urls.txt does not exist yet.")
            return
        self.input_box.delete("1.0", "end")
        self.input_box.insert("1.0", URLS_FILE.read_text(encoding="utf-8"))
        self.log("Loaded urls.txt into manual input")

    def start_queued(self):
        self.log("Queued URLs are processed automatically when auto-download is enabled")

    def stop_downloads(self):
        while True:
            try:
                self.jobs.get_nowait()
                self.jobs.task_done()
            except queue.Empty:
                break
        self.log("Pending downloads cleared")

    def worker(self):
        while self.running:
            try:
                url = self.jobs.get(timeout=0.5)
            except queue.Empty:
                continue
            try:
                if not self.settings["auto_download"]:
                    self.log(f"Waiting for auto-download to be enabled: {url}")
                    while self.running and not self.settings["auto_download"]:
                        time.sleep(0.5)
                if self.running:
                    self.log(f"Starting download: {url}")
                    result = download(
                        url,
                        self.settings["download_folder"],
                        timeout=int(self.settings["request_timeout"]),
                        overwrite=bool(self.settings["overwrite_existing"]),
                        user_agent=self.settings["user_agent"],
                        progress=lambda received, total: None,
                    )
                    self.log(f"Downloaded: {result['filename']} -> {result['path']}")
                    if self.settings["save_history"]:
                        with HISTORY_FILE.open("a", encoding="utf-8") as handle:
                            handle.write(f"{datetime.now().isoformat(timespec='seconds')}\t{url}\t{result['path']}\n")
            except urllib.error.HTTPError as exc:
                self.log(f"Download HTTP error {exc.code}: {url}")
            except Exception as exc:
                self.log(f"Download failed: {exc}")
            finally:
                self.jobs.task_done()

    def status_payload(self):
        return {
            "ok": True,
            "running": self.running,
            "auto_download": self.settings["auto_download"],
            "queue_size": self.jobs.qsize(),
            "download_folder": str(Path(self.settings["download_folder"]).expanduser().resolve()),
        }

    def refresh_status(self):
        if not self.running:
            return
        self.status_var.set(
            f"Gateway running · queued {self.jobs.qsize()} · auto {'ON' if self.settings['auto_download'] else 'OFF'}"
        )
        self.root.after(500, self.refresh_status)

    def close(self):
        self.running = False
        self.stop_server()
        self.root.destroy()


if __name__ == "__main__":
    root = tk.Tk()
    app = GatewayApp(root)
    root.mainloop()

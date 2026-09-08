#!/usr/bin/env python3
"""mira-app 日志收集服务（跑在 agent 沙箱）。

App 端（原生 VeepooRing.m + JS RingBleManager.ts）会把 [VeepooRing] 相关日志
POST 到 http://<Mac-LAN-IP>:8899/log，本服务写入 /tmp/mira-logs/collector.log，
agent 直接读该文件即可看到实时日志，无需用户在终端粘贴。

GET / 返回当前已收集的日志（便于自测）。
"""
import http.server
import json
import os
from datetime import datetime

LOG_DIR = "/tmp/mira-logs"
os.makedirs(LOG_DIR, exist_ok=True)
LOG_PATH = os.path.join(LOG_DIR, "collector.log")


class Handler(http.server.BaseHTTPRequestHandler):
    def _write(self, line: str):
        with open(LOG_PATH, "a") as f:
            f.write(line + "\n")
            f.flush()

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(n) if n else b""
        # /dump：结构化诊断快照（exportDebugDump），单独落盘供 agent 分析
        if self.path == "/dump":
            try:
                d = json.loads(raw.decode("utf-8", "replace"))
                with open(os.path.join(LOG_DIR, "dump.json"), "w") as f:
                    json.dump(d, f, ensure_ascii=False, indent=1)
                self._write(f"{datetime.now():%H:%M:%S} [DUMP] saved {len(raw)} bytes")
            except Exception as e:
                self._write(f"{datetime.now():%H:%M:%S} [DUMP] parse fail: {e}")
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"ok")
            return
        try:
            d = json.loads(raw.decode("utf-8", "replace"))
            tag = d.get("tag", "?")
            msg = d.get("msg", "")
            line = f"{datetime.now():%H:%M:%S} [{tag}] {msg}"
        except Exception:
            line = f"{datetime.now():%H:%M:%S} [RAW] {raw.decode('utf-8','replace')}"
        self._write(line)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        try:
            with open(LOG_PATH, "r") as f:
                data = f.read()
        except Exception:
            data = ""
        self.wfile.write(data.encode("utf-8"))

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    srv = http.server.ThreadingHTTPServer(("0.0.0.0", 8899), Handler)
    print(f"collector listening on 0.0.0.0:8899 -> {LOG_PATH}")
    srv.serve_forever()

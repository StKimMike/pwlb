#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""保卫萝卜 · 复刻版 —— 本地 HTTP 服务器。

只用 Python 标准库，负责三件事：
  * 托管 web/ 下的静态资源（HTML / CSS / JS / JSON / 贴图）
  * 提供 /api/health /api/profile /api/score /api/leaderboard
  * 把玩家档案与成绩原子写入 saves/，避免半截文件

用法：
    python server.py
    python server.py --port 8080 --host 0.0.0.0
    python server.py --no-open
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import tempfile
import threading
import time
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

VERSION = "1.0.0"

ROOT = Path(__file__).resolve().parent
WEB_DIR = (ROOT / "web").resolve()
SAVE_DIR = (ROOT / "saves").resolve()
PROFILE_FILE = SAVE_DIR / "profile.json"
SCORES_FILE = SAVE_DIR / "scores.json"

MAX_BODY = 1024 * 1024  # 请求体上限 1MB

DEFAULT_PROFILE = {
    "coins": 0,
    "stars": {},
    "unlocked": ["lv1"],
    "levels": {},
    "sound": True,
    "music": True,
    "volume": 0.7,
    "createdAt": "",
}

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
}

_SAVE_LOCK = threading.Lock()


# --------------------------------------------------------------------------
# 小工具
# --------------------------------------------------------------------------
def utc_now_iso() -> str:
    """本地时区的 ISO 时间字符串。"""
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def ensure_save_dir() -> None:
    SAVE_DIR.mkdir(parents=True, exist_ok=True)


def atomic_write_text(path: Path, text: str) -> None:
    """先写临时文件再 os.replace，保证读到的永远是完整 JSON。"""
    ensure_save_dir()
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass


def read_json_file(path: Path, fallback):
    """读 JSON；坏档改名备份后回退默认值。"""
    if not path.exists():
        return fallback
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        try:
            path.replace(path.with_name(path.name + ".broken"))
        except OSError:
            pass
        return fallback


def make_default_profile() -> dict:
    prof = json.loads(json.dumps(DEFAULT_PROFILE))
    prof["createdAt"] = utc_now_iso()
    return prof


# --------------------------------------------------------------------------
# 校验
# --------------------------------------------------------------------------
def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def normalize_profile(raw) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("档案必须是 JSON 对象")

    prof = make_default_profile()

    coins = raw.get("coins", 0)
    if isinstance(coins, bool) or not isinstance(coins, int) or coins < 0:
        raise ValueError("coins 必须是非负整数")
    prof["coins"] = coins

    stars = raw.get("stars", {})
    if not isinstance(stars, dict):
        raise ValueError("stars 必须是对象")
    clean_stars = {}
    for key, value in stars.items():
        if not isinstance(key, str) or not key or len(key) > 32:
            raise ValueError("stars 的键必须是关卡 id 字符串")
        if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 3:
            raise ValueError("stars 的值必须是 0..3 的整数")
        clean_stars[key] = value
    prof["stars"] = clean_stars

    unlocked = raw.get("unlocked", ["lv1"])
    if not isinstance(unlocked, list) or not all(isinstance(x, str) for x in unlocked):
        raise ValueError("unlocked 必须是字符串数组")
    prof["unlocked"] = sorted({x[:32] for x in unlocked} | {"lv1"})

    levels = raw.get("levels", {})
    if not isinstance(levels, dict):
        raise ValueError("levels 必须是对象")
    clean_levels = {}
    for key, value in levels.items():
        if not isinstance(key, str) or not key or len(key) > 32:
            raise ValueError("levels 的键必须是关卡 id 字符串")
        if not isinstance(value, dict):
            raise ValueError("levels 的每项必须是对象")
        entry = {}
        for field in ("bestStars", "bestTime", "bestCoins", "plays"):
            if field not in value:
                continue
            val = value[field]
            if not _is_number(val) or val < 0:
                raise ValueError("levels.%s.%s 必须是非负数字" % (key, field))
            entry[field] = val
        clean_levels[key] = entry
    prof["levels"] = clean_levels

    for field in ("sound", "music"):
        val = raw.get(field, True)
        if not isinstance(val, bool):
            raise ValueError("%s 必须是布尔值" % field)
        prof[field] = val

    volume = raw.get("volume", 0.7)
    if not _is_number(volume) or not 0 <= volume <= 1:
        raise ValueError("volume 必须是 0..1 之间的数字")
    prof["volume"] = round(float(volume), 3)

    created = raw.get("createdAt")
    prof["createdAt"] = created if isinstance(created, str) and created else utc_now_iso()
    return prof


def normalize_score(raw) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("成绩必须是 JSON 对象")

    level = raw.get("level")
    if not isinstance(level, str) or not level.strip():
        raise ValueError("level 必须是非空字符串")

    stars = raw.get("stars", 0)
    if isinstance(stars, bool) or not isinstance(stars, int) or not 0 <= stars <= 3:
        raise ValueError("stars 必须是 0..3 的整数")

    time_used = raw.get("time", 0)
    coins = raw.get("coins", 0)
    for name, val in (("time", time_used), ("coins", coins)):
        if not _is_number(val) or val < 0:
            raise ValueError("%s 必须是非负数字" % name)

    return {
        "level": level.strip()[:32],
        "stars": stars,
        "time": round(float(time_used), 2),
        "coins": int(coins),
        "at": utc_now_iso(),
        "ts": time.time(),
    }


# --------------------------------------------------------------------------
# HTTP 处理
# --------------------------------------------------------------------------
class AppHandler(BaseHTTPRequestHandler):
    server_version = "PwlbServer/" + VERSION
    protocol_version = "HTTP/1.1"

    # ---- 日志 ----
    def log_message(self, fmt, *args):
        sys.stdout.write("  [%s] %s\n" % (time.strftime("%H:%M:%S"), fmt % args))
        sys.stdout.flush()

    def handle_one_request(self):
        """浏览器刷新/关页会直接掐断连接，属正常现象，不打印堆栈。"""
        try:
            super().handle_one_request()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            self.close_connection = True

    # ---- 回写 ----
    def _send(self, code, body: bytes, ctype: str, cache: str = "no-cache", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        if extra:
            for key, value in extra.items():
                self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD" and body:
            self.wfile.write(body)

    def _send_json(self, code, obj, cache: str = "no-cache"):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self._send(code, body, "application/json; charset=utf-8", cache)

    def _read_body(self) -> bytes:
        raw_len = self.headers.get("Content-Length")
        if raw_len is None:
            return b""
        try:
            length = int(raw_len)
        except (TypeError, ValueError):
            raise ValueError("Content-Length 非法")
        if length < 0 or length > MAX_BODY:
            raise ValueError("请求体过大（上限 1MB）")
        return self.rfile.read(length)

    # ---- 静态资源 ----
    def _serve_static(self, url_path: str) -> None:
        rel = unquote(url_path).lstrip("/")
        if not rel or rel.endswith("/"):
            rel += "index.html"
        try:
            target = (WEB_DIR / rel).resolve()
        except (OSError, ValueError):
            self._send_json(400, {"error": "非法路径"})
            return
        try:
            target.relative_to(WEB_DIR)
        except ValueError:
            self._send_json(403, {"error": "禁止越界访问"})
            return
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            self._send_json(404, {"error": "not found", "path": rel})
            return
        suffix = target.suffix.lower()
        ctype = MIME_TYPES.get(suffix, "application/octet-stream")
        cache = "no-cache" if suffix == ".html" else "public, max-age=60"
        try:
            data = target.read_bytes()
        except OSError as exc:
            self._send_json(500, {"error": "读取失败: %s" % exc})
            return
        self._send(200, data, ctype, cache)

    # ---- API ----
    def _handle_api(self, path: str, query: dict) -> None:
        if path == "/api/health":
            if self.command not in ("GET", "HEAD"):
                self._send_json(405, {"error": "method not allowed"})
                return
            self._send_json(200, {"ok": True, "version": VERSION, "time": utc_now_iso()})
            return

        if path == "/api/profile":
            self._api_profile()
            return

        if path == "/api/score":
            self._api_score()
            return

        if path == "/api/leaderboard":
            self._api_leaderboard(query)
            return

        self._send_json(404, {"error": "unknown api", "path": path})

    def _api_profile(self) -> None:
        if self.command in ("GET", "HEAD"):
            prof = read_json_file(PROFILE_FILE, None)
            if not isinstance(prof, dict):
                prof = make_default_profile()
                with _SAVE_LOCK:
                    atomic_write_text(PROFILE_FILE, json.dumps(prof, ensure_ascii=False, indent=2))
            self._send_json(200, prof)
            return

        if self.command == "POST":
            try:
                payload = json.loads(self._read_body().decode("utf-8") or "{}")
                prof = normalize_profile(payload)
            except (ValueError, UnicodeDecodeError) as exc:
                self._send_json(400, {"error": str(exc)})
                return
            with _SAVE_LOCK:
                atomic_write_text(PROFILE_FILE, json.dumps(prof, ensure_ascii=False, indent=2))
            self._send_json(200, {"ok": True, "profile": prof})
            return

        self._send_json(405, {"error": "method not allowed"})

    def _api_score(self) -> None:
        if self.command != "POST":
            self._send_json(405, {"error": "method not allowed"})
            return
        try:
            payload = json.loads(self._read_body().decode("utf-8") or "{}")
            entry = normalize_score(payload)
        except (ValueError, UnicodeDecodeError) as exc:
            self._send_json(400, {"error": str(exc)})
            return
        with _SAVE_LOCK:
            rows = read_json_file(SCORES_FILE, [])
            if not isinstance(rows, list):
                rows = []
            rows.append(entry)
            rows = rows[-500:]  # 只留最近 500 条
            atomic_write_text(SCORES_FILE, json.dumps(rows, ensure_ascii=False, indent=2))
        self._send_json(200, {"ok": True})

    def _api_leaderboard(self, query: dict) -> None:
        if self.command not in ("GET", "HEAD"):
            self._send_json(405, {"error": "method not allowed"})
            return
        try:
            limit = int((query.get("limit") or ["10"])[0])
        except (TypeError, ValueError):
            limit = 10
        limit = max(1, min(limit, 50))
        rows = read_json_file(SCORES_FILE, [])
        if not isinstance(rows, list):
            rows = []
        rows = [r for r in rows if isinstance(r, dict)]
        rows.sort(key=lambda r: (-int(r.get("stars", 0)), float(r.get("time", 1e9)), float(r.get("ts", 0))))
        items = [
            {
                "level": r.get("level", ""),
                "stars": r.get("stars", 0),
                "time": r.get("time", 0),
                "coins": r.get("coins", 0),
                "at": r.get("at", ""),
            }
            for r in rows[:limit]
        ]
        self._send_json(200, {"items": items})

    # ---- 分发 ----
    def _dispatch(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        if path.startswith("/api/"):
            self._handle_api(path, query)
        else:
            self._serve_static(path)

    def do_GET(self):  # noqa: N802
        self._dispatch()

    def do_HEAD(self):  # noqa: N802
        self._dispatch()

    def do_POST(self):  # noqa: N802
        self._dispatch()


def build_server(host: str, port: int) -> ThreadingHTTPServer:
    ensure_save_dir()
    httpd = ThreadingHTTPServer((host, port), AppHandler)
    httpd.daemon_threads = True
    return httpd


def print_banner(url: str) -> None:
    line = "=" * 58
    print(line)
    print("   保卫萝卜 · 复刻版   v%s" % VERSION)
    print("   地址:  %s" % url)
    print("   存档:  %s" % SAVE_DIR)
    print("   提示:  Ctrl+C 退出")
    print(line)
    sys.stdout.flush()


def port_in_use(host: str, port: int) -> bool:
    """真实探测端口是否已有服务在监听。

    Windows 上 SO_REUSEADDR 允许重复绑定同一个端口，光靠 bind 失败判断不出来，
    所以这里用「连得上就说明被占用」的主动探测。
    """
    probe_host = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.25)
        return sock.connect_ex((probe_host, port)) == 0


def find_server(host: str, preferred: int, tries: int = 20):
    """优先用指定端口；被占了就顺延找下一个空闲端口。

    返回 (httpd, port, jumped)：jumped=True 表示没抢到首选端口、已自动换了一个。
    """
    last_error = None
    for offset in range(tries):
        port = preferred + offset
        if port > 65535:
            break
        if offset == 0 or True:
            if port_in_use(host, port):
                # 已经有人在用：跳过，不算错误
                continue
        try:
            return build_server(host, port), port, offset > 0
        except OSError as exc:
            last_error = exc
            continue
    raise OSError(
        "端口 %d~%d 都被占用：%s" % (preferred, preferred + tries - 1, last_error or "全部在使用中")
    )


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="保卫萝卜复刻版 · 本地服务器")
    parser.add_argument("--port", type=int, default=8000, help="监听端口（默认 8000）")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址（默认 127.0.0.1）")
    parser.add_argument("--no-open", action="store_true", help="启动后不自动打开浏览器")
    parser.add_argument(
        "--strict-port", action="store_true",
        help="端口被占用时直接报错，不自动顺延到下一个端口"
    )
    args = parser.parse_args(argv)

    if not (WEB_DIR / "index.html").is_file():
        print("找不到 web/index.html，请确认目录结构完整。")
        print("当前目录：%s" % ROOT)
        return 2

    try:
        if args.strict_port:
            httpd = build_server(args.host, args.port)
            jumped = False
        else:
            httpd, _chosen, jumped = find_server(args.host, args.port)
    except OSError as exc:
        print("无法启动服务：%s" % exc)
        print("可以换一个端口重试，例如：python server.py --port 8123")
        return 1

    host, port = httpd.server_address[0], httpd.server_address[1]
    shown = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    url = "http://%s:%d/" % (shown, port)
    if jumped:
        print("（端口 %d 已被占用，已自动改用 %d）" % (args.port, port))
    print_banner(url)

    if not args.no_open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever(poll_interval=0.3)
    except KeyboardInterrupt:
        print("\n正在关闭服务器……")
    finally:
        httpd.shutdown()
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

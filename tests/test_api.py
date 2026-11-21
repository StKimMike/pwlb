#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""server.py 的单元测试：直接 python tests/test_api.py 即可运行。"""
from __future__ import annotations

import http.client
import json
import shutil
import sys
import tempfile
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import server as srv  # noqa: E402


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="pwlb-test-"))
        srv.SAVE_DIR = cls.tmp / "saves"
        srv.PROFILE_FILE = srv.SAVE_DIR / "profile.json"
        srv.SCORES_FILE = srv.SAVE_DIR / "scores.json"
        srv.ensure_save_dir()
        cls.httpd = srv.build_server("127.0.0.1", 0)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, kwargs={"poll_interval": 0.05})
        cls.thread.daemon = True
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=3)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    # ---- 请求助手 ----
    def request(self, method, path, body=None, raw=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {}
        payload = None
        if raw is not None:
            payload = raw
        elif body is not None:
            payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        try:
            conn.request(method, path, body=payload, headers=headers)
            resp = conn.getresponse()
            data = resp.read()
            return resp.status, resp, data
        finally:
            conn.close()

    def json_of(self, data):
        return json.loads(data.decode("utf-8"))

    # ---- 用例 ----
    def test_health(self):
        status, resp, data = self.request("GET", "/api/health")
        self.assertEqual(status, 200)
        payload = self.json_of(data)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["version"], srv.VERSION)
        self.assertIn("time", payload)
        self.assertEqual(resp.getheader("Content-Type"), "application/json; charset=utf-8")

    def test_profile_reads_default(self):
        status, _, data = self.request("GET", "/api/profile")
        self.assertEqual(status, 200)
        prof = self.json_of(data)
        self.assertEqual(prof["coins"], 0)
        self.assertEqual(prof["unlocked"], ["lv1"])
        self.assertTrue(prof["createdAt"])
        self.assertTrue(srv.PROFILE_FILE.is_file(), "首次 GET 应落盘默认档案")

    def test_profile_roundtrip(self):
        payload = {
            "coins": 1250,
            "stars": {"lv1": 3, "lv2": 1},
            "unlocked": ["lv1", "lv2", "lv3"],
            "levels": {"lv1": {"bestStars": 3, "bestTime": 61.5, "bestCoins": 220}},
            "sound": False,
            "music": True,
            "volume": 0.35,
        }
        status, _, data = self.request("POST", "/api/profile", body=payload)
        self.assertEqual(status, 200)
        saved = self.json_of(data)["profile"]
        self.assertEqual(saved["coins"], 1250)
        self.assertEqual(saved["stars"]["lv2"], 1)
        self.assertFalse(saved["sound"])
        self.assertAlmostEqual(saved["volume"], 0.35, places=3)

        status, _, data = self.request("GET", "/api/profile")
        reread = self.json_of(data)
        self.assertEqual(reread["coins"], 1250)
        self.assertEqual(reread["levels"]["lv1"]["bestStars"], 3)

    def test_profile_rejects_bad_payload(self):
        bad_cases = [
            {"coins": -3},
            {"coins": "很多"},
            {"stars": {"lv1": 9}},
            {"stars": [1, 2]},
            {"sound": "yes"},
            {"volume": 3},
            {"unlocked": "lv1"},
        ]
        for case in bad_cases:
            with self.subTest(case=case):
                status, _, data = self.request("POST", "/api/profile", body=case)
                self.assertEqual(status, 400, "应拒绝 %s" % case)
                self.assertIn("error", self.json_of(data))

    def test_profile_rejects_broken_json(self):
        status, _, data = self.request("POST", "/api/profile", raw=b"{not json")
        self.assertEqual(status, 400)

    def test_score_and_leaderboard_order(self):
        entries = [
            {"level": "lv3", "stars": 1, "time": 40, "coins": 10},
            {"level": "lv1", "stars": 3, "time": 55, "coins": 30},
            {"level": "lv2", "stars": 3, "time": 48, "coins": 20},
        ]
        for entry in entries:
            status, _, _ = self.request("POST", "/api/score", body=entry)
            self.assertEqual(status, 200)

        status, _, data = self.request("GET", "/api/leaderboard?limit=10")
        self.assertEqual(status, 200)
        items = self.json_of(data)["items"]
        self.assertEqual(len(items), 3)
        self.assertEqual(items[0]["level"], "lv2", "同星级应按时长升序")
        self.assertEqual(items[1]["level"], "lv1")
        self.assertEqual(items[2]["level"], "lv3")

    def test_leaderboard_limit(self):
        status, _, data = self.request("GET", "/api/leaderboard?limit=1")
        self.assertEqual(status, 200)
        self.assertLessEqual(len(self.json_of(data)["items"]), 1)
        status, _, data = self.request("GET", "/api/leaderboard?limit=abc")
        self.assertEqual(status, 200)
        self.assertLessEqual(len(self.json_of(data)["items"]), 10)

    def test_score_validation(self):
        for bad in ({"level": "", "stars": 1}, {"level": "lv1", "stars": 7}, {"stars": 1}):
            with self.subTest(bad=bad):
                status, _, _ = self.request("POST", "/api/score", body=bad)
                self.assertEqual(status, 400)

    def test_unknown_api(self):
        status, _, data = self.request("GET", "/api/nope")
        self.assertEqual(status, 404)
        self.assertIn("error", self.json_of(data))

    def test_static_index_and_assets(self):
        index = srv.WEB_DIR / "index.html"
        if not index.is_file():
            self.skipTest("web/index.html 尚未生成")
        status, resp, data = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", resp.getheader("Content-Type"))
        self.assertGreater(len(data), 500)

        css = srv.WEB_DIR / "css" / "base.css"
        if css.is_file():
            status, resp, _ = self.request("GET", "/css/base.css")
            self.assertEqual(status, 200)
            self.assertIn("text/css", resp.getheader("Content-Type"))
            self.assertIn("max-age=60", resp.getheader("Cache-Control") or "")

    def test_static_traversal_blocked(self):
        status, _, data = self.request("GET", "/../server.py")
        self.assertIn(status, (400, 403, 404))
        if status in (400, 403):
            self.assertIn("error", self.json_of(data))

    def test_static_404(self):
        status, _, data = self.request("GET", "/js/does-not-exist.js")
        self.assertEqual(status, 404)
        self.assertIn("error", self.json_of(data))


if __name__ == "__main__":
    unittest.main(verbosity=2)

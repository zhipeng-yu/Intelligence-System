import inspect
import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from automation import network_worker
from automation.network_worker import (
    CHINA_TZ,
    WorkerBlocked,
    detail_result,
    deterministic_summary,
    is_video,
    matches_all,
    normalize_text,
    process_job,
)


class NetworkWorkerTest(unittest.TestCase):
    def setUp(self):
        self.now = datetime.now(CHINA_TZ).replace(microsecond=0)
        self.job = {
            "id": "job",
            "accounts": ["a" * 24, "b" * 24],
            "keywords": ["课程", "阅读"],
            "window_start_at": (self.now - timedelta(days=7)).isoformat(),
            "created_at": self.now.isoformat(),
        }

    def test_normalization_and_and_matching_are_deterministic(self):
        self.assertEqual(normalize_text("  ＡBC\n课程  "), "abc 课程")
        self.assertTrue(matches_all("阅读课程", "适合老师", ["课程", "阅读"]))
        self.assertTrue(matches_all("阅读", "系统课程说明", ["课程", "阅读"]))
        self.assertFalse(matches_all("阅读", "系统说明", ["课程", "阅读"]))

    def test_video_is_excluded_at_homepage_and_detail_shapes(self):
        self.assertTrue(is_video({"noteCard": {"type": "video"}}))
        self.assertTrue(is_video({"note": {"type": "视频"}}))
        self.assertFalse(is_video({"note": {"type": "normal"}}))
        detail = {"note": {
            "type": "video", "title": "阅读课程", "desc": "明确公开文案", "time": int(self.now.timestamp())
        }}
        self.assertIsNone(detail_result(
            "a" * 24, "公开账号", "c" * 24, detail, self.job["keywords"],
            self.now - timedelta(days=7), self.now
        ))

    def test_result_has_clean_url_and_100_to_200_character_fact_summary(self):
        detail = {"note": {
            "type": "normal", "title": "阅读课程公开说明", "desc": "课程共 12 节，现价 99 元，面向三年级。",
            "time": int((self.now - timedelta(hours=1)).timestamp())
        }}
        result = detail_result(
            "a" * 24, "公开账号", "c" * 24, detail, self.job["keywords"],
            self.now - timedelta(days=7), self.now
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["url"], f"https://www.xiaohongshu.com/explore/{'c' * 24}")
        self.assertNotIn("?", result["url"])
        self.assertGreaterEqual(len(result["summary"]), 100)
        self.assertLessEqual(len(result["summary"]), 200)
        self.assertIn("12", result["summary"])
        self.assertIn("99", result["summary"])
        self.assertNotIn("xsec_token", json.dumps(result, ensure_ascii=False))

    def test_single_account_failure_preserves_success_and_caps_results_at_30(self):
        def reader(account_id, _job):
            if account_id.startswith("b"):
                raise RuntimeError("主页暂时不可用")
            return [{
                "account_id": account_id,
                "account_name": "账号",
                "published_at": (self.now - timedelta(minutes=index)).isoformat(),
                "title": f"标题 {index}",
                "url": f"https://www.xiaohongshu.com/explore/{index:024x}",
                "summary": "摘" * 100,
            } for index in range(35)]

        payload = process_job(self.job, reader)
        self.assertEqual(payload["status"], "partial")
        self.assertEqual(len(payload["results"]), 30)
        self.assertEqual(payload["failures"][0]["account_id"], "b" * 24)

    def test_security_block_stops_later_accounts(self):
        calls = []

        def reader(account_id, _job):
            calls.append(account_id)
            raise WorkerBlocked("需要人工安全验证")

        with self.assertRaises(WorkerBlocked):
            process_job(self.job, reader)
        self.assertEqual(calls, ["a" * 24])

    def test_halted_state_prevents_claiming_again(self):
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            state_path.write_text('{"halted":true,"reason":"security"}', encoding="utf-8")
            with patch.object(network_worker, "STATE_PATH", state_path), \
                 patch.object(network_worker, "api_request") as api:
                self.assertFalse(network_worker.run_once())
                api.assert_not_called()

    def test_worker_uses_system_edge_contract_and_one_minute_ignore_new_schedule(self):
        source = inspect.getsource(network_worker.collect_account)
        self.assertIn("feeds[:20]", source)
        self.assertNotIn("playwright install", inspect.getsource(network_worker))
        schedule = Path("automation/register_network_worker.ps1").read_text(encoding="utf-8")
        self.assertIn("New-TimeSpan -Minutes 1", schedule)
        self.assertIn("MultipleInstances IgnoreNew", schedule)

    def test_summary_never_needs_ai_or_full_copy(self):
        summary = deterministic_summary("账号", "阅读课程", "共 8 节课，面向三年级。" * 30,
                                        self.now.isoformat(), ["阅读", "课程"])
        self.assertGreaterEqual(len(summary), 100)
        self.assertLessEqual(len(summary), 200)
        self.assertNotIn("AI", inspect.getsource(deterministic_summary))


if __name__ == "__main__":
    unittest.main()

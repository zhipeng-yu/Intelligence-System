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
    detail_result,
    deterministic_summary,
    is_video,
    matches_all,
    normalize_text,
    process_job,
)
from automation.xhs_course_trial import StopTrial


class NetworkWorkerTest(unittest.TestCase):
    def setUp(self):
        self.now = datetime.now(CHINA_TZ).replace(microsecond=0)
        self.job = {
            "id": "job",
            "accounts": ["a" * 24, "b" * 24],
            "keywords": ["课程", "阅读"],
            "window_start_at": (self.now - timedelta(days=7)).isoformat(),
            "created_at": self.now.isoformat(),
            "detail_budget": 40,
        }

    def feed(self, note_id, published=None, title="阅读课程", token="token", kind="normal"):
        return {
            "id": note_id,
            "xsecToken": token,
            "time": int((published or self.now - timedelta(hours=1)).timestamp()),
            "noteCard": {"type": kind, "displayTitle": title},
        }

    def detail(self, title="阅读课程", description="公开说明包含阅读课程", published=None):
        return {"note": {
            "type": "normal", "title": title, "desc": description,
            "time": int((published or self.now - timedelta(hours=1)).timestamp()),
        }}

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
            "type": "video", "title": "阅读课程", "desc": "明确公开文案",
            "time": int(self.now.timestamp()),
        }}
        self.assertIsNone(detail_result(
            "a" * 24, "公开账号", "c" * 24, detail, self.job["keywords"],
            self.now - timedelta(days=7), self.now,
        ))

    def test_result_has_clean_url_and_100_to_200_character_fact_summary(self):
        detail = self.detail(description="课程共 12 节，现价 99 元，面向三年级。")
        result = detail_result(
            "a" * 24, "公开账号", "c" * 24, detail, self.job["keywords"],
            self.now - timedelta(days=7), self.now,
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["url"], f"https://www.xiaohongshu.com/explore/{'c' * 24}")
        self.assertNotIn("?", result["url"])
        self.assertGreaterEqual(len(result["summary"]), 100)
        self.assertLessEqual(len(result["summary"]), 200)
        self.assertIn("12", result["summary"])
        self.assertIn("99", result["summary"])
        self.assertNotIn("xsec_token", json.dumps(result, ensure_ascii=False))

    def test_all_homepages_precede_details_then_filter_dedupe_and_title_sort(self):
        ids = [character * 24 for character in "123"]
        old = self.now - timedelta(days=8)
        events = []

        def accounts(account_id, _job):
            events.append(f"home-{account_id[0]}")
            if account_id.startswith("a"):
                return "账号甲", [
                    self.feed(ids[0], title="普通分享"),
                    self.feed("4" * 24, kind="video"),
                    self.feed("5" * 24, published=old),
                    self.feed("not-an-id"),
                    self.feed("6" * 24, token=""),
                ]
            return "账号乙", [
                self.feed(ids[0], title="阅读课程"),
                self.feed(ids[1], published=self.now - timedelta(minutes=1), title="阅读"),
                self.feed(ids[2], published=self.now, title="普通分享"),
            ]

        def details(candidate):
            events.append(f"detail-{candidate['note_id'][0]}")
            return self.detail(title=candidate["note_id"], description="公开文案包含阅读课程")

        payload = process_job(self.job, accounts, details, started_at=0, clock=lambda: 0)
        self.assertEqual(events[:2], ["home-a", "home-b"])
        self.assertEqual(events[2:], ["detail-1", "detail-2", "detail-3"])
        self.assertEqual(payload["homepage_candidates"], 8)
        self.assertEqual(payload["eligible_candidates"], 3)
        self.assertEqual(payload["detail_opens"], 3)
        self.assertEqual(payload["keyword_checks"], 3)
        self.assertEqual(payload["matched_results"], 3)
        self.assertEqual(payload["termination_reason"], "candidates_exhausted")
        self.assertTrue(any(item["account_id"].startswith("b") for item in payload["results"]))

    def test_detail_open_is_counted_before_failure_and_stops_that_account(self):
        feeds = [self.feed("1" * 24), self.feed("2" * 24)]
        calls = []

        def accounts(account_id, _job):
            if account_id.startswith("b"):
                raise RuntimeError("主页暂时不可用")
            return "账号", feeds

        def details(candidate):
            calls.append(candidate["note_id"])
            raise RuntimeError("详情导航失败")

        payload = process_job(self.job, accounts, details, started_at=0, clock=lambda: 0)
        self.assertEqual(len(calls), 1)
        self.assertEqual(payload["detail_opens"], 1)
        self.assertEqual(payload["keyword_checks"], 0)
        self.assertEqual(payload["matched_results"], 0)
        self.assertEqual(payload["status"], "partial")
        self.assertEqual({item["account_id"] for item in payload["failures"]}, {"a" * 24, "b" * 24})

    def test_thirty_unique_results_stop_detail_navigation_immediately(self):
        first = [self.feed(f"{index:024x}", published=self.now - timedelta(seconds=index)) for index in range(1, 21)]
        second = [self.feed(f"{index:024x}", published=self.now - timedelta(seconds=index)) for index in range(21, 36)]
        calls = []

        def accounts(account_id, _job):
            return "账号", first if account_id.startswith("a") else second

        def details(candidate):
            calls.append(candidate["note_id"])
            return self.detail(title=candidate["note_id"])

        payload = process_job(self.job, accounts, details, started_at=0, clock=lambda: 0)
        self.assertEqual(len(calls), 30)
        self.assertEqual(payload["matched_results"], 30)
        self.assertEqual(payload["termination_reason"], "results_cap")

    def test_budget_and_forty_minute_cutoffs_stop_before_another_detail(self):
        feeds = [self.feed(f"{index:024x}") for index in range(1, 4)]
        accounts = lambda _account, _job: ("账号", feeds)
        budget_job = {**self.job, "accounts": ["a" * 24], "detail_budget": 2}
        calls = []
        payload = process_job(
            budget_job, accounts, lambda candidate: calls.append(candidate) or self.detail(),
            started_at=0, clock=lambda: 0,
        )
        self.assertEqual(len(calls), 2)
        self.assertEqual(payload["detail_opens"], 2)
        self.assertEqual(payload["termination_reason"], "detail_budget_exhausted")
        self.assertEqual(payload["status"], "partial")

        moments = iter((0, network_worker.MAX_RUNTIME_SECONDS))
        calls.clear()
        payload = process_job(
            {**self.job, "accounts": ["a" * 24]}, accounts,
            lambda candidate: calls.append(candidate) or self.detail(),
            started_at=0, clock=lambda: next(moments),
        )
        self.assertEqual(len(calls), 1)
        self.assertEqual(payload["termination_reason"], "runtime_cutoff")
        self.assertEqual(payload["status"], "partial")

    def test_security_block_stops_later_accounts_and_is_not_an_account_failure(self):
        calls = []

        def accounts(account_id, _job):
            calls.append(account_id)
            raise StopTrial("security", "需要人工安全验证")

        payload = process_job(self.job, accounts, lambda _candidate: None)
        self.assertEqual(calls, ["a" * 24])
        self.assertEqual(payload["status"], "blocked")
        self.assertEqual(payload["termination_reason"], "security_blocked")
        self.assertEqual(payload["failures"], [])

    def test_halted_state_prevents_claiming_again(self):
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            state_path.write_text('{"halted":true,"reason":"security"}', encoding="utf-8")
            with patch.object(network_worker, "STATE_PATH", state_path), \
                 patch.object(network_worker, "api_request") as api:
                self.assertFalse(network_worker.run_once())
                api.assert_not_called()

    def test_worker_uses_system_edge_catches_initial_state_security_and_keeps_schedule_boundary(self):
        edge_source = inspect.getsource(network_worker.edge_client_type)
        self.assertIn("def wait_for_initial_state", edge_source)
        self.assertIn('error.__class__.__name__ == "CaptchaError"', edge_source)
        self.assertNotIn("add_init_script", edge_source)
        self.assertNotIn("playwright install", inspect.getsource(network_worker))
        self.assertIn('{"resume": True}', inspect.getsource(network_worker.repair_login))
        schedule = Path("automation/register_network_worker.ps1").read_text(encoding="utf-8")
        self.assertTrue(schedule.isascii())
        self.assertIn("New-TimeSpan -Minutes 1", schedule)
        self.assertIn("MultipleInstances IgnoreNew", schedule)
        self.assertIn("-m automation.network_worker run", schedule)

    def test_summary_never_needs_ai_or_full_copy(self):
        summary = deterministic_summary(
            "账号", "阅读课程", "共 8 节课，面向三年级。" * 30,
            self.now.isoformat(), ["阅读", "课程"],
        )
        self.assertGreaterEqual(len(summary), 100)
        self.assertLessEqual(len(summary), 200)
        self.assertNotIn("AI", inspect.getsource(deterministic_summary))


if __name__ == "__main__":
    unittest.main()

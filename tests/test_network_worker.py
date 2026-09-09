import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

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

    def resolution_client(self, rows=None, profile=None):
        client = MagicMock()
        client._check_captcha.return_value = False
        client.page.url = "https://www.xiaohongshu.com/search_result"
        client.page.get_by_text.return_value.first.is_visible.return_value = False
        client.page.locator.return_value.count.return_value = 0
        client.navigate.side_effect = lambda url: setattr(client.page, "url", url)
        candidate = {"red_id": "Exact_123", "account_id": "a" * 24,
                     "url": "https://www.xiaohongshu.com/user/profile/" + "a" * 24 + "?xsec_token=ephemeral"}
        client.page.evaluate.side_effect = [rows if rows is not None else [candidate],
            profile if profile is not None else {"red_id": "Exact_123", "numbers": ["Exact_123"], "nickname": "测试昵称"}]
        return client, candidate

    @patch.object(network_worker.time, "sleep")
    def test_resolution_requires_exact_search_number_and_verified_profile(self, _sleep):
        client, _ = self.resolution_client()
        payload = network_worker.process_resolution(client, "Exact_123")
        self.assertEqual(payload, {"status": "ready", "red_id": "Exact_123", "account_id": "a" * 24, "nickname": "测试昵称"})
        self.assertEqual(client.navigate.call_count, 2)
        self.assertNotIn("ephemeral", json.dumps(payload))
        client.page.get_by_text.assert_any_call("用户", exact=True)
        for profile in [
            {"red_id": "exact_123", "numbers": ["Exact_123"]},
            {"red_id": "Exact_123", "numbers": ["Other"]},
            {"numbers": ["Exact_123"]},
        ]:
            client, _ = self.resolution_client(profile=profile)
            self.assertEqual(network_worker.process_resolution(client, "Exact_123")["error_code"], "number_mismatch")

    @patch.object(network_worker.time, "sleep")
    def test_resolution_never_uses_nickname_casefold_or_multiple_matches(self, _sleep):
        _, candidate = self.resolution_client()
        cases = [
            ([{**candidate, "red_id": "exact_123", "nickname": "Exact_123"}], "not_found"),
            ([candidate, {**candidate, "account_id": "b" * 24}], "ambiguous"),
            ([{**candidate, "url": "https://evil.invalid/user/profile/" + "a" * 24}], "identity_mismatch"),
            ([{**candidate, "account_id": "Exact_123"}], "identity_mismatch"),
            ([candidate] * 21, "ambiguous"),
        ]
        for rows, code in cases:
            client, _ = self.resolution_client(rows=rows)
            self.assertEqual(network_worker.process_resolution(client, "Exact_123"), {"status": "failed", "error_code": code})
            self.assertEqual(client.navigate.call_count, 1)
        client, _ = self.resolution_client()
        client.page.evaluate.side_effect = [[]] * 5
        client.page.get_by_text.return_value.count.return_value = 1
        self.assertEqual(network_worker.process_resolution(client, "Exact_123")["error_code"], "not_found")
        self.assertEqual(client.navigate.call_count, 1)
        client, _ = self.resolution_client()
        client.page.evaluate.side_effect = [[]] * 5
        client.page.get_by_text.return_value.count.return_value = 0
        self.assertEqual(network_worker.process_resolution(client, "Exact_123")["error_code"], "page_unavailable")

    @patch.object(network_worker.time, "sleep")
    def test_resolution_security_and_login_stop_without_guessing_or_leaking_errors(self, _sleep):
        for issue in ("security", "login", "late_security", "exception"):
            client, _ = self.resolution_client()
            if issue == "security":
                client._check_captcha.return_value = True
            elif issue == "login":
                client.page.locator.return_value.count.return_value = 1
                client.page.locator.return_value.first.is_visible.return_value = True
            elif issue == "late_security":
                client.page.evaluate.side_effect = StopTrial("security", "do not persist URL")
            else:
                client.page.evaluate.side_effect = RuntimeError("https://x.test?xsec_token=ephemeral")
            payload = network_worker.process_resolution(client, "Exact_123")
            self.assertEqual(payload["status"], "failed" if issue == "exception" else "blocked")
            self.assertEqual(client.navigate.call_count, 1)
            self.assertNotIn("ephemeral", json.dumps(payload))

    def test_blocked_resolution_reports_and_halts_even_when_callback_or_close_fails(self):
        for failure in ("callback", "close", "login_error", "none"):
            client = MagicMock()
            if failure == "close":
                client.close.side_effect = RuntimeError("unsafe URL")
            login = MagicMock()
            login.return_value.check_login_status.return_value = (False, None)
            if failure == "login_error":
                login.return_value.check_login_status.side_effect = RuntimeError("unsafe URL")
                client._check_captcha.return_value = True
            job = {"kind": "account_resolution", "id": "resolve-job", "profile_id": "00000000-0000-4000-8000-000000000000", "red_id": "Exact_123", "claim_token": "test-claim"}
            calls = []
            def api(path, _key, payload):
                calls.append((path, payload))
                if path.endswith("claim"):
                    return {"job": job}
                if failure == "callback":
                    raise RuntimeError("simulated API failure")
                return {"status": "blocked"}
            with patch.object(network_worker, "read_state", return_value={}), \
                 patch.object(network_worker, "CREDENTIAL_PATH") as credential, \
                 patch.object(network_worker, "unprotect_secret", return_value="test-key"), \
                 patch.object(network_worker, "api_request", side_effect=api), \
                 patch.object(network_worker, "browser_client_type", return_value=(lambda **_: client, None, login, None)), \
                 patch.object(network_worker, "halt_worker") as halt:
                credential.is_file.return_value = True
                if failure == "callback":
                    with self.assertRaises(RuntimeError):
                        network_worker.run_once()
                else:
                    self.assertFalse(network_worker.run_once())
                halt.assert_called_once()
                self.assertEqual(calls[1][0], "/api/network/worker/accounts/resolve-job")
                self.assertEqual(calls[1][1], {"status": "blocked", "error_code": "security_blocked", "claim_token": "test-claim"})

    def test_profile_cleanup_never_touches_other_user_or_shared_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(network_worker, "PROFILES_PATH", root / "profiles"):
                first = network_worker.profile_path("00000000-0000-4000-8000-000000000001")
                second = network_worker.profile_path("00000000-0000-4000-8000-000000000002")
                for path in (first, second, root / "edge-profile"):
                    path.mkdir(parents=True)
                    (path / "synthetic-session").touch()
                network_worker.clear_profile(first.name)
                self.assertFalse(first.exists())
                self.assertTrue((second / "synthetic-session").exists())
                self.assertTrue((root / "edge-profile" / "synthetic-session").exists())
                for value in ("../edge-profile", "", None):
                    with self.assertRaises((ValueError, RuntimeError)):
                        network_worker.profile_path(value)

    def test_binding_ready_expired_and_security_close_before_reporting(self):
        for expected in ("ready", "expired", "blocked"):
            client = MagicMock()
            client._check_captcha.return_value = expected == "blocked"
            client.page.get_by_text.return_value.first.is_visible.return_value = False
            client.page.locator.return_value.first.screenshot.return_value = b"synthetic PNG"
            login = MagicMock()
            login.return_value.check_login_status.return_value = (True, None)
            events = []
            client.close.side_effect = lambda: events.append("close")
            def api(_path, _key, payload):
                events.append(payload.get("status", "heartbeat"))
                return {"current": True}
            job = {"profile_id": "00000000-0000-4000-8000-000000000001", "claim_token": "test", "status": "queued"}
            with tempfile.TemporaryDirectory() as directory, \
                    patch.object(network_worker, "PROFILES_PATH", Path(directory)), \
                    patch.object(network_worker, "browser_client_type", return_value=(lambda **_: client, None, login, None)), \
                    patch.object(network_worker, "api_request", side_effect=api), \
                    patch.object(network_worker, "read_state", return_value={}), \
                    patch.object(network_worker, "halt_worker") as halt, \
                    patch.object(network_worker.time, "monotonic", side_effect=[0, 121 if expected == "expired" else 1]):
                self.assertEqual(network_worker.process_binding(job, "test"), expected != "blocked")
                self.assertEqual(events[-2:], ["close", expected])
                self.assertEqual(halt.called, expected == "blocked")
                client.page.screenshot.assert_not_called()



if __name__ == "__main__":
    unittest.main()

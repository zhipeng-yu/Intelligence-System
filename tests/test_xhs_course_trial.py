import unittest
import io
import urllib.error
import urllib.request
from pathlib import Path
import inspect

from automation.xhs_course_trial import (
    TARGET_USER_ID,
    HTTP_USER_AGENT,
    clean_feeds,
    extract_note_record,
    edge_client_type,
    is_historical_candidate,
    json_request,
    multipart,
    new_feeds_before_seen,
    report_html,
    StopTrial,
    upload_and_analyze,
)


class TrialFactsTest(unittest.TestCase):
    def test_every_note_has_required_sanitized_fields_and_fact_summary(self):
        record = extract_note_record("65abcdef1234567890abcdef", {
            "note": {
                "title": "我的打卡日常",
                "desc": "记录今天的学习过程。",
                "time": 1787875200000,
            }
        })
        self.assertEqual(set(record), {
            "note_id", "published_at", "source_account", "original_title", "url", "summary",
        })
        self.assertEqual(record["source_account"], TARGET_USER_ID)
        self.assertEqual(record["url"], "https://www.xiaohongshu.com/explore/65abcdef1234567890abcdef")
        self.assertNotIn("?", record["url"])
        self.assertGreaterEqual(len(record["summary"]), 100)
        self.assertLessEqual(len(record["summary"]), 200)

    def test_latest_twenty_are_deduplicated_and_time_sorted(self):
        feeds = [
            {"id": "65abcdef1234567890abcde1", "time": 1000},
            {"id": "65abcdef1234567890abcde2", "time": 3000},
            {"id": "65abcdef1234567890abcde1", "time": 2000},
            {"id": "bad", "time": 4000},
        ]
        self.assertEqual([item["id"] for item in clean_feeds(feeds)], [
            "65abcdef1234567890abcde2", "65abcdef1234567890abcde1",
        ])

    def test_only_front_segment_before_seen_anchor_is_new(self):
        feeds = [
            {"id": "65abcdef1234567890abcde4"},
            {"id": "65abcdef1234567890abcde3"},
            {"id": "65abcdef1234567890abcde2"},
            {"id": "65abcdef1234567890abcde1"},
        ]
        self.assertEqual([item["id"] for item in new_feeds_before_seen(feeds, {
            "65abcdef1234567890abcde2",
        })], ["65abcdef1234567890abcde4", "65abcdef1234567890abcde3"])
        with self.assertRaises(StopTrial):
            new_feeds_before_seen(feeds, {"65abcdef1234567890abcdef"})

    def test_historical_candidate_is_preserved_outside_upload_queue(self):
        self.assertTrue(is_historical_candidate(
            {"published_at": "2023-11-08T11:37+08:00"}, "2026-08-28T12:00:00+08:00"
        ))
        self.assertFalse(is_historical_candidate(
            {"published_at": "2026-08-29T11:37+08:00"}, "2026-08-28T12:00:00+08:00"
        ))

    def test_http_upload_error_keeps_safe_status_and_message(self):
        error = urllib.error.HTTPError(
            "https://example.invalid", 400, "Bad Request", {},
            io.BytesIO('{"error":"文件校验失败。"}'.encode("utf-8")),
        )
        original = urllib.request.urlopen
        urllib.request.urlopen = lambda *_args, **_kwargs: (_ for _ in ()).throw(error)
        try:
            with self.assertRaisesRegex(StopTrial, "HTTP 400.*文件校验失败"):
                json_request(urllib.request.Request("https://example.invalid"), "upload")
        finally:
            urllib.request.urlopen = original

    def test_machine_requests_use_transparent_client_identity(self):
        self.assertEqual(HTTP_USER_AGENT, "Ledu-XHS-Course-Trial/1.0")
        self.assertIn('"User-Agent": HTTP_USER_AGENT', inspect.getsource(upload_and_analyze))

    def test_report_contains_no_transient_query_parameters(self):
        record = extract_note_record("65abcdef1234567890abcdef", {
            "note": {"title": "小学数学课程包报名", "desc": "现价 99 元，适合小学数学", "time": 1787875200}
        })
        document = report_html([record])
        self.assertNotIn("xsec_token", document)
        self.assertNotIn("share_id", document)
        self.assertIn("99 元", record["summary"])

    def test_edge_adapter_has_no_stealth_or_fingerprint_overrides(self):
        source = inspect.getsource(edge_client_type)
        self.assertIn("executable_path=str(EDGE)", source)
        self.assertNotIn("add_init_script", source)
        self.assertNotIn("user_agent", source)
        self.assertNotIn("ignore_default_args", source)

    def test_scheduled_task_is_daily_bounded_and_catches_up(self):
        script = Path("automation/register_xhs_course_trial.ps1").read_text(encoding="utf-8")
        self.assertIn("New-ScheduledTaskTrigger -Daily", script)
        self.assertIn("EndBoundary", script)
        self.assertIn("StartWhenAvailable", script)
        self.assertIn("MultipleInstances IgnoreNew", script)


if __name__ == "__main__":
    unittest.main()

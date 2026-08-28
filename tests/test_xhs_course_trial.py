import unittest
from pathlib import Path
import inspect

from automation.xhs_course_trial import (
    TARGET_USER_ID,
    clean_feeds,
    extract_product,
    edge_client_type,
    is_course_product,
    multipart,
    report_html,
)


class TrialFactsTest(unittest.TestCase):
    def test_only_explicit_course_products_are_included(self):
        self.assertTrue(is_course_product("八年级物理系统课报名", "共 20 课时，早鸟价 399 元"))
        self.assertTrue(is_course_product("教师培训课第 3 期", "开课时间已公布"))
        self.assertFalse(is_course_product("关于课程设计的一点思考", "教育观点分享"))
        self.assertFalse(is_course_product("新款学习机上市", "限时优惠 3999 元"))
        self.assertFalse(is_course_product("新品限时上线", "学习机附课程，价格 3999 元"))
        self.assertFalse(is_course_product("七年级数学教材", "单独教材 49 元"))
        self.assertFalse(is_course_product("周末分享会活动", "课程观点分享，适合教师"))
        self.assertFalse(is_course_product("我的打卡日常", "课程学习心得，适合老师"))

    def test_product_has_required_sanitized_fields_and_fact_summary(self):
        product = extract_product("65abcdef1234567890abcdef", {
            "note": {
                "title": "2026 春季八年级物理系统课报名",
                "desc": "共 20 课时，现价 399 元，早鸟限时优惠。适合八年级物理。",
                "time": 1787875200000,
            }
        })
        self.assertIsNotNone(product)
        self.assertEqual(set(product), {
            "note_id", "product_name", "model", "price", "promotion", "published_at", "audience",
            "source_account", "original_title", "url", "summary",
        })
        self.assertEqual(product["source_account"], TARGET_USER_ID)
        self.assertEqual(product["url"], "https://www.xiaohongshu.com/explore/65abcdef1234567890abcdef")
        self.assertNotIn("?", product["url"])
        self.assertGreaterEqual(len(product["summary"]), 100)
        self.assertLessEqual(len(product["summary"]), 200)

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

    def test_report_contains_no_transient_query_parameters(self):
        product = extract_product("65abcdef1234567890abcdef", {
            "note": {"title": "小学数学课程包报名", "desc": "现价 99 元，适合小学数学", "time": 1787875200}
        })
        document = report_html([product])
        self.assertNotIn("xsec_token", document)
        self.assertNotIn("share_id", document)

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

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from automation import xhs_course_trial as browser

class BrowserTest(unittest.TestCase):
    def test_browser_override_and_missing_executable(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'browser.exe'
            path.touch()
            with patch.dict(os.environ, {browser.BROWSER_ENV: str(path)}):
                self.assertEqual(browser.browser_executable(), path)
                path.unlink()
                with self.assertRaises(browser.StopTrial):
                    browser.browser_executable()

    def test_adapter_uses_only_explicit_profile_and_cleans_history(self):
        class Base:
            def __init__(self, **options):
                self.headless = options['headless']
                self.timeout = 45000
        runtime = MagicMock()
        context = runtime.return_value.start.return_value.chromium.launch_persistent_context.return_value
        page = MagicMock()
        context.pages = [page]
        with tempfile.TemporaryDirectory() as directory, patch.object(browser, 'load_skill', return_value=(runtime, Base, None, None, None)), patch.object(browser, 'browser_executable', return_value=None):
            profile = Path(directory) / 'isolated'
            client_type, *_ = browser.browser_client_type(profile)
            client = client_type(headless=True)
            client.start()
            launch = runtime.return_value.start.return_value.chromium.launch_persistent_context
            self.assertEqual(launch.call_args.kwargs['user_data_dir'], str(profile))
            self.assertNotIn('user_agent', launch.call_args.kwargs)
            context.add_init_script.assert_not_called()
            history = profile / 'Default' / 'History'
            history.parent.mkdir()
            history.write_text('test history', encoding='utf-8')
            marker = profile / 'Default' / 'preserved-test-file'
            marker.touch()
            client.close()
            self.assertFalse(history.exists())
            self.assertTrue(marker.exists())
            context.close.assert_called_once()

    def test_timestamp_and_note_shapes(self):
        self.assertEqual(browser.feed_timestamp({'time': '1700000000000'}), 1700000000)
        self.assertEqual(browser.feed_timestamp({'id': 'invalid'}), 0)
        self.assertEqual(browser.note_text({'note': {'title': ' 标题 ', 'desc': '第一行\n第二行', 'time': 1700000000000}}), ('标题', '第一行 第二行', 1700000000))

if __name__ == '__main__':
    unittest.main()

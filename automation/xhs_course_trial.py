#!/usr/bin/env python3
"""Browser and parsing helpers retained for the network materials worker."""
from __future__ import annotations

import ctypes
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import time
from ctypes import wintypes
from datetime import timedelta, timezone
from pathlib import Path

SKILL_COMMIT = "afa96802d3e61cdd5e7bd7b37ec59182bbe07d37"


BROWSER_ENV = "LEDU_BROWSER_EXECUTABLE"


BROWSER_CANDIDATES = (
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    Path(os.environ.get("LOCALAPPDATA", tempfile.gettempdir())) / "Google/Chrome/Application/chrome.exe",
)


CHINA_TZ = timezone(timedelta(hours=8), "Asia/Shanghai")


NOTIFY_SCRIPT = Path(__file__).with_name("xhs_course_trial_notify.ps1")


EXPECTED_SKILL_SHA256 = {
    "scripts/client.py": "a691d4205fcf92eefab468eddbc6009979fa4eb291c4b1171dbfa1a1d6870622",
    "scripts/login.py": "c966ca2c40e726f26eae140eeef22b2e87ac8e79325cbb4f9f9b92ae8a8c0844",
    "scripts/user.py": "20a010ccbba5d73bb2cd01cc71caf3f1758a6386c8970b0ce1ba1dc1f6343943",
    "scripts/feed.py": "52f2724bf6a175dd0c4714dd4248d9570535d45777b6527aed26779c759846ed",
}


class StopTrial(RuntimeError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(6)}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def notify(title: str, message: str) -> None:
    if not NOTIFY_SCRIPT.exists():
        return
    subprocess.run(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(NOTIFY_SCRIPT),
         "-Title", title[:60], "-Message", message[:180]],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


class DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]


def _blob(data: bytes) -> tuple[DataBlob, object]:
    buffer = ctypes.create_string_buffer(data)
    return DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte))), buffer


def protect_secret(value: str) -> bytes:
    source, source_buffer = _blob(value.encode("utf-8"))
    entropy, entropy_buffer = _blob(b"ledu-xhs-course-trial-v1")
    output = DataBlob()
    crypt = ctypes.windll.crypt32.CryptProtectData
    crypt.argtypes = [ctypes.POINTER(DataBlob), wintypes.LPCWSTR, ctypes.POINTER(DataBlob),
                      ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(DataBlob)]
    crypt.restype = wintypes.BOOL
    if not crypt(
        ctypes.byref(source), None, ctypes.byref(entropy), None, None, 0, ctypes.byref(output)
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(ctypes.cast(output.pbData, ctypes.c_void_p))


def unprotect_secret(data: bytes) -> str:
    source, source_buffer = _blob(data)
    entropy, entropy_buffer = _blob(b"ledu-xhs-course-trial-v1")
    output = DataBlob()
    crypt = ctypes.windll.crypt32.CryptUnprotectData
    crypt.argtypes = [ctypes.POINTER(DataBlob), ctypes.c_void_p, ctypes.POINTER(DataBlob),
                      ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(DataBlob)]
    crypt.restype = wintypes.BOOL
    if not crypt(
        ctypes.byref(source), None, ctypes.byref(entropy), None, None, 0, ctypes.byref(output)
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output.pbData, output.cbData).decode("utf-8")
    finally:
        ctypes.windll.kernel32.LocalFree(ctypes.cast(output.pbData, ctypes.c_void_p))


def skill_dir() -> Path:
    return Path(os.environ.get("USERPROFILE", "")) / ".codex" / "skills" / "xiaohongshu-skill"


def verify_skill() -> Path:
    base = skill_dir()
    for relative, expected in EXPECTED_SKILL_SHA256.items():
        path = base / relative
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise StopTrial("skill", f"小红书技能与锁定提交 {SKILL_COMMIT[:8]} 不一致")
    return base


def load_skill():
    base = verify_skill()
    if str(base) not in sys.path:
        sys.path.insert(0, str(base))
    from playwright.sync_api import sync_playwright
    from scripts.client import XiaohongshuClient
    from scripts.feed import FeedDetailAction
    from scripts.login import LoginAction
    from scripts.user import UserProfileAction
    return sync_playwright, XiaohongshuClient, FeedDetailAction, LoginAction, UserProfileAction


def browser_executable() -> Path | None:
    configured = os.environ.get(BROWSER_ENV)
    if configured:
        path = Path(configured)
        if not path.is_file():
            raise StopTrial("browser", "配置的浏览器不可用")
        return path
    return next((path for path in BROWSER_CANDIDATES if path.is_file()), None)


def browser_client_type(profile_path: Path, *, allow_images: bool = False):
    sync_playwright, base_client, feed_action, login_action, user_action = load_skill()

    class BrowserClient(base_client):
        """Playwright control of an available local Chromium browser."""

        def __init__(self, headless: bool):
            super().__init__(headless=headless, cookie_path=str(profile_path.parent / "unused-cookie-backup.json"),
                             user_data_dir=str(profile_path), timeout=45)

        def start(self):
            profile_path.mkdir(parents=True, exist_ok=True)
            self.playwright = sync_playwright().start()
            options = dict(
                user_data_dir=str(profile_path),
                headless=self.headless,
                locale="zh-CN",
                timezone_id="Asia/Shanghai",
                viewport={"width": 1280, "height": 900},
                service_workers="block",
            )
            executable = browser_executable()
            if executable:
                options["executable_path"] = str(executable)
            self.context = self.playwright.chromium.launch_persistent_context(**options)
            self.context.route(
                "**/*",
                lambda route: route.abort()
                if route.request.resource_type == "media" or (route.request.resource_type == "image" and not allow_images)
                else route.continue_(),
            )
            self.page = self.context.pages[0] if self.context.pages else self.context.new_page()
            self.page.set_default_timeout(self.timeout)

        def close(self):
            try:
                if self.context and self.page and not self.page.is_closed():
                    session = self.context.new_cdp_session(self.page)
                    session.send("Network.clearBrowserCache")
                    session.detach()
            except Exception:
                pass
            if self.context:
                self.context.close()
            if self.playwright:
                self.playwright.stop()
            # Dedicated automation profiles keep login state, but not visited URLs
            # that may contain process-local xsec_token values.
            for relative in ("Default/History", "Default/History-journal", "Default/Visited Links"):
                (profile_path / relative).unlink(missing_ok=True)
            sessions = profile_path / "Default" / "Sessions"
            if sessions.is_dir():
                for path in sessions.iterdir():
                    if path.is_file():
                        path.unlink(missing_ok=True)

        def navigate(self, url: str, wait_until: str = "domcontentloaded"):
            elapsed = time.monotonic() - self._last_navigate_time
            if self._last_navigate_time and elapsed < 3:
                time.sleep(3 - elapsed)
            self.page.goto(url, wait_until=wait_until)
            self._last_navigate_time = time.monotonic()
            self._navigate_count += 1
            try:
                self.page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
            if self._check_captcha():
                raise StopTrial("security", "小红书要求验证，需在浏览器中人工处理")

        def wait_for_initial_state(self, timeout: int = 30000, retries: int = 2):
            def login_required():
                url = (self.page.url or "").lower()
                login = self.page.locator(".login-container .qrcode-img")
                return "/login" in url or (login.count() and login.first.is_visible())

            if login_required():
                raise StopTrial("login", "小红书登录已失效，需在浏览器中人工处理")
            try:
                super().wait_for_initial_state(timeout=timeout, retries=retries)
            except Exception as error:
                if error.__class__.__name__ == "CaptchaError" or self._check_captcha():
                    raise StopTrial("security", "小红书要求验证，需在浏览器中人工处理") from error
                raise
            if login_required():
                raise StopTrial("login", "小红书登录已失效，需在浏览器中人工处理")
            if self._check_captcha():
                raise StopTrial("security", "小红书要求验证，需在浏览器中人工处理")

    return BrowserClient, feed_action, login_action, user_action


def feed_timestamp(feed: dict) -> int:
    for key in ("time", "createTime", "lastUpdateTime"):
        value = feed.get(key)
        if isinstance(value, (int, float)):
            return int(value / 1000 if value > 10_000_000_000 else value)
        if isinstance(value, str) and value.isdigit():
            number = int(value)
            return number // 1000 if number > 10_000_000_000 else number
    note_id = str(feed.get("id", ""))
    return int(note_id[:8], 16) if re.fullmatch(r"[0-9a-fA-F]{24}", note_id) else 0


def note_value(detail: dict) -> dict:
    for key in ("note", "noteCard"):
        value = detail.get(key)
        if isinstance(value, dict):
            return value
    return detail


def text_value(value: object) -> str:
    return re.sub(r"\s+", " ", value.strip()) if isinstance(value, str) else ""


def note_text(detail: dict) -> tuple[str, str, int]:
    note = note_value(detail)
    title = text_value(note.get("title") or note.get("displayTitle"))
    description = text_value(note.get("desc") or note.get("description") or note.get("content"))
    published = note.get("time") or note.get("createTime") or 0
    try:
        published = int(published)
        if published > 10_000_000_000:
            published //= 1000
    except (TypeError, ValueError):
        published = 0
    return title, description, published


def safe_feed_detail(action, client, note_id: str, token: str) -> dict | None:
    url = f"https://www.xiaohongshu.com/explore/{note_id}?xsec_token={token}&xsec_source=pc_user"
    client.navigate(url)
    client.wait_for_initial_state(timeout=30000, retries=0)
    for _ in range(3):
        detail = action._extract_feed_detail(note_id)
        if isinstance(detail, dict):
            return detail
        time.sleep(2)
    return None


if __name__ == "__main__":
    raise SystemExit("旧七日试运行已退役；历史状态保持原样。")

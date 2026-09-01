#!/usr/bin/env python3
"""Seven-day, single-account Xiaohongshu public-note trial."""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import html
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from ctypes import wintypes
from datetime import datetime, timedelta, timezone
from pathlib import Path

TARGET_USER_ID = "565aa55cb8ce1a32c6fdebe7"
SKILL_COMMIT = "afa96802d3e61cdd5e7bd7b37ec59182bbe07d37"
SITE = "https://ledu-school-archive.pages.dev"
HTTP_USER_AGENT = "Ledu-XHS-Course-Trial/1.0"
EDGE = Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
CHINA_TZ = timezone(timedelta(hours=8), "Asia/Shanghai")
ROOT = Path(os.environ.get("LOCALAPPDATA", tempfile.gettempdir())) / "LeduSchoolArchive" / "xhs-course-trial"
STATE_PATH = ROOT / "state.json"
SEEN_PATH = ROOT / "seen.json"
CREDENTIAL_PATH = ROOT / "ingest-key.bin"
PROFILE_PATH = ROOT / "edge-profile"
NOTIFY_SCRIPT = Path(__file__).with_name("xhs_course_trial_notify.ps1")
REGISTER_SCRIPT = Path(__file__).with_name("register_xhs_course_trial.ps1")
TASK_NAME = "Ledu-Xiaohongshu-Course-Trial"
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


class ReadNetworkError(RuntimeError):
    pass


def now() -> datetime:
    return datetime.now(CHINA_TZ)


def iso_now() -> str:
    return now().isoformat(timespec="seconds")


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(6)}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise StopTrial("state", f"本地状态不可用：{path.name}") from error
    if not isinstance(value, dict):
        raise StopTrial("state", f"本地状态格式无效：{path.name}")
    return value


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


def halt(state: dict, code: str, message: str) -> None:
    detail = re.sub(r"\s+", " ", str(message)).strip()[:180]
    state.update({"halted": True, "halt_reason": code, "halt_detail": detail,
                  "status": "halted", "updated_at": iso_now()})
    atomic_json(STATE_PATH, state)
    notify("小红书笔记试运行已停止", message)


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


def edge_client_type(profile_path: Path = PROFILE_PATH):
    sync_playwright, base_client, feed_action, login_action, user_action = load_skill()

    class EdgeClient(base_client):
        """Transparent Playwright control of the installed system Edge."""

        def __init__(self, headless: bool):
            super().__init__(headless=headless, cookie_path=str(profile_path.parent / "unused-cookie-backup.json"),
                             user_data_dir=str(profile_path), timeout=45)

        def start(self):
            if not EDGE.is_file():
                raise StopTrial("edge", "未找到本机 Microsoft Edge")
            profile_path.mkdir(parents=True, exist_ok=True)
            self.playwright = sync_playwright().start()
            self.context = self.playwright.chromium.launch_persistent_context(
                user_data_dir=str(profile_path),
                executable_path=str(EDGE),
                headless=self.headless,
                locale="zh-CN",
                timezone_id="Asia/Shanghai",
                viewport={"width": 1280, "height": 900},
                service_workers="block",
            )
            self.context.route(
                "**/*",
                lambda route: route.abort()
                if route.request.resource_type in {"image", "media"}
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
                raise StopTrial("security", "小红书要求验证，需在 Edge 中人工处理")

    return EdgeClient, feed_action, login_action, user_action


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


def clean_feeds(feeds: object) -> list[dict]:
    if not isinstance(feeds, list):
        return []
    unique: dict[str, dict] = {}
    for feed in feeds:
        if not isinstance(feed, dict):
            continue
        note_id = str(feed.get("id", ""))
        if re.fullmatch(r"[0-9a-fA-F]{24}", note_id):
            unique[note_id] = feed
    return sorted(unique.values(), key=feed_timestamp, reverse=True)


def new_feeds_before_seen(feeds: list[dict], seen_ids: set[str]) -> list[dict]:
    result = []
    for feed in feeds:
        if feed["id"] in seen_ids:
            return result
        result.append(feed)
    raise StopTrial("identity", "主页列表未遇到已见基线锚点，无法安全判断新增笔记")


def get_profile(client, user_action) -> tuple[dict, list[dict]]:
    client.navigate(f"https://www.xiaohongshu.com/user/profile/{TARGET_USER_ID}")
    client.wait_for_initial_state(timeout=30000, retries=0)
    action = user_action(client)
    profile = None
    feeds: list[dict] = []
    for _ in range(6):
        profile = action._extract_user_profile_data()
        feeds = clean_feeds(profile.get("feeds") if isinstance(profile, dict) else None)
        if len(feeds) >= 20:
            break
        client.page.evaluate("window.scrollBy(0, 1200)")
        time.sleep(1)
    if not isinstance(profile, dict) or len(feeds) < 20:
        raise StopTrial("identity", "无法核验目标账号及最新 20 条笔记")
    authors = set()
    for feed in feeds:
        card = feed.get("noteCard")
        user = card.get("user") if isinstance(card, dict) else None
        if isinstance(user, dict) and user.get("userId"):
            authors.add(str(user["userId"]))
    if not authors or authors != {TARGET_USER_ID}:
        raise StopTrial("identity", "小红书主页账号身份与固定 ID 不一致")
    return profile, feeds


def wait_for_login(client, login_action, timeout: int = 600) -> None:
    action = login_action(client)
    logged_in, _ = action.check_login_status(navigate=True)
    if logged_in:
        return
    notify("小红书笔记试运行", "请在已打开的 Edge 中完成小红书登录")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if client._check_captcha():
            notify("需要人工处理", "小红书显示安全验证；自动化已停止")
            input("请在 Edge 中人工处理后按回车退出，再重新运行。")
            raise StopTrial("security", "安全验证需人工处理")
        logged_in, _ = action.check_login_status(navigate=False)
        if logged_in:
            return
        time.sleep(2)
    raise StopTrial("login", "Edge 登录等待超时")


def baseline() -> None:
    if SEEN_PATH.exists():
        raise StopTrial("state", "seen.json 已存在，不会覆盖首次基线")
    edge_client, feed_action, login_action, user_action = edge_client_type()
    client = edge_client(headless=False)
    try:
        client.start()
        wait_for_login(client, login_action)
        _, feeds = get_profile(client, user_action)
        ids = [feed["id"] for feed in feeds[:20]]
    finally:
        client.close()
    timestamp = iso_now()
    atomic_json(SEEN_PATH, {"target_user_id": TARGET_USER_ID, "baseline_at": timestamp, "ids": ids})
    atomic_json(STATE_PATH, {
        "version": 1,
        "target_user_id": TARGET_USER_ID,
        "skill_commit": SKILL_COMMIT,
        "baseline_at": timestamp,
        "start_date": None,
        "end_date": None,
        "pending": [],
        "held_candidates": [],
        "ai_dates": [],
        "active_batch": None,
        "halted": False,
        "halt_reason": None,
        "halt_detail": None,
        "status": "baseline_ready",
        "updated_at": timestamp,
    })
    notify("小红书笔记试运行", "目标账号已核验，20 条笔记基线已建立，未上传且未调用 AI")
    print("基线已完成：20 条 ID，未上传，未调用 AI。")


def repair_login() -> None:
    state = read_json(STATE_PATH)
    edge_client, feed_action, login_action, user_action = edge_client_type()
    client = edge_client(headless=False)
    try:
        client.start()
        wait_for_login(client, login_action)
        get_profile(client, user_action)
    finally:
        client.close()
    if state.get("halt_reason") in {"login", "security", "identity"}:
        state.update({"halted": False, "halt_reason": None, "status": "ready", "updated_at": iso_now()})
        atomic_json(STATE_PATH, state)
    notify("小红书笔记试运行", "Edge 登录与目标账号已重新核验")


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


def first_matches(pattern: str, text: str, limit: int = 3) -> str:
    values = []
    for match in re.finditer(pattern, text, flags=re.IGNORECASE):
        value = text_value(match.group(0))
        if value and value not in values:
            values.append(value)
    return "、".join(values[:limit])


def extract_note_record(note_id: str, detail: dict, fallback_title: str = "") -> dict:
    title, description, published = note_text(detail)
    title = title or text_value(fallback_title) or "无标题笔记"
    text = f"{title}。{description}"
    topics = first_matches(
        r"课程包|课包|系统课|教师培训|师训|课程|教材|阅读|写作|语文|数学|英语|物理|化学|"
        r"科学|编程|教育|文具|学习机|活动|讲座|分享会|日常", text, 6
    )
    price = first_matches(
        r"(?:[\u00a5￥]\s*)?\d+(?:\.\d{1,2})?\s*元(?:\s*/\s*[^\s，。；]{1,8})?|"
        r"[\u00a5￥]\s*\d+(?:\.\d{1,2})?", text
    )
    promotions = first_matches(r"优惠|限时|早鸟|立减|折扣|团购|赠送|满减|原价|现价", text, 4)
    grades = first_matches(r"幼儿园|学前|小学|[\u4e00二三四五六123456]年级|初中|[\u4e03八九789]年级|高中|教师|老师", text, 5)
    subjects = first_matches(r"语文|数学|英语|物理|化学|生物|政治|历史|地理|科学|信息技术|美术|音乐|体育", text, 5)
    audience = " / ".join(value for value in (grades, subjects) if value) or "未注明"
    publish_time = datetime.fromtimestamp(published, CHINA_TZ).isoformat(timespec="minutes") if published else "未注明"
    facts = []
    if topics:
        facts.append(f"明确主题词包括{topics}")
    if price:
        facts.append(f"公开价格信息为{price}")
    if promotions:
        facts.append(f"优惠关键词包括{promotions}")
    if audience != "未注明":
        facts.append(f"适用年级/学科为{audience}")
    fact_sentence = "；".join(facts) if facts else "未识别到可结构化的主题、价格、优惠或适用对象信息"
    summary = (
        f"该公开笔记标题为“{title[:40]}”，发布时间为{publish_time}，"
        f"来源为固定公开主页 ID {TARGET_USER_ID}。{fact_sentence}。"
        "本摘要由固定规则整理，不推测未明示信息，也不保存正文、图片、视频、评论或用户信息。"
    )
    if len(summary) < 100:
        summary += "公开链接已清除临时查询参数。"
    summary = summary[:199].rstrip("，；。") + "。" if len(summary) > 200 else summary
    return {
        "note_id": note_id,
        "original_title": title[:120],
        "published_at": publish_time,
        "source_account": TARGET_USER_ID,
        "url": f"https://www.xiaohongshu.com/explore/{note_id}",
        "summary": summary,
    }


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


def collect_new(seen_ids: set[str]) -> tuple[list[str], list[dict]]:
    edge_client, feed_action, login_action, user_action = edge_client_type()
    client = edge_client(headless=True)
    try:
        client.start()
        logged_in, _ = login_action(client).check_login_status(navigate=True)
        if not logged_in:
            raise StopTrial("login", "小红书登录已失效，请在 Edge 中重新登录")
        _, feeds = get_profile(client, user_action)
        new_feeds = new_feeds_before_seen(feeds, seen_ids)
        records = []
        action = feed_action(client)
        for feed in sorted(new_feeds, key=feed_timestamp):
            token = text_value(feed.get("xsecToken"))
            if not token:
                raise StopTrial("identity", "新笔记缺少当前会话访问参数，已停止")
            detail = safe_feed_detail(action, client, feed["id"], token)
            if not detail:
                raise ReadNetworkError("笔记详情临时不可用")
            fallback = text_value(feed.get("noteCard", {}).get("displayTitle"))
            records.append(extract_note_record(feed["id"], detail, fallback))
        return [feed["id"] for feed in new_feeds], records
    except (StopTrial, ReadNetworkError):
        raise
    except Exception as error:
        raise ReadNetworkError("小红书网络临时不可用") from error
    finally:
        client.close()


def report_html(records: list[dict]) -> str:
    rows = []
    labels = [
        ("original_title", "原文标题"), ("published_at", "发布时间"),
        ("source_account", "来源账号"), ("url", "公开链接"),
        ("summary", "事实摘要"),
    ]
    for index, record in enumerate(records, 1):
        fields = "".join(
            f"<dt>{html.escape(label)}</dt><dd>{html.escape(str(record[key]))}</dd>" for key, label in labels
        )
        rows.append(f"<section><h2>{index}. {html.escape(record['original_title'])}</h2><dl>{fields}</dl></section>")
    return """<!doctype html><meta charset="utf-8"><style>
    @page{size:A4;margin:16mm}body{font-family:'Microsoft YaHei',sans-serif;color:#222;font-size:11pt;line-height:1.6}
    h1{font-size:20pt}h2{font-size:14pt;border-bottom:1px solid #bbb;padding-bottom:4px}section{break-inside:avoid;margin:0 0 16px}
    dl{display:grid;grid-template-columns:110px 1fr;gap:4px 10px}dt{font-weight:700}dd{margin:0;overflow-wrap:anywhere}
    </style><h1>小红书公开笔记日报</h1>""" + "".join(rows)


def make_pdf(records: list[dict]) -> Path:
    ROOT.mkdir(parents=True, exist_ok=True)
    html_path = ROOT / f"report-{secrets.token_hex(6)}.html"
    pdf_path = html_path.with_suffix(".pdf")
    try:
        html_path.write_text(report_html(records), encoding="utf-8")
        result = subprocess.run(
            [str(EDGE), "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
             f"--print-to-pdf={pdf_path}", html_path.resolve().as_uri()],
            check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if result.returncode or not pdf_path.is_file() or pdf_path.read_bytes()[:5] != b"%PDF-":
            raise StopTrial("upload", "系统 Edge 未能生成当日 PDF")
        return pdf_path
    finally:
        html_path.unlink(missing_ok=True)


def multipart(file_path: Path) -> tuple[bytes, str]:
    boundary = f"----ledu{secrets.token_hex(16)}"
    filename = f"xiaohongshu-notes-{now().date().isoformat()}.pdf"
    chunks = [
        (f"--{boundary}\r\nContent-Disposition: form-data; name=\"note\"\r\n\r\n"
         "小红书公开笔记 7 天最小试运行\r\n").encode("utf-8"),
        (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
         "Content-Type: application/pdf\r\n\r\n").encode("utf-8"),
        file_path.read_bytes(),
        f"\r\n--{boundary}--\r\n".encode("ascii"),
    ]
    return b"".join(item.encode("utf-8") if isinstance(item, str) else item for item in chunks), boundary


def json_request(request: urllib.request.Request, stage: str) -> dict:
    label = "上传" if stage == "upload" else "AI"
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            value = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = ""
        try:
            payload = json.loads(error.read(4096).decode("utf-8"))
            if isinstance(payload, dict) and isinstance(payload.get("error"), str):
                detail = re.sub(r"\s+", " ", payload["error"]).strip()[:120]
        except (UnicodeDecodeError, json.JSONDecodeError):
            pass
        suffix = f"：{detail}" if detail else ""
        raise StopTrial(stage, f"生产 {label} 请求失败（HTTP {error.code}）{suffix}") from error
    except (urllib.error.URLError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise StopTrial(stage, f"生产 {label} 请求异常，已停止") from error
    if not isinstance(value, dict):
        raise StopTrial(stage, f"生产 {label} 响应无效，已停止")
    return value


def upload_and_analyze(state: dict, batch: list[dict], day: str) -> None:
    if day in state.get("ai_dates", []) or len(state.get("ai_dates", [])) >= 7:
        raise StopTrial("limit", "已达每日或 7 天 AI 调用上限")
    if not CREDENTIAL_PATH.is_file():
        raise StopTrial("credential", "本地 INGEST_KEY 凭据未配置")
    try:
        key = unprotect_secret(CREDENTIAL_PATH.read_bytes())
    except Exception as error:
        raise StopTrial("credential", "本地 INGEST_KEY 凭据无法由当前 Windows 用户解密") from error
    pdf_path = make_pdf(batch)
    state["active_batch"] = {"date": day, "note_ids": [item["note_id"] for item in batch], "stage": "uploading"}
    atomic_json(STATE_PATH, state)
    try:
        body, boundary = multipart(pdf_path)
        upload = urllib.request.Request(
            f"{SITE}/api/documents", data=body, method="POST",
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "X-Ingest-Key": key,
                     "User-Agent": HTTP_USER_AGENT, "Accept": "application/json"},
        )
        uploaded = json_request(upload, "upload")
        document_id = uploaded.get("document", {}).get("id")
        if not isinstance(document_id, str) or not document_id:
            raise StopTrial("upload", "生产上传未返回文档 ID，已停止")
        state["active_batch"].update({"document_id": document_id, "stage": "uploaded"})
        state.setdefault("ai_dates", []).append(day)
        state["active_batch"]["stage"] = "analyzing"
        atomic_json(STATE_PATH, state)
        analyze = urllib.request.Request(
            f"{SITE}/api/documents/{document_id}/analyze", data=b"", method="POST",
            headers={"User-Agent": HTTP_USER_AGENT, "Accept": "application/json"},
        )
        analyzed = json_request(analyze, "ai")
        if analyzed.get("ai_status") != "completed":
            raise StopTrial("ai", "生产 AI 未完成，已停止")
        used = set(state["active_batch"]["note_ids"])
        state["pending"] = [item for item in state.get("pending", []) if item.get("note_id") not in used]
        state.update({"active_batch": None, "status": "completed", "last_completed_date": day,
                      "updated_at": iso_now()})
        atomic_json(STATE_PATH, state)
        notify("小红书试运行", f"{day} 已上传 {len(batch)} 条公开笔记并完成 AI 整理")
    finally:
        key = ""
        pdf_path.unlink(missing_ok=True)


def run_once(state: dict, seen: dict) -> None:
    day = now().date().isoformat()
    start = state.get("start_date")
    end = state.get("end_date")
    if not start or not end:
        raise StopTrial("schedule", "试运行日期尚未配置")
    if day < start:
        return
    if day > end:
        if state.get("status") != "ended":
            state.update({"status": "ended", "updated_at": iso_now()})
            atomic_json(STATE_PATH, state)
            notify("小红书笔记试运行", "7 个自然日试运行已结束，失败日未延长周期")
        return
    if state.get("active_batch"):
        raise StopTrial("upload", "上次上传或 AI 结果不确定，为防止重复已停止")
    known = set(seen.get("ids", []))
    new_ids, records = collect_new(known)
    if new_ids:
        seen["ids"] = list(dict.fromkeys(seen.get("ids", []) + new_ids))
        seen["updated_at"] = iso_now()
        atomic_json(SEEN_PATH, seen)
    pending_by_id = {item["note_id"]: item for item in state.get("pending", []) if isinstance(item, dict)}
    for record in records:
        pending_by_id[record["note_id"]] = record
    state["pending"] = list(pending_by_id.values())
    state.update({"last_scan_date": day, "status": "ready", "updated_at": iso_now()})
    atomic_json(STATE_PATH, state)
    if not state["pending"]:
        state["status"] = "no_new_notes"
        atomic_json(STATE_PATH, state)
        return
    if day in state.get("ai_dates", []):
        state["status"] = "daily_ai_limit_reached"
        atomic_json(STATE_PATH, state)
        return
    upload_and_analyze(state, state["pending"][:10], day)


def run_daily() -> bool:
    try:
        state = read_json(STATE_PATH)
        seen = read_json(SEEN_PATH)
    except StopTrial as error:
        notify("小红书笔记试运行已停止", str(error))
        return False
    if state.get("halted"):
        return False
    for attempt in range(2):
        try:
            run_once(state, seen)
            return True
        except ReadNetworkError:
            if attempt == 0:
                notify("小红书笔记试运行", "临时网络错误，15 分钟后仅重试一次")
                time.sleep(15 * 60)
                continue
            halt(state, "network", "小红书网络重试仍失败，后续任务已停止")
            return False
        except StopTrial as error:
            halt(state, error.code, str(error))
            return False


def is_historical_candidate(item: dict, baseline_at: str) -> bool:
    try:
        return datetime.fromisoformat(str(item.get("published_at"))) < datetime.fromisoformat(baseline_at)
    except (TypeError, ValueError):
        return False


def resume_after_fix() -> None:
    state = read_json(STATE_PATH)
    batch = state.get("active_batch")
    if (state.get("halt_reason") != "upload" or not isinstance(batch, dict)
            or batch.get("stage") != "uploading" or batch.get("document_id")):
        raise StopTrial("state", "当前状态不是可安全恢复的上传前失败")
    baseline_at = str(state.get("baseline_at") or "")
    held = {item.get("note_id"): item for item in state.get("held_candidates", []) if isinstance(item, dict)}
    pending = []
    for item in state.get("pending", []):
        if isinstance(item, dict) and is_historical_candidate(item, baseline_at):
            held[item.get("note_id")] = item
        elif isinstance(item, dict):
            pending.append(item)
    state.update({"pending": pending, "held_candidates": list(held.values()), "active_batch": None,
                  "halted": False, "halt_reason": None, "halt_detail": None,
                  "status": "ready", "updated_at": iso_now()})
    atomic_json(STATE_PATH, state)
    print(f"试运行已恢复；保留历史候选 {len(held)} 条，待处理新增 {len(pending)} 条。")


def provision_secret(repo: Path) -> None:
    if CREDENTIAL_PATH.exists():
        raise StopTrial("credential", "本地 INGEST_KEY 凭据已存在，不会覆盖")
    key = secrets.token_urlsafe(48)
    result = subprocess.run(
        ["npx.cmd", "wrangler", "pages", "secret", "put", "INGEST_KEY",
         "--project-name", "ledu-school-archive"],
        cwd=repo,
        input=key + "\n",
        text=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if result.returncode:
        raise StopTrial("credential", "Cloudflare INGEST_KEY 配置失败")
    try:
        ROOT.mkdir(parents=True, exist_ok=True)
        CREDENTIAL_PATH.write_bytes(protect_secret(key))
    except Exception as error:
        raise StopTrial("credential", "Cloudflare 已接收 INGEST_KEY，但本地 DPAPI 凭据保存失败") from error
    finally:
        key = ""
    print("INGEST_KEY 已配置到 Cloudflare，本地仅保存当前 Windows 用户可解密的凭据。")


def schedule(repo: Path) -> None:
    state = read_json(STATE_PATH)
    if not CREDENTIAL_PATH.is_file():
        raise StopTrial("credential", "请先配置 INGEST_KEY")
    start = now().date() + timedelta(days=1)
    end = start + timedelta(days=6)
    start_boundary = f"{start.isoformat()}T09:00:00"
    end_boundary = f"{(end + timedelta(days=1)).isoformat()}T00:00:00"
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    executable = pythonw if pythonw.is_file() else Path(sys.executable)
    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(REGISTER_SCRIPT),
         "-Python", str(executable), "-Runner", str(Path(__file__).resolve()), "-WorkingDirectory", str(repo),
         "-StartBoundary", start_boundary, "-EndBoundary", end_boundary, "-TaskName", TASK_NAME],
        check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    if result.returncode:
        raise StopTrial("schedule", "Windows 任务计划程序配置失败")
    state.update({"start_date": start.isoformat(), "end_date": end.isoformat(), "status": "scheduled",
                  "updated_at": iso_now()})
    atomic_json(STATE_PATH, state)
    print(f"已计划 {start.isoformat()} 至 {end.isoformat()} 每日 09:00 运行，错过时开机补跑。")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("baseline", "repair-login", "run", "provision-secret", "schedule",
                                             "resume-after-fix"))
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    try:
        if args.command == "baseline":
            baseline()
        elif args.command == "repair-login":
            repair_login()
        elif args.command == "run":
            return 0 if run_daily() else 1
        elif args.command == "provision-secret":
            provision_secret(args.repo.resolve())
        elif args.command == "schedule":
            schedule(args.repo.resolve())
        else:
            resume_after_fix()
        return 0
    except StopTrial as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

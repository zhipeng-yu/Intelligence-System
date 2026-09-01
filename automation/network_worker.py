#!/usr/bin/env python3
"""Single serial system-Edge worker for small-scale network materials."""

from __future__ import annotations

import argparse
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
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Callable

from automation.xhs_course_trial import (
    CHINA_TZ,
    StopTrial,
    atomic_json,
    edge_client_type,
    feed_timestamp,
    note_text,
    notify,
    protect_secret,
    safe_feed_detail,
    text_value,
    unprotect_secret,
)

SITE = "https://ledu-school-archive.pages.dev"
HTTP_USER_AGENT = "Ledu-Network-Materials-Worker/1.0"
ROOT = Path(os.environ.get("LOCALAPPDATA", tempfile.gettempdir())) / "LeduSchoolArchive" / "network-worker"
STATE_PATH = ROOT / "state.json"
CREDENTIAL_PATH = ROOT / "worker-key.bin"
PROFILE_PATH = ROOT / "edge-profile"
REGISTER_SCRIPT = Path(__file__).with_name("register_network_worker.ps1")
TASK_NAME = "Ledu-Network-Materials-Worker"


class WorkerBlocked(RuntimeError):
    pass


class AccountFailure(RuntimeError):
    pass


def normalize_text(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value).strip()).lower()


def matches_all(title: str, description: str, keywords: list[str]) -> bool:
    combined = normalize_text(f"{title} {description}")
    return all(normalize_text(keyword) in combined for keyword in keywords)


def is_video(value: object) -> bool:
    if not isinstance(value, dict):
        return False
    note = value.get("note") or value.get("noteCard") or value
    kind = normalize_text(note.get("type") if isinstance(note, dict) else "")
    return kind in {"video", "视频"} or "video" in kind


def deterministic_summary(account_name: str, title: str, description: str, published_at: str,
                          keywords: list[str]) -> str:
    facts = normalize_text(description)
    numbers = list(dict.fromkeys(re.findall(
        r"(?:￥|¥)?\d+(?:\.\d+)?(?:元|折|天|日|节|课时|人|岁|年级)?", facts
    )))[:4]
    excerpt = facts[:55].rstrip("，,。；; ")
    summary = (
        f"账号“{account_name[:30]}”于{published_at[:10]}发布图文“{title[:45]}”。"
        f"标题与公开文案共同包含检索词“{'、'.join(keywords)}”。"
    )
    if numbers:
        summary += f"文案明确出现的数字信息包括{'、'.join(numbers)}。"
    if excerpt:
        summary += f"公开文案的确定性表述为“{excerpt}”。"
    summary += "摘要仅整理页面明示事实，不推测未说明的信息。"
    if len(summary) < 100:
        summary += "未保存完整文案、图片、视频、评论或临时访问参数。"
    return summary[:199].rstrip("，,。；; ") + "。" if len(summary) > 200 else summary


def detail_result(account_id: str, account_name: str, note_id: str, detail: dict,
                  keywords: list[str], window_start: datetime, window_end: datetime) -> dict | None:
    if is_video(detail):
        return None
    title, description, published = note_text(detail)
    if not title or not published or not matches_all(title, description, keywords):
        return None
    published_at = datetime.fromtimestamp(published, CHINA_TZ)
    if published_at < window_start or published_at > window_end:
        return None
    return {
        "account_id": account_id,
        "account_name": account_name[:100],
        "published_at": published_at.isoformat(timespec="seconds"),
        "title": title[:200],
        "url": f"https://www.xiaohongshu.com/explore/{note_id}",
        "summary": deterministic_summary(account_name, title, description, published_at.isoformat(), keywords),
    }


def api_request(path: str, key: str, payload: dict) -> dict:
    request = urllib.request.Request(
        f"{SITE}{path}", data=json.dumps(payload, ensure_ascii=False).encode("utf-8"), method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": HTTP_USER_AGENT,
            "X-Network-Worker-Key": key,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            value = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"工作器 API 请求失败（HTTP {error.code}）") from error
    except (urllib.error.URLError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("工作器 API 请求异常") from error
    if not isinstance(value, dict):
        raise RuntimeError("工作器 API 响应无效")
    return value


def read_state() -> dict:
    if not STATE_PATH.exists():
        return {"version": 1, "halted": False, "reason": None, "detail": None, "updated_at": None}
    try:
        value = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("工作器状态文件无效") from error
    if not isinstance(value, dict):
        raise RuntimeError("工作器状态文件无效")
    return value


def halt_worker(state: dict, reason: str, detail: str, job_id: str | None = None) -> None:
    safe_detail = re.sub(r"\s+", " ", detail).strip()[:180]
    state.update({
        "halted": True,
        "reason": reason,
        "detail": safe_detail,
        "job_id": job_id,
        "updated_at": datetime.now(CHINA_TZ).isoformat(timespec="seconds"),
    })
    atomic_json(STATE_PATH, state)
    notify("网络资料工作器已停止", safe_detail)


def profile_feeds(client, user_action, account_id: str) -> tuple[str, list[dict]]:
    client.navigate(f"https://www.xiaohongshu.com/user/profile/{account_id}")
    client.wait_for_initial_state(timeout=30000, retries=0)
    action = user_action(client)
    profile = None
    feeds: list[dict] = []
    for _ in range(6):
        profile = action._extract_user_profile_data()
        raw_feeds = profile.get("feeds") if isinstance(profile, dict) else None
        feeds = sorted(
            [item for item in raw_feeds or [] if isinstance(item, dict)],
            key=feed_timestamp,
            reverse=True,
        )[:20]
        if len(feeds) >= 20:
            break
        client.page.evaluate("window.scrollBy(0, 1200)")
        time.sleep(1)
    if not isinstance(profile, dict):
        raise AccountFailure("无法读取账号主页")
    authors = {
        str(item.get("noteCard", {}).get("user", {}).get("userId"))
        for item in feeds if item.get("noteCard", {}).get("user", {}).get("userId")
    }
    if not authors or authors != {account_id}:
        raise AccountFailure("主页账号身份核验失败")
    basic = profile.get("userBasicInfo") or {}
    account_name = text_value(basic.get("nickname") or basic.get("nickName") or account_id)
    return account_name or account_id, feeds


def collect_account(client, feed_action, user_action, account_id: str, job: dict) -> list[dict]:
    account_name, feeds = profile_feeds(client, user_action, account_id)
    window_start = datetime.fromisoformat(job["window_start_at"].replace("Z", "+00:00")).astimezone(CHINA_TZ)
    window_end = datetime.fromisoformat(job["created_at"].replace("Z", "+00:00")).astimezone(CHINA_TZ)
    action = feed_action(client)
    results = []
    for feed in feeds[:20]:
        if is_video(feed):
            continue
        note_id = str(feed.get("id", ""))
        token = text_value(feed.get("xsecToken"))
        if not re.fullmatch(r"[0-9a-f]{24}", note_id) or not token:
            continue
        detail = safe_feed_detail(action, client, note_id, token)
        if not detail:
            continue
        result = detail_result(
            account_id, account_name, note_id, detail, job["keywords"], window_start, window_end
        )
        if result:
            results.append(result)
    return results


def process_job(job: dict, reader: Callable[[str, dict], list[dict]]) -> dict:
    results = []
    failures = []
    for account_id in job["accounts"]:
        try:
            results.extend(reader(account_id, job))
        except WorkerBlocked:
            raise
        except StopTrial as error:
            raise WorkerBlocked(str(error)) from error
        except Exception as error:
            reason = re.sub(r"\s+", " ", str(error)).strip()[:200] or "账号读取失败"
            failures.append({"account_id": account_id, "reason": reason})
    unique = {item["url"]: item for item in results}
    ordered = sorted(unique.values(), key=lambda item: (item["published_at"], item["url"]), reverse=True)[:30]
    return {
        "status": "partial" if failures else "completed",
        "results": ordered,
        "failures": failures,
        "error_detail": "部分账号读取失败，已保留其他账号结果。" if failures else None,
    }


def run_once() -> bool:
    state = read_state()
    if state.get("halted"):
        return False
    if not CREDENTIAL_PATH.is_file():
        raise RuntimeError("本地 NETWORK_WORKER_KEY 凭据未配置")
    key = unprotect_secret(CREDENTIAL_PATH.read_bytes())
    job = None
    try:
        claimed = api_request("/api/network/worker/claim", key, {})
        job = claimed.get("job")
        if job is None:
            return True
        edge_client, feed_action, login_action, user_action = edge_client_type(PROFILE_PATH)
        client = edge_client(headless=True)
        payload = None
        try:
            client.start()
            logged_in, _ = login_action(client).check_login_status(navigate=True)
            if not logged_in:
                raise WorkerBlocked("小红书登录已失效，需在 Edge 中人工处理")
            payload = process_job(
                job, lambda account_id, current: collect_account(
                    client, feed_action, user_action, account_id, current
                )
            )
        except WorkerBlocked as error:
            payload = {"status": "blocked", "results": [], "failures": [], "error_detail": str(error)}
            halt_worker(state, "security", str(error), job["id"])
        except StopTrial as error:
            payload = {"status": "blocked", "results": [], "failures": [], "error_detail": str(error)}
            halt_worker(state, "security", str(error), job["id"])
        finally:
            client.close()
        payload["claim_token"] = job["claim_token"]
        api_request(f"/api/network/worker/jobs/{job['id']}", key, payload)
        return payload["status"] != "blocked"
    finally:
        key = ""


def repair_login() -> None:
    state = read_state()
    edge_client, feed_action, login_action, user_action = edge_client_type(PROFILE_PATH)
    client = edge_client(headless=False)
    try:
        client.start()
        action = login_action(client)
        logged_in, _ = action.check_login_status(navigate=True)
        if not logged_in:
            notify("网络资料工作器", "请在已打开的 Edge 中完成小红书登录")
            deadline = time.monotonic() + 600
            while time.monotonic() < deadline:
                if client._check_captcha():
                    raise WorkerBlocked("请先在 Edge 中完成人工安全验证")
                logged_in, _ = action.check_login_status(navigate=False)
                if logged_in:
                    break
                time.sleep(2)
        if not logged_in:
            raise WorkerBlocked("Edge 登录等待超时")
    finally:
        client.close()
    state.update({"halted": False, "reason": None, "detail": None, "job_id": None,
                  "updated_at": datetime.now(CHINA_TZ).isoformat(timespec="seconds")})
    atomic_json(STATE_PATH, state)
    print("Edge 登录已核验，网络资料工作器已显式恢复。")


def provision_secret(repo: Path) -> None:
    if CREDENTIAL_PATH.exists():
        raise RuntimeError("本地 NETWORK_WORKER_KEY 凭据已存在，不会覆盖")
    key = secrets.token_urlsafe(48)
    result = subprocess.run(
        ["npx.cmd", "wrangler", "pages", "secret", "put", "NETWORK_WORKER_KEY",
         "--project-name", "ledu-school-archive"],
        cwd=repo, input=key + "\n", text=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        check=False,
    )
    if result.returncode:
        raise RuntimeError("Cloudflare NETWORK_WORKER_KEY 配置失败")
    try:
        ROOT.mkdir(parents=True, exist_ok=True)
        CREDENTIAL_PATH.write_bytes(protect_secret(key))
    finally:
        key = ""


def schedule(repo: Path) -> None:
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    executable = pythonw if pythonw.is_file() else Path(sys.executable)
    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(REGISTER_SCRIPT),
         "-Python", str(executable), "-WorkingDirectory", str(repo.resolve()), "-TaskName", TASK_NAME],
        check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    if result.returncode:
        raise RuntimeError("Windows 任务计划程序配置失败")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("run", "repair-login", "provision-secret", "schedule"))
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    try:
        if args.command == "run":
            return 0 if run_once() else 1
        if args.command == "repair-login":
            repair_login()
        elif args.command == "provision-secret":
            provision_secret(args.repo)
        else:
            schedule(args.repo)
        return 0
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

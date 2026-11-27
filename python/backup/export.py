"""Export what git cannot carry: issues, pull requests, comments, reviews and releases.

After the first run only what changed is fetched and laid over the saved copy, so a quiet
repository costs a handful of requests. The first three days of each month read everything again,
because the incremental path never sees a deletion.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from fleet_common import PermanentError, Repo, TransientError, request
from fleet_common.core import GITHUB_API, Session

Item = dict[str, Any]


def get_all(session: Session, url: str, params: dict[str, Any] | None = None, stop_older_than: str | None = None) -> list[Item]:
    """Every item across GitHub's Link header pages.

    A list sorted newest update first can stop at the first page that reaches back past what the
    saved copy already holds, which is how pull requests are read incrementally.
    """
    query: dict[str, Any] | None = {"per_page": 100, **(params or {})}
    items: list[Item] = []
    next_url: str | None = url
    while next_url:
        resp = request(session, "GET", next_url, f"GET {next_url}", params=query)
        if resp.status_code in (401, 403):
            raise PermanentError(f"GET {next_url}: HTTP {resp.status_code}, the token cannot read this")
        if not 200 <= resp.status_code < 300:
            raise PermanentError(f"GET {next_url}: HTTP {resp.status_code}")
        page = resp.json()
        items.extend(page)
        if stop_older_than and page and page[-1].get("updated_at", "~") < stop_older_than:
            break
        next_url = resp.links.get("next", {}).get("url")
        # the next link already carries the page and per_page
        query = None
    return items


def is_full_refresh(today: datetime, forced: bool = False) -> bool:
    return forced or today.day <= 3


def watermark(items: list[Item], full: bool) -> str | None:
    """When the newest saved item changed, less a minute so an edit in the same second is not missed."""
    if full:
        return None
    stamps = [i["updated_at"] for i in items if isinstance(i, dict) and i.get("updated_at")]
    if not stamps:
        return None
    newest = datetime.strptime(max(stamps), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    return (newest - timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%SZ")


def merge(old: list[Item], fresh: list[Item], key: str) -> list[Item]:
    merged = {item[key]: item for item in old}
    merged.update({item[key]: item for item in fresh})
    return list(merged.values())


def load_list(path: Path) -> list[Item]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return data if isinstance(data, list) else []


def write_json(path: Path, data: Any) -> bool:
    """Write sorted, indented JSON. Returns False when the file already held exactly this."""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.write_text(text, encoding="utf-8")
    return True


def export_repo(session: Session, repo: Repo, out: Path, full: bool) -> list[str]:
    """Export one repository into out. Returns the files that changed."""
    base = f"{GITHUB_API}/repos/{repo.full_name}"
    changed: list[str] = []

    def save(name: str, data: Any) -> None:
        if write_json(out / f"{name}.json", data):
            changed.append(name)

    saved = load_list(out / "issues.json")
    since = watermark(saved, full)
    fresh = get_all(session, f"{base}/issues", {"state": "all", **({"since": since} if since else {})})
    # the issues endpoint also returns pull requests, which are saved from their own endpoint
    fresh = [i for i in fresh if "pull_request" not in i]
    issues = merge(saved, fresh, "id") if since else fresh
    save("issues", sorted(issues, key=lambda i: i["number"], reverse=True))

    saved = load_list(out / "pulls.json")
    mark = watermark(saved, full)
    order = {"sort": "updated", "direction": "desc"} if mark else {}
    fresh = get_all(session, f"{base}/pulls", {"state": "all", **order}, stop_older_than=mark)
    pulls = merge(saved, fresh, "number") if mark else fresh
    save("pulls", sorted(pulls, key=lambda p: p["number"], reverse=True))

    for name, path in (("issue-comments", "issues/comments"), ("review-comments", "pulls/comments")):
        saved = load_list(out / f"{name}.json")
        mark = watermark(saved, full)
        fresh = get_all(session, f"{base}/{path}", {"since": mark} if mark else None)
        comments = merge(saved, fresh, "id") if mark else fresh
        save(name, sorted(comments, key=lambda c: c["id"]))

    # releases have no since filter and a repository rarely has many, so they are read in full
    save("releases", sorted(get_all(session, f"{base}/releases"), key=lambda r: r["id"]))
    return changed


def order_by_staleness(repos: list[Repo], state: dict[str, str]) -> list[Repo]:
    # never backed up first, then the oldest, so a run cut short by the budget still moves the
    # whole fleet forward over successive runs
    return sorted(repos, key=lambda r: (state.get(r.full_name, ""), r.full_name))


def run(
    session: Session,
    repos: list[Repo],
    root: Path,
    budget_minutes: int,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
    forced_full: bool = False,
) -> dict[str, list[str]]:
    started = now()
    deadline = started + timedelta(minutes=budget_minutes)
    full = is_full_refresh(started, forced_full)
    state_path = root / "_state.json"
    try:
        state: dict[str, str] = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        state = {}
    report: dict[str, list[str]] = {"exported": [], "unchanged": [], "deferred": [], "transient": [], "failed": []}

    for repo in order_by_staleness(repos, state):
        if now() >= deadline:
            report["deferred"].append(repo.full_name)
            continue
        try:
            changed = export_repo(session, repo, root / repo.owner / repo.name, full)
        except TransientError as exc:
            report["transient"].append(f"{repo.full_name}: {exc}")
            continue
        except PermanentError as exc:
            report["failed"].append(f"{repo.full_name}: {exc}")
            continue
        state[repo.full_name] = now().strftime("%Y-%m-%dT%H:%M:%SZ")
        report["exported" if changed else "unchanged"].append(repo.full_name)

    write_json(state_path, state)
    return report

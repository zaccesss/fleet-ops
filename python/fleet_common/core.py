"""Errors, HTTP sessions, the fleet config and the repository listing."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

GITHUB_API = "https://api.github.com"


class TransientError(Exception):
    """A temporary problem (network, a forge's own outage). The next run retries it."""


class PermanentError(Exception):
    """A problem a person needs to look at (a refused push, a missing permission)."""


class Session(Protocol):
    def request(self, method: str, url: str, **kwargs: Any) -> requests.Response: ...


@dataclass(frozen=True)
class Repo:
    full_name: str
    private: bool
    archived: bool
    description: str
    topics: tuple[str, ...]
    default_branch: str
    size_kib: int

    @property
    def owner(self) -> str:
        return self.full_name.split("/", 1)[0]

    @property
    def name(self) -> str:
        return self.full_name.split("/", 1)[1]


def make_session(headers: dict[str, str]) -> requests.Session:
    # retries cover connection errors and brief 5xx answers. A 4xx is a real answer and is returned
    # at once. Retry-After is honoured, which is how GitLab and GitHub ask a client to slow down.
    retry = Retry(
        total=4,
        backoff_factor=1.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=None,
        respect_retry_after_header=True,
        raise_on_status=False,
    )
    session = requests.Session()
    session.headers.update({"User-Agent": "fleet-ops", **headers})
    session.mount("https://", HTTPAdapter(max_retries=retry))
    return session


def request(session: Session, method: str, url: str, context: str, **kwargs: Any) -> requests.Response:
    try:
        resp = session.request(method, url, timeout=30, **kwargs)
    except requests.RequestException as exc:
        raise TransientError(f"{context}: {type(exc).__name__}") from exc
    if resp.status_code >= 500 or resp.status_code == 429:
        raise TransientError(f"{context}: HTTP {resp.status_code}")
    return resp


def load_config(path: str | None = None) -> dict[str, Any]:
    # the same fleet.json the workers read. FLEET_CONFIG holds the JSON itself when the file is
    # not on disk, which is how a secret store passes it in.
    if path:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    raw = os.environ.get("FLEET_CONFIG")
    if not raw:
        raise PermanentError("FLEET_CONFIG is not set and no --config path was given")
    return json.loads(raw)


def in_scope(config: dict[str, Any], full_name: str) -> bool:
    owner = full_name.split("/", 1)[0].lower()
    owners = {o.lower() for o in config["owners"]}
    excluded = {e.lower() for e in config.get("exclude", [])}
    return owner in owners and full_name.lower() not in excluded


def _repo(row: dict[str, Any]) -> Repo:
    return Repo(
        full_name=row["full_name"],
        private=bool(row["private"]),
        archived=bool(row["archived"]),
        description=row.get("description") or "",
        topics=tuple(row.get("topics") or ()),
        default_branch=row.get("default_branch") or "main",
        size_kib=int(row.get("size") or 0),
    )


def list_repos(session: Session, owner: str) -> list[Repo]:
    # the installation listing covers a user and an organisation the same way and includes private
    # repositories the token can read
    repos: list[Repo] = []
    page = 1
    while True:
        resp = request(session, "GET", f"{GITHUB_API}/installation/repositories?per_page=100&page={page}", f"list {owner}")
        if resp.status_code != 200:
            raise PermanentError(f"list {owner}: HTTP {resp.status_code}")
        rows = resp.json().get("repositories", [])
        repos.extend(_repo(r) for r in rows if r["owner"]["login"].lower() == owner.lower() and not r.get("fork"))
        if len(rows) < 100:
            return repos
        page += 1


def notify(session: Session, url: str | None, job: str, level: str, summary: str, details: list[str]) -> bool:
    # a failed notice never fails the job it reports on
    if not url:
        return False
    try:
        resp = session.request("POST", url, json={"job": job, "level": level, "summary": summary, "details": details[:25]}, timeout=15)
    except requests.RequestException:
        return False
    return resp.ok

"""Fakes for the network and for git. Nothing in the tests reaches a real service."""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest
import requests

from fleet_common import Repo
from mirror.git import Completed

EXAMPLE_CONFIG = Path(__file__).resolve().parents[2] / "config" / "fleet.example.json"


class FakeSession:
    """Answers requests from a list of (method, url pattern, status, json) routes and records every call."""

    def __init__(self, routes: list[tuple[str, str, int, Any]]) -> None:
        self.routes = routes
        self.calls: list[tuple[str, str, Any]] = []

    def request(self, method: str, url: str, **kwargs: Any) -> requests.Response:
        self.calls.append((method, url, kwargs.get("json")))
        for m, pattern, status, body in self.routes:
            if m == method and re.search(pattern, url):
                resp = requests.Response()
                resp.status_code = status
                resp._content = json.dumps(body).encode()
                return resp
        raise AssertionError(f"unexpected request: {method} {url}")


class FakeRunner:
    """Stands in for git. Each answer is matched by the first argument; every call is recorded."""

    def __init__(self, answers: dict[str, list[Completed]] | None = None) -> None:
        self.answers = answers or {}
        self.calls: list[tuple[list[str], str | None, dict[str, str]]] = []

    def __call__(self, args: Sequence[str], cwd: str | None, env: dict[str, str]) -> Completed:
        self.calls.append((list(args), cwd, env))
        key = args[0] if args[0] != "lfs" else f"lfs {args[1]}"
        queue = self.answers.get(key)
        if queue:
            return queue.pop(0) if len(queue) > 1 else queue[0]
        if key == "for-each-ref":
            return Completed(0, "abc commit refs/heads/main\n", "")
        return Completed(0, "", "")


def make_repo(name: str = "site", owner: str = "example-user", **overrides: Any) -> Repo:
    base: dict[str, Any] = {
        "full_name": f"{owner}/{name}",
        "private": False,
        "archived": False,
        "description": "A site",
        "topics": ("web",),
        "default_branch": "main",
        "size_kib": 100,
    }
    base.update(overrides)
    return Repo(**base)


@pytest.fixture
def config() -> dict[str, Any]:
    return json.loads(EXAMPLE_CONFIG.read_text(encoding="utf-8"))

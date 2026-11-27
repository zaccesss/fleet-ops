from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
import requests

from fleet_common import PermanentError, TransientError, in_scope, list_repos, load_config, make_session, notify, request
from tests.conftest import EXAMPLE_CONFIG, FakeSession


def test_loads_the_example_config_from_a_path() -> None:
    assert load_config(str(EXAMPLE_CONFIG))["owners"] == ["example-user", "example-org"]


def test_loads_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FLEET_CONFIG", EXAMPLE_CONFIG.read_text(encoding="utf-8"))
    assert load_config()["mirror"]["gitlabNamespace"] == "example-group"


@pytest.mark.parametrize(
    ("content", "message"),
    [
        ("[]", "not a JSON object"),
        ('{"owners": []}', "missing mirror, backup"),
        ('{"owners": [], "mirror": {}, "backup": {}}', "non-empty"),
    ],
)
def test_refuses_a_config_without_what_the_services_read(tmp_path: Path, content: str, message: str) -> None:
    path = tmp_path / "fleet.json"
    path.write_text(content, encoding="utf-8")
    with pytest.raises(PermanentError, match=message):
        load_config(str(path))


def test_says_what_is_missing_when_nothing_is_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FLEET_CONFIG", raising=False)
    with pytest.raises(PermanentError, match="FLEET_CONFIG is not set"):
        load_config()


def test_scope_ignores_case_and_honours_exclude(config: dict[str, Any]) -> None:
    assert in_scope(config, "Example-User/site")
    assert not in_scope(config, "example-user/archive-only")
    assert not in_scope(config, "stranger/site")


def row(name: str, owner: str = "example-user", **extra: Any) -> dict[str, Any]:
    return {"full_name": f"{owner}/{name}", "owner": {"login": owner}, "private": False, "archived": False, "fork": False, **extra}


def test_lists_one_owner_across_pages_without_forks() -> None:
    page1 = [row(f"r{i}") for i in range(99)] + [row("fork", fork=True)]
    s = FakeSession(
        [
            ("GET", r"page=1$", 200, {"repositories": page1}),
            ("GET", r"page=2$", 200, {"repositories": [row("last"), row("other", owner="example-org")]}),
        ]
    )
    repos = list_repos(s, "example-user")
    assert len(repos) == 100
    assert repos[-1].name == "last"
    assert repos[0].default_branch == "main"


def test_a_refused_listing_is_permanent() -> None:
    with pytest.raises(PermanentError, match="HTTP 401"):
        list_repos(FakeSession([("GET", r".", 401, {})]), "example-user")


class Exploding:
    def request(self, method: str, url: str, **kwargs: Any) -> requests.Response:
        raise requests.ConnectionError("down")


def test_request_turns_network_errors_and_5xx_into_transient() -> None:
    with pytest.raises(TransientError, match="ConnectionError"):
        request(Exploding(), "GET", "https://api.github.com/x", "read")
    with pytest.raises(TransientError, match="HTTP 429"):
        request(FakeSession([("GET", r".", 429, {})]), "GET", "https://api.github.com/x", "read")


def test_notify_posts_a_capped_notice_and_never_raises() -> None:
    s = FakeSession([("POST", r"notify", 204, {})])
    assert notify(s, "https://notify.example.invalid", "mirror", "warn", "1 failed", [str(i) for i in range(40)]) is True
    assert len(s.calls[0][2]["details"]) == 25
    assert notify(Exploding(), "https://notify.example.invalid", "mirror", "fail", "x", []) is False
    assert notify(s, None, "mirror", "fail", "x", []) is False


def test_sessions_carry_the_headers_and_retry_policy() -> None:
    session = make_session({"Authorization": "Bearer t"})
    assert session.headers["Authorization"] == "Bearer t"
    assert session.headers["User-Agent"] == "fleet-ops"
    retry = session.get_adapter("https://api.github.com").max_retries
    assert retry.total == 4
    assert 503 in (retry.status_forcelist or ())


def test_the_example_config_is_valid_json() -> None:
    assert json.loads(EXAMPLE_CONFIG.read_text(encoding="utf-8"))["backup"]["timeBudgetMinutes"] > 0

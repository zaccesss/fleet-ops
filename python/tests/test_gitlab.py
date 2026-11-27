from __future__ import annotations

import pytest

from fleet_common import PermanentError
from mirror import capacity
from mirror.gitlab import GitLab, clean_topics, mirror_path, visibility
from tests.conftest import FakeSession, make_repo

API = "https://gitlab.example.invalid/api/v4"


def gitlab(session: FakeSession) -> GitLab:
    return GitLab(session, "https://gitlab.example.invalid", "example-group")


def test_names_keep_the_first_owner_bare_and_prefix_the_rest() -> None:
    assert mirror_path(make_repo("site"), "example-user") == "site"
    assert mirror_path(make_repo("site", owner="example-org"), "example-user") == "example-org-site"
    assert mirror_path(make_repo(".github"), "example-user") == "github"


def test_a_private_repository_is_never_made_public() -> None:
    assert visibility(make_repo(private=True)) == "private"
    assert visibility(make_repo(private=False)) == "public"


def test_creates_a_missing_project_with_the_repository_visibility() -> None:
    s = FakeSession(
        [
            ("GET", r"/projects/example-group%2Fsite$", 404, {}),
            ("GET", r"/namespaces/example-group$", 200, {"id": 7}),
            ("POST", r"/projects$", 201, {"id": 99}),
        ]
    )
    assert gitlab(s).ensure_project(make_repo(private=True), "site") is True
    assert s.calls[-1][2] == {"name": "site", "path": "site", "namespace_id": 7, "visibility": "private", "initialize_with_readme": False}


def test_leaves_an_existing_project_alone() -> None:
    s = FakeSession([("GET", r"/projects/example-group%2Fsite$", 200, {"id": 1})])
    assert gitlab(s).ensure_project(make_repo(), "site") is False
    assert len(s.calls) == 1


def test_a_visibility_failure_is_fatal_but_a_topics_failure_is_not() -> None:
    s = FakeSession([("PUT", r"/projects/", 400, {"message": "bad"})])
    with pytest.raises(PermanentError):
        gitlab(s).sync_visibility(make_repo(), "site")
    assert gitlab(s).sync_details(make_repo(), "site") is False


def test_removes_every_branch_protection() -> None:
    s = FakeSession(
        [
            ("GET", r"/protected_branches$", 200, [{"name": "main"}, {"name": "release/1"}]),
            ("DELETE", r"/protected_branches/", 204, {}),
        ]
    )
    gitlab(s).unprotect_branches("site")
    assert [c[1].rsplit("/", 1)[1] for c in s.calls if c[0] == "DELETE"] == ["main", "release%2F1"]


def test_the_push_url_carries_no_credential() -> None:
    assert gitlab(FakeSession([])).push_url("site") == "https://gitlab.example.invalid/example-group/site.git"


def test_topics_gitlab_would_refuse_are_dropped() -> None:
    assert clean_topics(("web", "Bad Topic", "x" * 60, "ok-2")) == ["web", "ok-2"]


def test_capacity_warns_with_the_largest_projects() -> None:
    assert capacity.check({"a": 100, "b": 50}, 9000) is None
    warning = capacity.check({"a": 6000, "b": 2500, "c": 900, "d": 10}, 9000)
    assert warning is not None
    assert "9410 MiB" in warning
    assert warning.endswith("a (6000 MiB), b (2500 MiB), c (900 MiB)")


def test_usage_pages_through_the_group() -> None:
    first = [{"path": f"p{i}", "statistics": {"storage_size": 1024 * 1024}} for i in range(100)]
    s = FakeSession(
        [
            ("GET", r"page=1$", 200, first),
            ("GET", r"page=2$", 200, [{"path": "last", "statistics": {"storage_size": 3 * 1024 * 1024}}]),
        ]
    )
    usage = gitlab(s).namespace_usage_mib()
    assert len(usage) == 101
    assert usage["last"] == 3
    assert API in s.calls[0][1]

from __future__ import annotations

from typing import Any

from mirror.git import Completed, Git
from mirror.gitlab import GitLab
from mirror.sweep import Deps, run
from tests.conftest import FakeRunner, FakeSession


def gh_repo(name: str, owner: str = "example-user", **extra: Any) -> dict[str, Any]:
    return {
        "full_name": f"{owner}/{name}",
        "owner": {"login": owner},
        "private": False,
        "archived": False,
        "fork": False,
        "description": "",
        "topics": [],
        "default_branch": "main",
        "size": 10,
        **extra,
    }


def github(repos: list[dict[str, Any]]) -> FakeSession:
    return FakeSession([("GET", r"/installation/repositories", 200, {"repositories": repos})])


def gitlab_ok() -> FakeSession:
    return FakeSession(
        [
            ("GET", r"/projects/example-group%2F[^/]+$", 200, {"id": 1}),
            ("PUT", r"/projects/", 200, {}),
            ("GET", r"/protected_branches$", 200, []),
            ("GET", r"/groups/example-group/projects", 200, []),
        ]
    )


def deps(gh: FakeSession, gl: FakeSession, runner: FakeRunner, tmp_path: Any) -> Deps:
    return Deps(
        gh, GitLab(gl, "https://gitlab.example.invalid", "example-group"), Git(runner, sleep=lambda _: None), "ghs", "glpat", str(tmp_path)
    )


def test_mirrors_managed_repositories_and_skips_excluded_and_forks(config: dict[str, Any], tmp_path: Any) -> None:
    gh = github([gh_repo("site"), gh_repo("archive-only"), gh_repo("fork", fork=True), gh_repo("other", owner="stranger")])
    runner = FakeRunner()
    report = run(config, deps(gh, gitlab_ok(), runner, tmp_path), owners=["example-user"])
    assert report.mirrored == ["site"]
    assert report.exit_code() == 0


def test_one_failure_does_not_stop_the_sweep(config: dict[str, Any], tmp_path: Any) -> None:
    gh = github([gh_repo("bad"), gh_repo("good")])
    runner = FakeRunner({"clone": [Completed(128, "", "fatal: repository not found"), Completed(0, "", "")]})
    report = run(config, deps(gh, gitlab_ok(), runner, tmp_path), owners=["example-user"])
    assert report.mirrored == ["good"]
    assert report.permanent[0].startswith("example-user/bad: clone of")
    assert report.exit_code() == 1


def test_a_gitlab_outage_is_a_warning_not_a_failed_run(config: dict[str, Any], tmp_path: Any) -> None:
    gh = github([gh_repo("site")])
    gl = FakeSession([("GET", r"/projects/", 503, {}), ("GET", r"/groups/", 503, {})])
    report = run(config, deps(gh, gl, FakeRunner(), tmp_path), owners=["example-user"])
    assert report.transient and not report.permanent
    assert report.exit_code() == 0


def test_only_limits_the_run_by_name(config: dict[str, Any], tmp_path: Any) -> None:
    gh = github([gh_repo("a"), gh_repo("b")])
    report = run(config, deps(gh, gitlab_ok(), FakeRunner(), tmp_path), only={"b"}, owners=["example-user"])
    assert report.mirrored == ["b"]


def test_another_owner_is_mirrored_under_a_prefixed_name(config: dict[str, Any], tmp_path: Any) -> None:
    gh = github([gh_repo("site", owner="example-org")])
    report = run(config, deps(gh, gitlab_ok(), FakeRunner(), tmp_path), owners=["example-org"])
    assert report.mirrored == ["example-org-site"]

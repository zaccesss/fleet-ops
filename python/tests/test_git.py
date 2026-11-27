from __future__ import annotations

import base64

import pytest

from fleet_common import PermanentError, TransientError
from mirror.git import REFSPECS, Completed, Git, auth_env, looks_transient
from tests.conftest import FakeRunner

ENV = auth_env("oauth2", "glpat-secret-value", base={})


def test_credentials_travel_in_the_environment_never_the_arguments() -> None:
    runner = FakeRunner()
    Git(runner, sleep=lambda _: None).push("work/repo.git", "https://gitlab.example.invalid/group/site.git", ENV)
    for args, _, env in runner.calls:
        assert all("glpat-secret-value" not in a for a in args)
        assert env["GIT_CONFIG_KEY_0"] == "http.extraHeader"
    header = ENV["GIT_CONFIG_VALUE_0"].removeprefix("Authorization: Basic ")
    assert base64.b64decode(header).decode() == "oauth2:glpat-secret-value"
    assert ENV["GIT_TERMINAL_PROMPT"] == "0"


def test_push_sends_lfs_first_then_only_branches_and_tags() -> None:
    runner = FakeRunner()
    assert Git(runner, sleep=lambda _: None).push("work/repo.git", "https://gitlab.example.invalid/g/site.git", ENV) is True
    commands = [c[0] for c in runner.calls]
    assert commands[1][:2] == ["lfs", "push"]
    assert commands[2] == ["push", "--prune", "https://gitlab.example.invalid/g/site.git", *REFSPECS]
    assert not any("refs/pull" in part for cmd in commands for part in cmd)


def test_an_empty_repository_is_skipped_rather_than_failed() -> None:
    runner = FakeRunner({"for-each-ref": [Completed(0, "", "")]})
    assert Git(runner).push("work/repo.git", "https://gitlab.example.invalid/g/x.git", ENV) is False
    assert len(runner.calls) == 1


def test_a_transient_failure_is_retried_then_succeeds() -> None:
    runner = FakeRunner({"push": [Completed(1, "", "fatal: the remote end hung up unexpectedly"), Completed(0, "", "")]})
    sleeps: list[float] = []
    Git(runner, sleep=sleeps.append).push("work/repo.git", "https://gitlab.example.invalid/g/site.git", ENV)
    assert len(sleeps) == 1


def test_a_transient_failure_that_never_clears_stays_transient() -> None:
    runner = FakeRunner({"push": [Completed(1, "", "remote: calling pre_receive endpoint failed")]})
    with pytest.raises(TransientError):
        Git(runner, sleep=lambda _: None).push("work/repo.git", "https://gitlab.example.invalid/g/site.git", ENV)


def test_a_refused_push_is_permanent_and_not_retried() -> None:
    runner = FakeRunner({"push": [Completed(1, "", "! [remote rejected] main -> main (protected branch hook declined)")]})
    with pytest.raises(PermanentError, match="protected branch"):
        Git(runner, sleep=lambda _: None).push("work/repo.git", "https://gitlab.example.invalid/g/site.git", ENV)
    assert [c[0][0] for c in runner.calls].count("push") == 1


def test_clone_fetches_lfs_objects_too() -> None:
    runner = FakeRunner()
    Git(runner).clone("https://github.com/example-user/site.git", "work/site.git", ENV)
    assert [c[0][:2] for c in runner.calls] == [["clone", "--mirror"], ["lfs", "fetch"]]


def test_transient_patterns_are_case_insensitive() -> None:
    assert looks_transient("Could Not Resolve Host: gitlab.com")
    assert not looks_transient("Permission denied (publickey)")

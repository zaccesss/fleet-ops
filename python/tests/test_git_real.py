"""The real git binary against local bare repositories, so the refspecs are proven without a network."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

from mirror.git import Git, auth_env

pytestmark = pytest.mark.skipif(shutil.which("git") is None or shutil.which("git-lfs") is None, reason="needs git and git-lfs")


# the machine's own git config (signing, hooks, templates) must not change the result
HERMETIC = {"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1", "GIT_TEMPLATE_DIR": ""}


def git(*args: str, cwd: Path | None = None) -> str:
    env = {**os.environ, **HERMETIC}
    return subprocess.run(["git", *args], cwd=cwd, env=env, check=True, capture_output=True, text=True).stdout  # noqa: S603, S607


def refs(repo: Path) -> set[str]:
    return set(git("for-each-ref", "--format=%(refname)", cwd=repo).split())


def test_a_real_mirror_carries_branches_and_tags_but_not_pull_refs(tmp_path: Path) -> None:
    work = tmp_path / "work"
    work.mkdir()
    git("init", "-q", "-b", "main", cwd=work)
    git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "--allow-empty", "-m", "first", cwd=work)
    git("branch", "feature", cwd=work)
    git("tag", "v1.0.0", cwd=work)
    source = tmp_path / "source.git"
    git("clone", "-q", "--bare", str(work), str(source))
    # what GitHub keeps for every pull request, which GitLab refuses
    git("update-ref", "refs/pull/1/head", "main", cwd=source)

    dest = tmp_path / "dest.git"
    git("init", "-q", "--bare", str(dest))
    env = auth_env("oauth2", "unused", base={**os.environ, **HERMETIC})

    g = Git()
    clone = tmp_path / "clone.git"
    g.clone(str(source), str(clone), env)
    assert g.push(str(clone), str(dest), env) is True
    assert refs(dest) == {"refs/heads/main", "refs/heads/feature", "refs/tags/v1.0.0"}

    # a branch deleted on the source disappears from the mirror on the next run
    git("branch", "-D", "feature", cwd=source)
    shutil.rmtree(clone)
    g.clone(str(source), str(clone), env)
    g.push(str(clone), str(dest), env)
    assert refs(dest) == {"refs/heads/main", "refs/tags/v1.0.0"}

"""The git side of a mirror: a bare clone from GitHub and a push of branches and tags to GitLab.

Credentials reach git through GIT_CONFIG_* environment variables as an http.extraHeader. They are
never part of a URL or an argument, so they cannot appear in a process list, in git's own error
output or in a log line built from either.
"""

from __future__ import annotations

import base64
import os
import subprocess
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from fleet_common import PermanentError, TransientError

GIT_TIMEOUT = 900
PUSH_ATTEMPTS = 3
BACKOFF_SECONDS = 5

# git output that means the network or the forge is briefly unwell rather than the refs being wrong
TRANSIENT_PATTERNS = (
    "could not resolve host",
    "connection timed out",
    "connection reset",
    "connection refused",
    "failed to connect",
    "the remote end hung up",
    "early eof",
    "operation timed out",
    "network is unreachable",
    "http 502",
    "http 503",
    "http 504",
    # GitLab's pre-receive hook calls GitLab's own internal API. When that call fails the push is
    # rejected before any ref is checked, which is GitLab's outage, not a problem with the refs.
    "internal api error",
    "internal api unreachable",
    "calling pre_receive endpoint",
    "gitlab is currently unable to handle this request",
)

# only real branches and tags. GitHub's refs/pull/* would be refused by GitLab and are not content.
REFSPECS = ("+refs/heads/*:refs/heads/*", "+refs/tags/*:refs/tags/*")


@dataclass(frozen=True)
class Completed:
    returncode: int
    stdout: str
    stderr: str


Runner = Callable[[Sequence[str], str | None, dict[str, str]], Completed]


def run_subprocess(args: Sequence[str], cwd: str | None, env: dict[str, str]) -> Completed:
    try:
        # every argument is built in this module from fixed strings and repository URLs
        proc = subprocess.run(["git", *args], cwd=cwd, env=env, capture_output=True, text=True, timeout=GIT_TIMEOUT, check=False)  # noqa: S603, S607
    except subprocess.TimeoutExpired as exc:
        raise TransientError(f"git {args[0]} timed out after {GIT_TIMEOUT}s") from exc
    return Completed(proc.returncode, proc.stdout, proc.stderr)


def looks_transient(text: str) -> bool:
    lowered = text.lower()
    return any(p in lowered for p in TRANSIENT_PATTERNS)


def one_line(text: str) -> str:
    return " ".join(text.split())[:400]


def auth_env(user: str, token: str, base: dict[str, str] | None = None) -> dict[str, str]:
    env = dict(os.environ if base is None else base)
    # git reads GIT_CONFIG_COUNT/KEY_n/VALUE_n as if they were -c options, without them being arguments
    basic = base64.b64encode(f"{user}:{token}".encode()).decode()
    env.update(
        {
            "GIT_TERMINAL_PROMPT": "0",
            "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "http.extraHeader",
            "GIT_CONFIG_VALUE_0": f"Authorization: Basic {basic}",
        }
    )
    return env


class Git:
    def __init__(self, runner: Runner = run_subprocess, sleep: Callable[[float], None] = time.sleep) -> None:
        self.runner = runner
        self.sleep = sleep

    def _run(self, args: Sequence[str], cwd: str | None, env: dict[str, str], what: str) -> Completed:
        result = self.runner(args, cwd, env)
        if result.returncode != 0:
            if looks_transient(result.stderr):
                raise TransientError(f"{what} failed transiently")
            raise PermanentError(f"{what} failed: {one_line(result.stderr)}")
        return result

    def clone(self, source_url: str, dest_dir: str, env: dict[str, str]) -> None:
        self._run(["clone", "--mirror", source_url, dest_dir], None, env, f"clone of {source_url}")
        # a mirror clone only holds LFS pointers. The objects are fetched too. Otherwise GitLab would
        # refuse every pushed commit that points at one.
        self._run(["lfs", "fetch", "--all", "origin"], dest_dir, env, f"lfs fetch for {source_url}")

    def has_refs(self, repo_dir: str, env: dict[str, str]) -> bool:
        result = self.runner(["for-each-ref", "--count=1"], repo_dir, env)
        return result.returncode == 0 and bool(result.stdout.strip())

    def _with_retries(self, args: Sequence[str], cwd: str, env: dict[str, str], what: str) -> None:
        for attempt in range(1, PUSH_ATTEMPTS + 1):
            try:
                self._run(args, cwd, env, what)
                return
            except TransientError:
                if attempt == PUSH_ATTEMPTS:
                    raise
                self.sleep(BACKOFF_SECONDS * attempt)

    def push(self, repo_dir: str, dest_url: str, env: dict[str, str]) -> bool:
        # an empty repository has nothing to push. git would answer "no refs in common", which
        # reads like a failure, so it is skipped and reported as such.
        if not self.has_refs(repo_dir, env):
            return False
        # LFS objects land before the refs, because GitLab checks every pointer at push time
        self._with_retries(["lfs", "push", "--all", dest_url], repo_dir, env, f"lfs push to {dest_url}")
        # --prune removes branches and tags deleted on GitHub, so the mirror stays exact
        self._with_retries(["push", "--prune", dest_url, *REFSPECS], repo_dir, env, f"push to {dest_url}")
        return True

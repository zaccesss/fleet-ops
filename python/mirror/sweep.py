"""Mirror every managed repository to GitLab one at a time, then report the result.

Each repository is independent: a failure is recorded and the sweep moves on. The run exits 1
only for permanent failures, so a GitLab outage shows as a warning and the next run retries.
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from dataclasses import dataclass, field
from typing import Any

from fleet_common import PermanentError, Repo, TransientError, in_scope, list_repos, load_config, make_session, notify
from fleet_common.core import Session
from mirror import capacity
from mirror.git import Git, auth_env
from mirror.gitlab import GitLab, mirror_path


@dataclass
class Report:
    mirrored: list[str] = field(default_factory=list)
    created: list[str] = field(default_factory=list)
    empty: list[str] = field(default_factory=list)
    transient: list[str] = field(default_factory=list)
    permanent: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def exit_code(self) -> int:
        return 1 if self.permanent else 0

    def summary(self) -> str:
        return (
            f"mirrored {len(self.mirrored)}, created {len(self.created)}, empty {len(self.empty)}, "
            f"transient {len(self.transient)}, failed {len(self.permanent)}"
        )


@dataclass
class Deps:
    github: Session
    gitlab: GitLab
    git: Git
    github_token: str
    gitlab_token: str
    workdir: str


def mirror_one(repo: Repo, primary_owner: str, deps: Deps, report: Report) -> None:
    path = mirror_path(repo, primary_owner)
    if deps.gitlab.ensure_project(repo, path):
        report.created.append(path)
    deps.gitlab.sync_visibility(repo, path)
    deps.gitlab.unprotect_branches(path)

    clone_dir = os.path.join(deps.workdir, f"{path}.git")
    deps.git.clone(f"https://github.com/{repo.full_name}.git", clone_dir, auth_env("x-access-token", deps.github_token))
    pushed = deps.git.push(clone_dir, deps.gitlab.push_url(path), auth_env("oauth2", deps.gitlab_token))
    (report.mirrored if pushed else report.empty).append(path)

    if not deps.gitlab.sync_details(repo, path):
        report.warnings.append(f"{path}: description or topics were not accepted")


def run(config: dict[str, Any], deps: Deps, only: set[str] | None = None, owners: list[str] | None = None) -> Report:
    report = Report()
    primary = config["owners"][0]
    for owner in owners or config["owners"]:
        for repo in list_repos(deps.github, owner):
            if not in_scope(config, repo.full_name):
                continue
            if only and repo.name.lower() not in only and repo.full_name.lower() not in only:
                continue
            try:
                mirror_one(repo, primary, deps, report)
            except TransientError as exc:
                report.transient.append(f"{repo.full_name}: {exc}")
            except PermanentError as exc:
                report.permanent.append(f"{repo.full_name}: {exc}")
    try:
        warning = capacity.check(deps.gitlab.namespace_usage_mib(), config["mirror"]["sizeWarningMiB"])
        if warning:
            report.warnings.append(warning)
    except (TransientError, PermanentError) as exc:
        report.warnings.append(f"capacity check skipped: {exc}")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m mirror", description="Mirror the fleet to GitLab")
    parser.add_argument("--config", help="path to fleet.json (defaults to the FLEET_CONFIG variable)")
    parser.add_argument("--repos", help="comma separated names to mirror instead of every repository")
    # an App installation token covers one account, so each owner is mirrored with its own token
    parser.add_argument("--owner", help="mirror only this owner from fleet.json")
    args = parser.parse_args(argv)

    config = load_config(args.config)
    github_token = os.environ["GITHUB_TOKEN"]
    gitlab_token = os.environ["GITLAB_TOKEN"]
    github = make_session({"Authorization": f"Bearer {github_token}", "Accept": "application/vnd.github+json"})
    gitlab = GitLab(
        make_session({"PRIVATE-TOKEN": gitlab_token}),
        os.environ.get("GITLAB_URL", "https://gitlab.com"),
        config["mirror"]["gitlabNamespace"],
    )
    only = {r.strip().lower() for r in args.repos.split(",")} if args.repos else None

    with tempfile.TemporaryDirectory(prefix="fleet-mirror-") as workdir:
        owners = [args.owner] if args.owner else None
        report = run(config, Deps(github, gitlab, Git(), github_token, gitlab_token, workdir), only, owners)

    print(report.summary())
    for line in report.permanent + report.transient + report.warnings:
        print(f"- {line}")
    if report.permanent or report.transient or report.warnings:
        level = "fail" if report.permanent else "warn"
        notify(
            make_session({}),
            os.environ.get("NOTIFY_WEBHOOK_URL"),
            "mirror",
            level,
            report.summary(),
            report.permanent + report.transient + report.warnings,
        )
    return report.exit_code()


if __name__ == "__main__":
    sys.exit(main())

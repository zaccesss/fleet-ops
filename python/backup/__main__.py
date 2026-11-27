"""python -m backup: export every managed repository of one owner into a folder."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from backup.export import run
from fleet_common import in_scope, list_repos, load_config, make_session, notify


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m backup", description="Back up issues, pull requests and releases as JSON")
    parser.add_argument("--config", help="path to fleet.json (defaults to the FLEET_CONFIG variable)")
    parser.add_argument("--owner", required=True, help="the owner to back up, with a token for its installation")
    parser.add_argument("--out", default="backup-output", help="the folder the JSON is written to")
    parser.add_argument("--repos", help="comma separated names instead of every repository")
    parser.add_argument("--full", action="store_true", help="read everything again instead of only what changed")
    args = parser.parse_args(argv)

    config = load_config(args.config)
    session = make_session({"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}", "Accept": "application/vnd.github+json"})
    only = {r.strip().lower() for r in args.repos.split(",")} if args.repos else None
    repos = [r for r in list_repos(session, args.owner) if in_scope(config, r.full_name) and (not only or r.name.lower() in only)]

    report = run(session, repos, Path(args.out), config["backup"]["timeBudgetMinutes"], forced_full=args.full)
    summary = ", ".join(f"{k} {len(v)}" for k, v in report.items())
    print(summary)
    problems = report["failed"] + report["transient"]
    for line in problems:
        print(f"- {line}")
    if problems or report["deferred"]:
        notify(make_session({}), os.environ.get("NOTIFY_WEBHOOK_URL"), "backup", "fail" if report["failed"] else "warn", summary, problems)
    return 1 if report["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())

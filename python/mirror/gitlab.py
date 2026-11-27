"""The GitLab side of a mirror: the project, its visibility and its metadata."""

from __future__ import annotations

import re
from urllib.parse import quote

from fleet_common import PermanentError, Repo, request
from fleet_common.core import Session


def mirror_path(repo: Repo, primary_owner: str) -> str:
    # the first owner's repositories keep their names. Other owners are prefixed, so two owners
    # with a repository of the same name never collide in one namespace.
    name = repo.name if repo.owner.lower() == primary_owner.lower() else f"{repo.owner}-{repo.name}"
    # GitLab paths cannot start with a dot or contain most punctuation
    return re.sub(r"[^A-Za-z0-9_.-]", "-", name).lstrip(".") or "repo"


def visibility(repo: Repo) -> str:
    # a private repository is never widened. Anything else is public, matching GitHub.
    return "private" if repo.private else "public"


def clean_topics(topics: tuple[str, ...]) -> list[str]:
    return [t for t in topics if re.fullmatch(r"[a-z0-9][a-z0-9-]{0,49}", t)][:20]


class GitLab:
    def __init__(self, session: Session, base_url: str, namespace: str) -> None:
        self.session = session
        self.api = f"{base_url.rstrip('/')}/api/v4"
        self.host = base_url.rstrip("/")
        self.namespace = namespace

    def _id(self, path: str) -> str:
        return quote(f"{self.namespace}/{path}", safe="")

    def push_url(self, path: str) -> str:
        # no credential in the URL: git gets it from the environment (see mirror.git.auth_env)
        return f"{self.host}/{self.namespace}/{path}.git"

    def namespace_id(self) -> int:
        resp = request(self.session, "GET", f"{self.api}/namespaces/{quote(self.namespace, safe='')}", "read namespace")
        if resp.status_code != 200:
            raise PermanentError(f"read namespace {self.namespace}: HTTP {resp.status_code}")
        return int(resp.json()["id"])

    def ensure_project(self, repo: Repo, path: str) -> bool:
        """Create the project if it is missing. Returns True when it was created on this run."""
        resp = request(self.session, "GET", f"{self.api}/projects/{self._id(path)}", f"read {path}")
        if resp.status_code == 200:
            return False
        if resp.status_code != 404:
            raise PermanentError(f"read {path}: HTTP {resp.status_code}")
        created = request(
            self.session,
            "POST",
            f"{self.api}/projects",
            f"create {path}",
            json={
                "name": path,
                "path": path,
                "namespace_id": self.namespace_id(),
                "visibility": visibility(repo),
                "initialize_with_readme": False,
            },
        )
        if created.status_code not in (200, 201):
            raise PermanentError(f"create {path}: HTTP {created.status_code} {created.text[:200]}")
        return True

    def unprotect_branches(self, path: str) -> None:
        # GitLab protects the default branch of a new project, which refuses a force push. A mirror
        # is never worked in, so its protection only gets in the way.
        resp = request(self.session, "GET", f"{self.api}/projects/{self._id(path)}/protected_branches", f"read protection on {path}")
        if resp.status_code != 200:
            return
        for branch in resp.json():
            request(
                self.session,
                "DELETE",
                f"{self.api}/projects/{self._id(path)}/protected_branches/{quote(branch['name'], safe='')}",
                f"unprotect {path}",
            )

    def sync_visibility(self, repo: Repo, path: str) -> None:
        # its own call, so a problem with topics can never leave the visibility wrong
        resp = request(
            self.session, "PUT", f"{self.api}/projects/{self._id(path)}", f"visibility of {path}", json={"visibility": visibility(repo)}
        )
        if resp.status_code != 200:
            raise PermanentError(f"set visibility of {path}: HTTP {resp.status_code}")

    def sync_details(self, repo: Repo, path: str) -> bool:
        # best effort: a description or topic GitLab refuses is reported, never fatal
        resp = request(
            self.session,
            "PUT",
            f"{self.api}/projects/{self._id(path)}",
            f"details of {path}",
            json={
                "description": repo.description[:2000],
                "topics": clean_topics(repo.topics),
                "archived": repo.archived,
                "default_branch": repo.default_branch,
            },
        )
        return resp.status_code == 200

    def namespace_usage_mib(self) -> dict[str, float]:
        """Storage used per project in the namespace, in MiB."""
        usage: dict[str, float] = {}
        page = 1
        while True:
            resp = request(
                self.session,
                "GET",
                f"{self.api}/groups/{quote(self.namespace, safe='')}/projects?statistics=true&per_page=100&page={page}",
                "read usage",
            )
            if resp.status_code != 200:
                raise PermanentError(f"read usage: HTTP {resp.status_code}")
            rows = resp.json()
            for row in rows:
                usage[row["path"]] = row.get("statistics", {}).get("storage_size", 0) / (1024 * 1024)
            if len(rows) < 100:
                return usage
            page += 1

# Mirror

Copies every managed repository to GitLab, with GitHub as the single source of truth.

## One repository, step by step

1. Create the GitLab project if it is missing, with the same visibility as on GitHub.
2. Set the visibility again in its own call, so it is right even when a later step fails.
3. Remove GitLab's branch protection, which would refuse the force push. Nobody works in a mirror.
4. Make a bare mirror clone from GitHub and fetch its LFS objects.
5. Push the LFS objects, then every branch and tag with `--prune`, so a branch deleted on GitHub goes from GitLab too.
6. Update the description, topics, default branch and archived state. A refusal here is a warning, never a failure.

After every repository the sweep checks the namespace's storage and warns once it passes `mirror.sizeWarningMiB`, naming the three largest projects.

> [!IMPORTANT]
> Only `refs/heads/*` and `refs/tags/*` are pushed. GitHub keeps a `refs/pull/*` ref for every pull request. GitLab refuses those. A `git push --mirror` would fail on them.

## Credentials

The GitHub and GitLab tokens reach git as an `http.extraHeader` through the numbered `GIT_CONFIG_*` environment variables. They are never in a URL or an argument, so they cannot show up in a process list or in git's error output.

## Failures

| Kind | Examples | What happens |
| --- | --- | --- |
| Transient | DNS failure, a dropped connection, GitLab's pre-receive hook unable to reach its own API | Retried with backoff, then reported as a warning. The run still exits 0 |
| Permanent | A refused push, a missing project permission | Reported and the run exits 1 |

Each repository is independent, so one failure never stops the sweep.

## Running it

```sh
cd python
pip install --require-hashes -r requirements.txt && pip install --no-deps --no-build-isolation .
FLEET_CONFIG="$(cat ../config/fleet.json)" GITHUB_TOKEN=... GITLAB_TOKEN=... python -m mirror --owner example-user
```

`--repos a,b` limits the run to named repositories.

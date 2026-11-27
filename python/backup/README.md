# Backup

Saves what git cannot carry: issues, pull requests, issue comments, review comments and releases, as JSON.

## How a run works

1. Repositories are ordered by when they were last backed up, never-backed-up first.
2. For each one, only what changed since the newest saved item is fetched and laid over the saved copy. Pull requests are read newest first and paging stops at the saved copy.
3. In the first three days of each month everything is read again, because the incremental path never sees a deletion. `--full` does the same on demand.
4. Files are written with sorted keys, so an unchanged repository writes identical bytes and the data repository gets no commit.
5. Once `backup.timeBudgetMinutes` has passed, no new repository is started. The rest are listed as deferred and go first next time.

> [!CAUTION]
> The export holds the full text of issues and pull requests, private ones included. The data repository it is committed to must be private.

## Layout

```text
<out>/
  _state.json            when each repository was last backed up
  <owner>/<repo>/
    issues.json
    pulls.json
    issue-comments.json
    review-comments.json
    releases.json
```

## Running it

```sh
cd python
pip install --require-hashes -r requirements.txt && pip install --no-deps --no-build-isolation .
FLEET_CONFIG="$(cat ../config/fleet.json)" GITHUB_TOKEN=... python -m backup --owner example-user --out ../backup-output
```

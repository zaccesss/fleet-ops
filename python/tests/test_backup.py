from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from backup.export import export_repo, get_all, is_full_refresh, merge, order_by_staleness, run, watermark, write_json
from fleet_common import PermanentError
from tests.conftest import FakeSession, make_repo

MID_MONTH = datetime(2026, 11, 20, 1, 0, tzinfo=UTC)


def empty_repo_routes() -> list[tuple]:
    return [("GET", r"/(issues|pulls|issues/comments|pulls/comments|releases)$", 200, [])]


def test_follows_link_header_pages() -> None:
    s = FakeSession(
        [
            (
                "GET",
                r"/issues$",
                200,
                [{"id": 1}],
                {"Link": '<https://api.github.com/repositories/1/issues?page=2>; rel="next"', "once": "1"},
            ),
            ("GET", r"/issues\?page=2$", 200, [{"id": 2}]),
        ]
    )
    assert [i["id"] for i in get_all(s, "https://api.github.com/repos/a/b/issues")] == [1, 2]
    assert s.params[0] == {"per_page": 100}
    assert s.params[1] is None


def test_stops_paging_once_a_newest_first_list_reaches_the_saved_copy() -> None:
    page1 = [{"number": 9, "updated_at": "2026-11-19T00:00:00Z"}, {"number": 8, "updated_at": "2026-10-01T00:00:00Z"}]
    s = FakeSession([("GET", r"/pulls$", 200, page1, {"Link": '<https://api.github.com/x?page=2>; rel="next"'})])
    assert len(get_all(s, "https://api.github.com/repos/a/b/pulls", stop_older_than="2026-11-01T00:00:00Z")) == 2
    assert len(s.calls) == 1


def test_a_token_without_access_is_permanent() -> None:
    with pytest.raises(PermanentError, match="cannot read"):
        get_all(FakeSession([("GET", r".", 403, {})]), "https://api.github.com/repos/a/b/issues")


def test_watermark_is_a_minute_before_the_newest_item_and_none_on_a_full_refresh() -> None:
    items = [{"updated_at": "2026-11-19T10:00:00Z"}, {"updated_at": "2026-11-18T10:00:00Z"}]
    assert watermark(items, full=False) == "2026-11-19T09:59:00Z"
    assert watermark(items, full=True) is None
    assert watermark([], full=False) is None


def test_full_refresh_runs_in_the_first_three_days_of_a_month() -> None:
    assert is_full_refresh(datetime(2026, 12, 3, tzinfo=UTC))
    assert not is_full_refresh(datetime(2026, 12, 4, tzinfo=UTC))
    assert is_full_refresh(datetime(2026, 12, 20, tzinfo=UTC), forced=True)


def test_merge_lets_the_fresh_copy_win() -> None:
    assert merge([{"id": 1, "t": "old"}, {"id": 2, "t": "keep"}], [{"id": 1, "t": "new"}], "id") == [
        {"id": 1, "t": "new"},
        {"id": 2, "t": "keep"},
    ]


def test_unchanged_data_writes_nothing(tmp_path: Path) -> None:
    assert write_json(tmp_path / "a.json", {"b": 1, "a": 2}) is True
    assert write_json(tmp_path / "a.json", {"a": 2, "b": 1}) is False


def test_an_incremental_export_asks_only_for_changes_and_keeps_the_saved_items(tmp_path: Path) -> None:
    out = tmp_path / "a" / "site"
    write_json(out / "issues.json", [{"id": 1, "number": 1, "updated_at": "2026-11-10T00:00:00Z", "title": "old"}])
    s = FakeSession(
        [
            (
                "GET",
                r"/issues$",
                200,
                [{"id": 2, "number": 2, "updated_at": "2026-11-19T00:00:00Z"}, {"id": 3, "number": 3, "pull_request": {}}],
            ),
            *empty_repo_routes(),
        ]
    )
    changed = export_repo(s, make_repo("site", owner="a"), out, full=False)
    assert "issues" in changed
    assert s.params[0] == {"per_page": 100, "state": "all", "since": "2026-11-09T23:59:00Z"}
    saved = json.loads((out / "issues.json").read_text())
    # newest first, the pull request filtered out and the saved issue kept
    assert [i["number"] for i in saved] == [2, 1]


def test_a_second_run_over_the_same_data_changes_nothing(tmp_path: Path) -> None:
    out = tmp_path / "a" / "site"
    s = FakeSession(empty_repo_routes())
    export_repo(s, make_repo("site", owner="a"), out, full=True)
    assert export_repo(s, make_repo("site", owner="a"), out, full=True) == []


def test_the_budget_backs_up_the_stalest_first_and_defers_the_rest(tmp_path: Path) -> None:
    write_json(tmp_path / "_state.json", {"a/new": "2026-11-19T00:00:00Z", "a/old": "2026-11-01T00:00:00Z"})
    repos = [make_repo("new", owner="a"), make_repo("old", owner="a"), make_repo("never", owner="a")]
    # the clock is read at the start, then before and after each repository
    minutes = [0, 0, 2, 5, 6, 11]
    ticks = iter(MID_MONTH + timedelta(minutes=m) for m in minutes)
    report = run(FakeSession(empty_repo_routes()), repos, tmp_path, budget_minutes=10, now=lambda: next(ticks))
    done = report["exported"] + report["unchanged"]
    assert done == ["a/never", "a/old"]
    assert report["deferred"] == ["a/new"]
    state = json.loads((tmp_path / "_state.json").read_text())
    assert state["a/never"] == "2026-11-20T01:02:00Z"


def test_one_failing_repository_does_not_stop_the_run(tmp_path: Path) -> None:
    s = FakeSession([("GET", r"/repos/a/bad/", 404, {}), *empty_repo_routes()])
    report = run(s, [make_repo("bad", owner="a"), make_repo("good", owner="a")], tmp_path, 10, now=lambda: MID_MONTH)
    assert report["failed"][0].startswith("a/bad:")
    assert report["exported"] == ["a/good"]


def test_order_by_staleness_puts_never_backed_up_first() -> None:
    repos = [make_repo("b"), make_repo("a")]
    assert [r.name for r in order_by_staleness(repos, {"example-user/b": "2026-01-01T00:00:00Z"})] == ["a", "b"]

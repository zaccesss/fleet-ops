"""Property-based tests: Hypothesis generates inputs and shrinks any failure to the smallest one that breaks a rule."""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

from hypothesis import given, settings
from hypothesis import strategies as st

from backup.export import merge, order_by_staleness, watermark, write_json
from mirror import capacity
from mirror.git import auth_env, looks_transient
from mirror.gitlab import clean_topics, mirror_path, visibility
from tests.conftest import make_repo

names = st.text(alphabet=st.characters(min_codepoint=33, max_codepoint=126), min_size=1, max_size=40)
owners = st.from_regex(r"[a-z][a-z0-9-]{0,15}", fullmatch=True)


@given(owners, names)
def test_mirror_paths_are_always_valid_gitlab_paths(owner: str, name: str) -> None:
    path = mirror_path(make_repo(name.replace("/", "-"), owner=owner), "primary-owner")
    assert path
    assert not path.startswith(".")
    assert re.fullmatch(r"[A-Za-z0-9_.-]+", path)


@given(st.booleans())
def test_visibility_never_widens_a_private_repository(private: bool) -> None:
    assert (visibility(make_repo(private=private)) == "private") is private


@given(st.lists(st.text(max_size=60), max_size=40))
def test_topics_kept_are_a_valid_subset(topics: list[str]) -> None:
    kept = clean_topics(tuple(topics))
    assert len(kept) <= 20
    assert all(t in topics and re.fullmatch(r"[a-z0-9][a-z0-9-]{0,49}", t) for t in kept)


@given(st.text(), st.text())
def test_transient_detection_ignores_case_and_surrounding_text(before: str, after: str) -> None:
    assert looks_transient(f"{before}Could Not Resolve Host{after}")


@given(st.text(min_size=1), st.text(min_size=1))
def test_credentials_only_ever_travel_in_the_environment(user: str, token: str) -> None:
    env = auth_env(user, token, base={})
    assert env["GIT_TERMINAL_PROMPT"] == "0"
    assert env["GIT_CONFIG_KEY_0"] == "http.extraHeader"
    assert env["GIT_CONFIG_VALUE_0"].startswith("Authorization: Basic ")


@given(
    st.dictionaries(st.text(min_size=1, max_size=10), st.floats(min_value=0, max_value=5000), max_size=20),
    st.integers(min_value=1, max_value=20000),
)
def test_capacity_warns_exactly_when_the_total_reaches_the_level(usage: dict[str, float], level: int) -> None:
    warning = capacity.check(usage, level)
    assert (warning is None) == (sum(usage.values()) < level)


stamps = st.datetimes(min_value=datetime(2020, 1, 1), max_value=datetime(2030, 1, 1)).map(lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ"))


@given(st.lists(stamps, min_size=1, max_size=20))
def test_the_watermark_is_always_a_minute_before_the_newest_item(updated: list[str]) -> None:
    mark = watermark([{"updated_at": u} for u in updated], full=False)
    assert mark is not None
    newest = datetime.strptime(max(updated), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    assert datetime.strptime(mark, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC) == newest - timedelta(minutes=1)


items = st.lists(st.fixed_dictionaries({"id": st.integers(0, 50), "v": st.text(max_size=5)}), max_size=20)


@given(items, items)
def test_merge_keeps_every_key_and_the_fresh_copy_wins(old: list[dict[str, object]], fresh: list[dict[str, object]]) -> None:
    merged = {i["id"]: i for i in merge(old, fresh, "id")}
    assert set(merged) == {i["id"] for i in old} | {i["id"] for i in fresh}
    for item in fresh:
        assert merged[item["id"]] == {i["id"]: i for i in fresh}[item["id"]]


@settings(max_examples=50)
@given(
    st.recursive(
        st.none() | st.booleans() | st.integers() | st.text(),
        lambda c: st.lists(c, max_size=4) | st.dictionaries(st.text(max_size=5), c, max_size=4),
    )
)
def test_writing_the_same_data_twice_changes_nothing(data: object) -> None:
    with TemporaryDirectory() as tmp:
        path = Path(tmp) / "x.json"
        assert write_json(path, data) is True
        assert write_json(path, data) is False


@given(st.lists(st.from_regex(r"[a-z]{1,8}", fullmatch=True), unique=True, max_size=10), st.data())
def test_staleness_order_puts_never_backed_up_first(repos: list[str], data: st.DataObject) -> None:
    done = data.draw(st.lists(st.sampled_from(repos), unique=True) if repos else st.just([]))
    state = {f"example-user/{r}": "2026-01-01T00:00:00Z" for r in done}
    ordered = [r.name for r in order_by_staleness([make_repo(r) for r in repos], state)]
    never = [r for r in ordered if r not in done]
    assert ordered[: len(never)] == never

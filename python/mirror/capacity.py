"""A warning before the GitLab namespace fills up, naming what is taking the space."""

from __future__ import annotations


def check(usage_mib: dict[str, float], warn_at_mib: int, top: int = 3) -> str | None:
    total = sum(usage_mib.values())
    if total < warn_at_mib:
        return None
    largest = sorted(usage_mib.items(), key=lambda kv: kv[1], reverse=True)[:top]
    names = ", ".join(f"{name} ({size:.0f} MiB)" for name, size in largest)
    return f"GitLab namespace uses {total:.0f} MiB of the {warn_at_mib} MiB warning level. Largest: {names}"

#!/usr/bin/env python3
"""WCAG contrast audit for every theme in src/index.css.

Parses the :root (Classic) and .theme-* variable blocks and checks the
token pairs the UI actually renders, against WCAG 2.1 AA:

  4.5:1 — body/meta text on its background
  3.0:1 — large text, icons, and non-text UI (decorative faint tier)

Run in CI or locally: python3 scripts/check_contrast.py
Exit 1 with a failure table if any pair misses its threshold — a theme
cannot ship until this passes.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

CSS = Path(__file__).resolve().parent.parent / "src" / "index.css"

# (foreground token, background token, minimum ratio, what it renders)
PAIRS = [
    ("content", "surface", 4.5, "primary text on cards"),
    ("content", "surface-hover", 4.5, "primary text on hovered rows"),
    ("content", "surface-sunken", 4.5, "primary text on page background"),
    ("content-secondary", "surface", 4.5, "secondary text on cards"),
    ("content-secondary", "surface-hover", 4.5, "secondary text on hovered rows"),
    ("content-secondary", "surface-sunken", 4.5, "secondary text on page background"),
    ("content-muted", "surface", 4.5, "meta text (timestamps, hints)"),
    ("content-muted", "surface-sunken", 4.5, "meta text on page background"),
    ("content-faint", "surface", 3.0, "decorative icons / dividers tier"),
    ("brand-600", "surface", 4.5, "accent links & buttons-as-text"),
    ("brand-700", "surface", 4.5, "hovered accent links"),
    ("brand-fg", "brand-600", 4.5, "button label on accent fill"),
    ("brand-fg", "brand-700", 4.5, "button label on hovered accent fill"),
    ("brand-fg", "brand-500", 3.0, "icon on brand-500 tile"),
    ("brand-600", "brand-100", 3.0, "icon tiles (brand-tinted)"),
    ("brand-700", "brand-100", 4.5, "count badges on brand tint"),
    ("sidebar-content", "sidebar", 4.5, "sidebar nav labels"),
    ("sidebar-content", "sidebar-raised", 4.5, "sidebar labels on active row"),
    ("sidebar-muted", "sidebar", 4.5, "sidebar secondary labels"),
    # Status fg colors double as accent text directly on surfaces (planner
    # working phases) — they must pass there too, not just on their pills.
    ("status-drafting-fg", "surface", 4.5, "phase/status accent text on cards"),
    ("status-editing-fg", "surface", 4.5, "phase/status accent text on cards"),
    ("status-preorder-fg", "surface", 4.5, "phase/status accent text on cards"),
    ("status-published-fg", "surface", 4.5, "phase/status accent text on cards"),
    ("status-paused-fg", "surface", 4.5, "phase/status accent text on cards"),
    ("status-idea-fg", "status-idea-bg", 4.5, "status pill: idea"),
    ("status-drafting-fg", "status-drafting-bg", 4.5, "status pill: drafting"),
    ("status-editing-fg", "status-editing-bg", 4.5, "status pill: editing"),
    ("status-preorder-fg", "status-preorder-bg", 4.5, "status pill: pre-order"),
    ("status-published-fg", "status-published-bg", 4.5, "status pill: published"),
    ("status-paused-fg", "status-paused-bg", 4.5, "status pill: paused"),
]


def luminance(hexcolor: str) -> float:
    h = hexcolor.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def ratio(fg: str, bg: str) -> float:
    l1, l2 = sorted((luminance(fg), luminance(bg)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)


def parse_themes(css: str) -> dict[str, dict[str, str]]:
    themes: dict[str, dict[str, str]] = {}
    for m in re.finditer(r"(:root|\.theme-[\w-]+)\s*\{([^}]*)\}", css):
        name = "classic" if m.group(1) == ":root" else m.group(1)[len(".theme-"):]
        vars_ = dict(re.findall(r"--color-([\w-]+):\s*(#[0-9a-fA-F]{6})", m.group(2)))
        if vars_:
            themes.setdefault(name, {}).update(vars_)
    return themes


def main() -> int:
    themes = parse_themes(CSS.read_text())
    failures: list[tuple[str, str, str, float, float, str]] = []
    checked = 0
    for theme, vars_ in themes.items():
        for fg, bg, minimum, what in PAIRS:
            if fg not in vars_ or bg not in vars_:
                failures.append((theme, fg, bg, 0.0, minimum, f"MISSING TOKEN ({what})"))
                continue
            r = ratio(vars_[fg], vars_[bg])
            checked += 1
            if r < minimum:
                failures.append((theme, fg, bg, r, minimum, what))
    print(f"{len(themes)} themes × {len(PAIRS)} pairs — {checked} checks")
    if failures:
        print(f"\n{len(failures)} FAILURES:")
        for theme, fg, bg, r, minimum, what in sorted(failures):
            print(f"  {theme:14s} {fg:22s} on {bg:22s} {r:5.2f} < {minimum}  ({what})")
        return 1
    print("All themes pass WCAG AA for the checked pairs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

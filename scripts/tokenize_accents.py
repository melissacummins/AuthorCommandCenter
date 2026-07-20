#!/usr/bin/env python3
"""Accent pass of the theming codemod (follow-up to tokenize_styles.py).

Phase 0 tokenized surfaces and text. This pass converts MODULE ACCENT chrome
— the per-module identity colors (Inventory blue, Planner teal, Content
Creator pink, Catalog indigo, …) — to the theme's brand tokens, so switching
themes restyles every app, not just its surfaces.

Converted families (identity accents):  blue, indigo, teal, sky, cyan, pink,
purple, violet, fuchsia, lime — every utility (bg/text/border/ring/divide/
accent/from/to/via/stroke/fill), same shade number onto the brand ramp.

Deliberately NOT converted (semantic, theme-independent):
  - red / rose (danger), amber / orange / yellow (warning),
    green / emerald (success) — meaning-bearing colors stay stable.
  - src/components/Layout.tsx — the sidebar's per-module rainbow icons are
    identity marks, not chrome.
  - *.ts files (pen-name palette, hosted bio-page themes).

Button text pass: any class string that gains a solid brand fill
(bg-brand-500/600/700) has its `text-white` swapped for `text-brand-fg`, a
per-theme "on-accent" token — dark themes use bright accents where white
text would fail WCAG AA, so the on-accent ink must be theme-controlled.

Idempotent: brand-* never appears on a left-hand side.
Usage: python3 scripts/tokenize_accents.py [--check]
"""

from __future__ import annotations

import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"

ACCENT_FAMILIES = [
    "blue", "indigo", "teal", "sky", "cyan",
    "pink", "purple", "violet", "fuchsia", "lime",
]
UTILITIES = [
    "bg", "text", "border", "ring", "divide", "accent",
    "from", "to", "via", "stroke", "fill", "shadow",
]
SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"]

EXCLUDED_FILES = {SRC / "components" / "Layout.tsx"}

FAMILY_ALT = "|".join(ACCENT_FAMILIES)
UTIL_ALT = "|".join(UTILITIES)
ACCENT_RE = re.compile(
    rf"(?<![\w-])(?P<util>{UTIL_ALT})-(?:{FAMILY_ALT})-(?P<shade>{'|'.join(SHADES)})(?![\w-])"
)

# `text-white` on a brand fill → theme-controlled on-accent ink.
BRAND_FILL_RE = re.compile(r"bg-brand-(?:500|600|700)(?![\w-])")
TEXT_WHITE_RE = re.compile(r"(?<![\w-])text-white(?![\w-])")

# Survivors report: any accent-family class that slipped through.
SURVIVOR_RE = re.compile(
    rf"(?<![\w-])(?:[\w-]+:)*(?:{UTIL_ALT})-(?:{FAMILY_ALT})-\d+(?![\w-])"
)


def process(path: Path, check: bool) -> tuple[int, int, list[str]]:
    text = path.read_text()
    text, n_accent = ACCENT_RE.subn(lambda m: f"{m.group('util')}-brand-{m.group('shade')}", text)

    # Swap text-white → text-brand-fg on lines that now carry a brand fill.
    n_fg = 0
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if BRAND_FILL_RE.search(line) and TEXT_WHITE_RE.search(line):
            lines[i], k = TEXT_WHITE_RE.subn("text-brand-fg", line)
            n_fg += k
    text = "\n".join(lines)

    if (n_accent or n_fg) and not check:
        path.write_text(text)
    survivors = [
        f"{path.relative_to(ROOT)}:{i}: {m.group(0)}"
        for i, line in enumerate(text.splitlines(), 1)
        for m in SURVIVOR_RE.finditer(line)
    ]
    return n_accent, n_fg, survivors


def main() -> int:
    check = "--check" in sys.argv
    totals: Counter = Counter()
    files_changed = 0
    all_survivors: list[str] = []
    for path in sorted(SRC.rglob("*.tsx")):
        if path in EXCLUDED_FILES:
            continue
        n_accent, n_fg, survivors = process(path, check)
        if n_accent or n_fg:
            files_changed += 1
            totals["accent classes"] += n_accent
            totals["text-white -> text-brand-fg"] += n_fg
            print(f"{path.relative_to(ROOT)}: {n_accent} accent + {n_fg} on-brand text")
        all_survivors.extend(survivors)
    for k, v in totals.items():
        print(f"  {v:5d}  {k}")
    print(f"\n{files_changed} files {'would be ' if check else ''}changed")
    if all_survivors:
        print(f"\n=== SURVIVORS ({len(all_survivors)}) — review by hand ===")
        for s in all_survivors:
            print(s)
    return 1 if (check and files_changed) else 0


if __name__ == "__main__":
    sys.exit(main())

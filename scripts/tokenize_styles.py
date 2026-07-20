#!/usr/bin/env python3
"""Rewrite hardcoded Tailwind surface/text/border/radius classes to the
semantic tokens defined in src/index.css (Command Center redesign Phase 0,
docs/COMMAND_CENTER_REDESIGN_DIRECTIVE.md §2.2).

Idempotent: token names never appear on the left-hand side of a mapping, so
running the script twice produces no further changes.

Usage:  python3 scripts/tokenize_styles.py [--check]
  --check  report what would change without writing files (exit 1 if any)

Scope: src/**/*.tsx only. Deliberately NOT rewritten:
  - bg-slate-700/800/900 outside Layout.tsx — intentional dark elements
    (tooltips, media previews, modal overlays) that should stay dark in
    every theme.
  - text-white, non-slate colors, gradients, shadows — reviewed by hand.
  - *.ts files — the only class strings there (link-shortener bioThemes)
    style the externally hosted bio page, which has its own theme system.

A survivors report lists every remaining white/slate/rounded-xl-family
occurrence so nothing slips through unreviewed.

Convention: text that must stay light-on-dark regardless of theme (labels
inside intentionally dark elements) uses arbitrary values like
text-[#cbd5e1] so it can never be captured by the text-slate-* mappings.
"""

from __future__ import annotations

import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"

# Order matters only for readability; every LHS is matched with boundaries so
# no mapping can corrupt another's output.
GENERAL_MAP: dict[str, str] = {
    # surfaces
    "bg-white": "bg-surface",
    "bg-slate-50": "bg-surface-hover",
    "bg-slate-100": "bg-surface-sunken",
    "bg-slate-200": "bg-edge",           # progress tracks, skeleton fills
    "bg-slate-300": "bg-edge-strong",
    "bg-slate-400": "bg-content-muted",  # rare: solid muted chips/dots
    # borders / dividers / rings
    "border-slate-50": "border-edge-soft",
    "border-slate-100": "border-edge-soft",
    "border-slate-200": "border-edge",
    "border-slate-300": "border-edge-strong",
    "border-slate-400": "border-edge-strong",
    "divide-slate-100": "divide-edge-soft",
    "divide-slate-200": "divide-edge",
    "ring-slate-200": "ring-edge",
    "ring-slate-300": "ring-edge-strong",
    # text
    "text-slate-900": "text-content",
    "text-slate-800": "text-content",
    "text-slate-700": "text-content",
    "text-slate-600": "text-content-secondary",
    "text-slate-500": "text-content-secondary",
    "text-slate-400": "text-content-muted",
    "text-slate-300": "text-content-faint",
    "text-slate-200": "text-content-faint",
    # radii (rounded-full and rounded-sm stay literal)
    "rounded-2xl": "rounded-card",
    "rounded-xl": "rounded-card",
    "rounded-lg": "rounded-control",
    "rounded-md": "rounded-control",
}

# Directional radius variants for both target sizes.
for side in ("t", "b", "l", "r", "tl", "tr", "bl", "br"):
    for src_size, dst in (("2xl", "card"), ("xl", "card"), ("lg", "control"), ("md", "control")):
        GENERAL_MAP[f"rounded-{side}-{src_size}"] = f"rounded-{side}-{dst}"

# Layout.tsx only: the dark sidebar. Applied before the general map so its
# slate text classes become sidebar tokens, not content tokens; the general
# map then handles Layout's light header/overlay parts.
SIDEBAR_MAP: dict[str, str] = {
    "bg-slate-900": "bg-sidebar",
    "bg-slate-800": "bg-sidebar-raised",
    "bg-slate-700": "bg-sidebar-edge",
    "border-slate-700": "border-sidebar-edge",
    "ring-slate-700": "ring-sidebar-edge",
    "ring-slate-800": "ring-sidebar-raised",
    "text-slate-300": "text-sidebar-content",
    "text-slate-400": "text-sidebar-content",
    "text-slate-500": "text-sidebar-muted",
}

SIDEBAR_FILES = {SRC / "components" / "Layout.tsx"}

# Anything still matching these after the rewrite lands in the survivors
# report for human review.
SURVIVOR_RE = re.compile(
    r"(?<![\w-])(?:[\w-]+:)*(?:bg-white|bg-slate-\d+|text-slate-\d+|"
    r"border-slate-\d+|divide-slate-\d+|ring-slate-\d+|"
    r"rounded(?:-[trbl]{1,2})?-(?:2xl|xl|lg|md))(?![\w-])(?:/\d+)?"
)


def compile_map(mapping: dict[str, str]) -> list[tuple[re.Pattern[str], str]]:
    # Boundary chars: a class token is preceded by quote/space/backtick/colon
    # (variant prefix) and followed by space/quote/backtick/slash (opacity
    # suffix, which we preserve) or end.
    return [
        (re.compile(rf"(?<![\w-]){re.escape(src)}(?![\w-])"), dst)
        for src, dst in mapping.items()
    ]


GENERAL = compile_map(GENERAL_MAP)
SIDEBAR = compile_map(SIDEBAR_MAP)


def process(path: Path, check: bool) -> tuple[Counter, list[str]]:
    text = path.read_text()
    counts: Counter = Counter()
    maps = ([*SIDEBAR, *GENERAL] if path in SIDEBAR_FILES else GENERAL)
    for pattern, dst in maps:
        text, n = pattern.subn(dst, text)
        if n:
            counts[f"{pattern.pattern} -> {dst}"] += n
    if counts and not check:
        path.write_text(text)
    survivors = [
        f"{path.relative_to(ROOT)}:{i}: {m.group(0)}"
        for i, line in enumerate(text.splitlines(), 1)
        for m in SURVIVOR_RE.finditer(line)
    ]
    return counts, survivors


def main() -> int:
    check = "--check" in sys.argv
    total: Counter = Counter()
    files_changed = 0
    all_survivors: list[str] = []
    for path in sorted(SRC.rglob("*.tsx")):
        counts, survivors = process(path, check)
        if counts:
            files_changed += 1
            total.update(counts)
            print(f"{path.relative_to(ROOT)}: {sum(counts.values())} replacements")
        all_survivors.extend(survivors)
    for rule, n in sorted(total.items()):
        print(f"  {n:5d}  {rule}")
    print(f"\n{files_changed} files {'would be ' if check else ''}changed")
    if all_survivors:
        print(f"\n=== SURVIVORS ({len(all_survivors)}) — review by hand ===")
        for s in all_survivors:
            print(s)
    return 1 if (check and files_changed) else 0


if __name__ == "__main__":
    sys.exit(main())

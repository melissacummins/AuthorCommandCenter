// Parse a single Notion-exported markdown file. Returns the page title
// (which is the reader's name for the ARC database) and the body
// content with Notion's property block stripped.
//
// Notion's "Markdown & CSV" export produces files that look like:
//
//   # Crystal Henderson
//
//   Application for: Night Shade, Night Fury
//   Email Address: crystal.henderson@example.com
//   Status: Didn't Review
//
//   Said this was another TT account...
//   I don't have written down from past ARCs...
//
// The first heading is the page title. Everything after the property
// block (lines shaped like "Key: value") is the page body — that's
// what becomes the "notes" column.

export interface ParsedNotionMd {
  name: string;
  notes: string;
}

const PROPERTY_LINE = /^[A-Z][A-Za-z0-9 &?'\-/]+:\s*.*$/;

export function parseNotionMarkdown(content: string): ParsedNotionMd | null {
  // Strip BOM and normalize newlines.
  const raw = content.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const lines = raw.split('\n');

  // First non-blank line should be "# Page Title".
  let titleLine: string | null = null;
  let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    if (l.startsWith('#')) {
      titleLine = l.replace(/^#+\s*/, '').trim();
    }
    i++;
    break;
  }
  if (!titleLine) return null;

  // Skip blank lines and Notion's optional property block.
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') continue;
    if (PROPERTY_LINE.test(l)) continue;
    break;
  }

  // Whatever remains is the body. Trim trailing whitespace lines.
  const bodyLines = lines.slice(i);
  while (bodyLines.length && bodyLines[bodyLines.length - 1].trim() === '') {
    bodyLines.pop();
  }
  const body = bodyLines.join('\n').trim();

  return { name: titleLine, notes: body };
}

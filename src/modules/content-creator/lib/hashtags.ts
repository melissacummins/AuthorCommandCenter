// Trope-hashtag suggestions — deterministic, from catalog data, no AI.
//
// Verified research (docs/reference/hook-research-2026.md): 3-5 hashtags
// including #booktok; trope tags do real framing work (a 4-word bare-line
// hook went viral with the trope named in the tag); stuffing more tags
// gets suppressed.

import type { Book } from '../../catalog/types';

const MAX_TAGS = 5;

function tagify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function buildHashtags(book: Book): string[] {
  const tags: string[] = ['#booktok'];
  if (book.subgenre) {
    const sub = tagify(book.subgenre);
    if (sub) tags.push(`#${sub}`);
  }
  for (const trope of book.tropes) {
    if (tags.length >= MAX_TAGS) break;
    const t = tagify(trope);
    if (t && !tags.includes(`#${t}`)) tags.push(`#${t}`);
  }
  // Steam signal, only when there's room and the book runs hot.
  if (tags.length < MAX_TAGS && (book.heat_level ?? 0) >= 4 && !tags.includes('#spicybooktok')) {
    tags.push('#spicybooktok');
  }
  return tags.slice(0, MAX_TAGS);
}

export function hashtagLine(book: Book): string {
  return buildHashtags(book).join(' ');
}

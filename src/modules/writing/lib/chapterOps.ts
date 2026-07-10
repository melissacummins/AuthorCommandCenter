// Block-level helpers for "Split chapter here". Chapters are always a
// sequence of top-level HTML blocks (p, h1-h3, ul, ol, blockquote) — the same
// model lib/import.ts's chapter detection uses — so a split is a block
// boundary, not an arbitrary character offset. That keeps a split from ever
// cutting a sentence or a formatting run in half.

// Split HTML into everything before/from a given top-level block index.
export function splitHtmlAtBlockIndex(html: string, blockIndex: number): [string, string] {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
  const root = doc.getElementById('root');
  const blocks = root ? Array.from(root.children) : [];
  const before = blocks.slice(0, blockIndex).map(b => b.outerHTML).join('\n');
  const after = blocks.slice(blockIndex).map(b => b.outerHTML).join('\n');
  return [before, after];
}

// Which top-level block (a direct child of the editor's DOM) contains the
// current text selection, so "Split chapter here" splits at the paragraph the
// cursor is actually in. Returns null if there's no selection inside the
// editor, or the cursor is in the very first block (nothing to split off).
export function blockIndexAtSelection(editorDom: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  let node: Node | null = sel.getRangeAt(0).startContainer;
  while (node && node.parentElement !== editorDom) {
    node = node.parentElement;
  }
  if (!node || !(node instanceof Element)) return null;
  const index = Array.from(editorDom.children).indexOf(node);
  return index <= 0 ? null : index;
}

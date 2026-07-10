// mammoth ships a browser bundle (mammoth.browser.js) but only types the main
// entry. We need convertToHtml (preserves italics/bold, unlike extractRawText)
// so declare that subpath's export. This ambient declaration merges with the
// Audiobook module's own declare block for the same module path.
declare module 'mammoth/mammoth.browser' {
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: unknown[] }>;
}

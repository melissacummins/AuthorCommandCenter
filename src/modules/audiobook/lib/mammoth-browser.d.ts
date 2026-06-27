// mammoth ships a browser bundle (mammoth.browser.js) but only types the main
// entry. We only use extractRawText, so declare the subpath we import.
declare module 'mammoth/mammoth.browser' {
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: unknown[] }>;
  const _default: { extractRawText: typeof extractRawText };
  export default _default;
}

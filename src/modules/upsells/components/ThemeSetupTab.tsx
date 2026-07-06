import { useMemo, useState } from 'react';
import { Copy, Check, ShieldCheck, UploadCloud, Loader2, Sparkles } from 'lucide-react';
import { buildThemeSnippet, INSTALL_STEPS, RENDER_LINE } from '../snippet';
import { publishSnippetToTheme } from '../api';

// One-time theme install: the snippet goes in once, then every offer is
// managed from the Offers tab — no more theme edits ever.
export default function ThemeSetupTab() {
  const [copied, setCopied] = useState(false);
  const [copiedLine, setCopiedLine] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishedTo, setPublishedTo] = useState('');
  const [publishError, setPublishError] = useState('');
  const [showManual, setShowManual] = useState(false);
  const snippet = useMemo(buildThemeSnippet, []);

  async function copyText(text: string, setFlag: (v: boolean) => void) {
    await navigator.clipboard.writeText(text);
    setFlag(true);
    setTimeout(() => setFlag(false), 2000);
  }

  async function handlePublish() {
    setPublishing(true);
    setPublishError('');
    setPublishedTo('');
    try {
      const themeName = await publishSnippetToTheme(snippet);
      setPublishedTo(themeName);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Publish failed';
      setPublishError(/403/.test(msg)
        ? 'Shopify rejected the theme write — the connection is missing the write_themes permission. Re-authorize with Shopify in Settings, then publish again.'
        : msg);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Recommended: publish as a theme snippet, blocks hold one line */}
      <div className="bg-gradient-to-r from-sky-50 to-indigo-50 border border-sky-200 rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4 text-sky-600" />
          <h3 className="font-semibold text-sky-800">Recommended: one-click updates</h3>
        </div>
        <p className="text-sm text-sky-700/90 mb-4">
          Publish the widget into your live theme as a snippet file. Your Custom Liquid blocks then
          hold a single line that never changes — and every future widget update is just this one
          button, no pasting.
        </p>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <button
            onClick={handlePublish}
            disabled={publishing}
            className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white text-sm font-medium rounded-lg hover:bg-sky-700 disabled:opacity-50"
          >
            {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            {publishing ? 'Publishing…' : 'Publish widget to live theme'}
          </button>
          {publishedTo && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-700">
              <Check className="w-4 h-4" /> Published to “{publishedTo}”
            </span>
          )}
        </div>
        {publishError && <p className="text-sm text-red-600 mb-4">{publishError}</p>}
        <ol className="space-y-2 text-sm text-sky-800">
          <li className="flex gap-2"><span className="font-bold text-sky-500">1.</span>
            <span>Click <strong>Publish widget to live theme</strong> above (first time may need a quick
            re-authorize in Settings to grant theme access).</span></li>
          <li className="flex gap-2"><span className="font-bold text-sky-500">2.</span>
            <span>In the theme editor, put this single line in each product template&rsquo;s Custom
            Liquid block (replacing the old pasted code):</span></li>
        </ol>
        <div className="flex items-center gap-2 mt-2 ml-6">
          <code className="px-3 py-1.5 bg-white border border-sky-200 rounded-lg text-sm text-slate-800">{RENDER_LINE}</code>
          <button
            onClick={() => copyText(RENDER_LINE, setCopiedLine)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {copiedLine ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedLine ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <p className="text-sm text-sky-700/90 mt-3 ml-6">
          That&rsquo;s it — from then on, widget updates are step 1 only. Offer and design changes
          don&rsquo;t even need that; they apply live automatically.
        </p>
      </div>

      {/* Manual fallback */}
      <button
        onClick={() => setShowManual(v => !v)}
        className="text-sm text-slate-500 hover:text-slate-700 underline"
      >
        {showManual ? 'Hide' : 'Show'} the manual copy-paste method
      </button>

      {showManual && (
        <>
          <div className="bg-white border border-slate-200 rounded-2xl p-6">
            <h3 className="font-semibold text-slate-800 mb-3">Manual install (paste the full code)</h3>
            <ol className="space-y-3 text-sm text-slate-700">
              {INSTALL_STEPS.map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="font-bold text-sky-500 shrink-0">{i + 1}.</span>
                  <div>
                    <p className="font-medium">{step.title}</p>
                    <p className="text-slate-500">{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="relative">
            <button
              onClick={() => copyText(snippet, setCopied)}
              className="absolute right-3 top-3 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-white/90 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 hover:bg-white shadow-sm"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Copy snippet'}
            </button>
            <pre className="bg-slate-900 text-slate-200 text-xs rounded-2xl p-5 overflow-x-auto max-h-[28rem] nice-scrollbar">
              <code>{snippet}</code>
            </pre>
          </div>
        </>
      )}

      <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
        <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
        <div className="text-sm text-emerald-800">
          <p className="font-medium mb-1">Why this can't break like SellEasy did</p>
          <p className="text-emerald-700">
            Offers are keyed only by product and variant IDs, stored on the product itself in Shopify.
            Images, prices, and availability are looked up live by your theme every time the page renders —
            so swapping images, renaming products, or changing prices never touches the widget.
            It only disappears for a product if you delete that add-on product entirely, and even then
            the rest of the widget keeps working.
          </p>
        </div>
      </div>
    </div>
  );
}

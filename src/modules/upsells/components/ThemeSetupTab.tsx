import { useMemo, useState } from 'react';
import { Copy, Check, ShieldCheck } from 'lucide-react';
import { buildThemeSnippet, INSTALL_STEPS } from '../snippet';

// One-time theme install: the snippet goes in once, then every offer is
// managed from the Offers tab — no more theme edits ever.
export default function ThemeSetupTab() {
  const [copied, setCopied] = useState(false);
  const snippet = useMemo(buildThemeSnippet, []);

  async function copySnippet() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-sky-50 to-indigo-50 border border-sky-200 rounded-2xl p-6">
        <h3 className="font-semibold text-sky-800 mb-3">One-time setup (about 2 minutes)</h3>
        <ol className="space-y-3 text-sm text-sky-800">
          {INSTALL_STEPS.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="font-bold text-sky-500 shrink-0">{i + 1}.</span>
              <div>
                <p className="font-medium">{step.title}</p>
                <p className="text-sky-700/80">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="relative">
        <button
          onClick={copySnippet}
          className="absolute right-3 top-3 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-white/90 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 hover:bg-white shadow-sm"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied!' : 'Copy snippet'}
        </button>
        <pre className="bg-slate-900 text-slate-200 text-xs rounded-2xl p-5 overflow-x-auto max-h-[28rem] nice-scrollbar">
          <code>{snippet}</code>
        </pre>
      </div>

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

import { BarChart3, Upload, ArrowRight } from 'lucide-react';

export default function CrossSellModule() {
  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="text-center py-16">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-card shadow-lg shadow-emerald-500/25 mb-6">
          <BarChart3 className="w-10 h-10 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-content mb-2">Cross-Sell Analyzer</h2>
        <p className="text-content-secondary max-w-md mx-auto mb-8">
          Upload your Shopify cross-purchase CSV reports to discover which products customers buy together and identify upsell opportunities.
        </p>
        <div className="bg-surface-hover rounded-card p-6 max-w-lg mx-auto border border-edge">
          <h3 className="font-semibold text-content mb-3 flex items-center gap-2">
            <Upload className="w-4 h-4" /> Coming Up
          </h3>
          <ul className="text-sm text-content-secondary space-y-2 text-left">
            <li className="flex items-center gap-2"><ArrowRight className="w-3 h-3 text-emerald-500 shrink-0" /> CSV upload with drag-and-drop</li>
            <li className="flex items-center gap-2"><ArrowRight className="w-3 h-3 text-emerald-500 shrink-0" /> Cross-sell frequency analysis</li>
            <li className="flex items-center gap-2"><ArrowRight className="w-3 h-3 text-emerald-500 shrink-0" /> Top upsell opportunity recommendations</li>
            <li className="flex items-center gap-2"><ArrowRight className="w-3 h-3 text-emerald-500 shrink-0" /> Year-over-year comparison</li>
            <li className="flex items-center gap-2"><ArrowRight className="w-3 h-3 text-emerald-500 shrink-0" /> JSON import from existing app</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

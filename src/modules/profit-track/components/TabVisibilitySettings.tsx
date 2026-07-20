import { Layout, Eye, EyeOff } from 'lucide-react';
import type { ProfitTabId, UserUIPreferences } from '../types';

interface TabVisibilitySettingsProps {
  uiPrefs: UserUIPreferences;
  onUpdate: (next: UserUIPreferences) => void;
}

// Dashboard, Add Data, and Settings stay visible always — hiding any of those
// would make Profit unusable (no overview, no way to enter data, no way to
// turn things back on).
const HIDEABLE_TABS: { id: ProfitTabId; label: string; description: string }[] = [
  { id: 'weekly', label: 'Weekly Summary', description: 'Week-by-week breakdown with custom notes.' },
  { id: 'books', label: 'Book ROI', description: 'Per-book profitability tracker with bundle splits.' },
  { id: 'reports', label: 'Reports (Monthly/Yearly)', description: 'Year-over-year trends and monthly comparisons.' },
  { id: 'orders', label: 'Orders & Page Reads', description: 'Monthly unit sales by source and KENP page reads.' },
  { id: 'data', label: 'All Records', description: 'Raw daily entry log.' },
];

export default function TabVisibilitySettings({ uiPrefs, onUpdate }: TabVisibilitySettingsProps) {
  const hidden = new Set(uiPrefs.hiddenProfitTabs);

  const toggle = (id: ProfitTabId) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onUpdate({ ...uiPrefs, hiddenProfitTabs: Array.from(next) });
  };

  return (
    <div className="bg-surface p-6 rounded-card shadow-sm border border-gray-100">
      <h3 className="text-lg font-semibold text-content mb-1 flex items-center gap-2">
        <Layout className="w-5 h-5 text-indigo-500" />
        Profit Tabs
      </h3>
      <p className="text-sm text-content-secondary mb-6">
        Hide tabs you don't use. Dashboard, Add Data, and Settings stay
        visible by design.
      </p>

      <div className="space-y-2">
        {HIDEABLE_TABS.map((tab) => {
          const isHidden = hidden.has(tab.id);
          return (
            <div
              key={tab.id}
              className={`flex items-center gap-4 p-3 rounded-control border ${
                isHidden ? 'bg-surface-hover border-edge opacity-70' : 'bg-surface border-edge'
              }`}
            >
              <div className="flex-1">
                <div className="text-sm font-medium text-content">{tab.label}</div>
                <div className="text-xs text-content-secondary">{tab.description}</div>
              </div>
              <button
                onClick={() => toggle(tab.id)}
                className={`p-1.5 rounded ${
                  isHidden
                    ? 'text-content-muted hover:bg-surface-sunken'
                    : 'text-emerald-600 hover:bg-emerald-50'
                }`}
                title={isHidden ? 'Hidden — click to show' : 'Visible — click to hide'}
              >
                {isHidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

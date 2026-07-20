import React from 'react';
import { LucideIcon } from 'lucide-react';

interface SummaryCardProps {
  title: string;
  value: string;
  subValue?: string;
  icon: LucideIcon;
  trend?: 'up' | 'down' | 'neutral';
  colorClass?: string;
}

// Map the icon color class to matching light background + foreground classes.
// Using a static map (instead of string replacement) so Tailwind can detect
// the classes at build time and to avoid Tailwind v4's removal of bg-opacity-*.
const COLOR_STYLES: Record<string, { bg: string; fg: string }> = {
  'text-emerald-600': { bg: 'bg-emerald-50', fg: 'text-emerald-600' },
  'text-red-500': { bg: 'bg-red-50', fg: 'text-red-500' },
  'text-indigo-600': { bg: 'bg-indigo-50', fg: 'text-indigo-600' },
  'text-amber-500': { bg: 'bg-amber-50', fg: 'text-amber-500' },
  'text-blue-600': { bg: 'bg-blue-50', fg: 'text-blue-600' },
  'text-purple-600': { bg: 'bg-purple-50', fg: 'text-purple-600' },
  'text-green-600': { bg: 'bg-green-50', fg: 'text-green-600' },
};

export const SummaryCard: React.FC<SummaryCardProps> = ({
  title,
  value,
  subValue,
  icon: Icon,
  trend,
  colorClass = 'text-blue-600',
}) => {
  const styles = COLOR_STYLES[colorClass] ?? COLOR_STYLES['text-blue-600'];
  return (
    <div className="bg-surface p-6 rounded-card shadow-sm border border-gray-100 flex items-start justify-between">
      <div>
        <p className="text-sm font-medium text-gray-500 mb-1">{title}</p>
        <h3 className="text-2xl font-bold text-gray-900">{value}</h3>
        {subValue && (
          <p className={`text-xs mt-2 font-medium ${trend === 'down' ? 'text-red-500' : 'text-green-600'}`}>
            {subValue}
          </p>
        )}
      </div>
      <div className={`p-3 rounded-control ${styles.bg}`}>
        <Icon className={`w-6 h-6 ${styles.fg}`} />
      </div>
    </div>
  );
};

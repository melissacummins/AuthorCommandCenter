import React, { useState, useMemo, useEffect, useRef } from 'react';
import { DailyRecord, WeeklyNote, ProfitCategory } from '../types';
import { groupDataByWeek, formatCurrency } from '../utils/calculations';
import { ChevronDown, ChevronUp, FileText } from 'lucide-react';

interface WeeklySummaryProps {
  data: DailyRecord[];
  notes: WeeklyNote[];
  categories: ProfitCategory[];
  onUpdateNote: (weekStartDate: string, content: string) => void;
}

// Helper component for auto-resizing textarea
const AutoResizeTextarea = ({ value, onChange, placeholder, minHeight = '38px', autoFocus = false }: { value: string, onChange: (val: string) => void, placeholder?: string, minHeight?: string, autoFocus?: boolean }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [value]);
  
  useEffect(() => {
      if (autoFocus && textareaRef.current) {
          textareaRef.current.focus();
          // Move cursor to end
          textareaRef.current.setSelectionRange(textareaRef.current.value.length, textareaRef.current.value.length);
      }
  }, [autoFocus]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={1}
      className="w-full text-sm border border-edge-strong bg-surface focus:border-brand-500 focus:ring-2 focus:ring-brand-200 rounded-control px-3 py-2 transition-all placeholder-gray-400 resize-none overflow-hidden leading-relaxed shadow-sm"
      style={{ minHeight }}
    />
  );
};

export const WeeklySummary: React.FC<WeeklySummaryProps> = ({ data, notes, categories, onUpdateNote }) => {
  const [selectedYear, setSelectedYear] = useState<string>('All');
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());

  const weeklyData = useMemo(() => groupDataByWeek(data, categories), [data, categories]);
  
  // Extract unique years
  const years = useMemo(() => {
    const y = new Set(weeklyData.map(w => w.weekStart.substring(0, 4)));
    return Array.from(y).sort().reverse();
  }, [weeklyData]);

  // Filter based on selection
  const filteredData = useMemo(() => {
    if (selectedYear === 'All') return weeklyData;
    return weeklyData.filter(w => w.weekStart.startsWith(selectedYear));
  }, [weeklyData, selectedYear]);

  const getNote = (weekStart: string) => {
    return notes.find(n => n.weekStartDate === weekStart)?.content || '';
  };

  const toggleRow = (weekStart: string) => {
    const newSet = new Set(expandedWeeks);
    if (newSet.has(weekStart)) {
        newSet.delete(weekStart);
    } else {
        newSet.add(weekStart);
    }
    setExpandedWeeks(newSet);
  };

  if (weeklyData.length === 0) {
    return <div className="p-8 text-center text-content-secondary">No data available to generate weekly summary.</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Year Filter Controls */}
      <div className="flex justify-between items-center bg-surface p-4 rounded-card shadow-sm border border-edge-soft">
         <h2 className="text-lg font-bold text-content">Weekly Performance</h2>
         
         <div className="relative">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="appearance-none bg-surface border border-edge-strong text-content py-2 px-4 pr-8 rounded-control leading-tight focus:outline-none focus:bg-surface focus:border-brand-500 cursor-pointer"
            >
              <option value="All">All Years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-content">
              <ChevronDown className="w-4 h-4" />
            </div>
         </div>
      </div>

      <div className="bg-surface rounded-card shadow-sm border border-edge-soft overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-edge">
            <thead className="bg-surface-hover">
              <tr>
                <th className="px-2 py-3 text-center text-xs font-bold text-content-secondary uppercase tracking-wider border-r border-edge">Week</th>
                <th className="px-2 py-3 text-left text-xs font-medium text-content-secondary uppercase tracking-wider">Start</th>
                <th className="px-2 py-3 text-left text-xs font-medium text-content-secondary uppercase tracking-wider border-r border-edge">End</th>

                <th className="px-2 py-3 text-right text-xs font-bold text-content uppercase tracking-wider border-r border-edge bg-surface-sunken">Total Spend</th>
                
                <th className="px-2 py-3 text-right text-xs font-bold text-content uppercase tracking-wider">Revenue</th>
                <th className="px-2 py-3 text-right text-xs font-bold text-content uppercase tracking-wider">Net</th>
                <th className="px-2 py-3 text-right text-xs font-bold text-content uppercase tracking-wider border-r border-edge">ROAS</th>
                
                <th className="px-4 py-3 text-left text-xs font-bold text-content-secondary uppercase tracking-wider">Notes</th>
              </tr>
            </thead>
            <tbody className="bg-surface divide-y divide-edge">
              {filteredData.map((row) => {
                const start = new Date(row.weekStart + 'T00:00:00');
                const end = new Date(row.weekEnd + 'T00:00:00');
                // Format dates as MM/DD/YY
                const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
                
                const note = getNote(row.weekStart);
                const isExpanded = expandedWeeks.has(row.weekStart);

                return (
                  <React.Fragment key={row.weekStart}>
                    <tr 
                        className={`transition-colors group ${isExpanded ? 'bg-brand-50/30' : 'hover:bg-surface-hover'}`}
                        onClick={() => toggleRow(row.weekStart)}
                    >
                        <td className="px-2 py-3 text-center text-sm font-medium text-content-secondary border-r border-edge align-middle">
                        {row.weekNumber}
                        </td>
                        <td className="px-2 py-3 whitespace-nowrap text-sm text-content align-middle">
                        {fmtDate(start)}
                        </td>
                        <td className="px-2 py-3 whitespace-nowrap text-sm text-content border-r border-edge align-middle">
                        {fmtDate(end)}
                        </td>

                        <td className="px-2 py-3 whitespace-nowrap text-sm text-right font-medium text-red-600 border-r border-edge bg-surface-hover/50 align-middle">
                        {formatCurrency(row.totalAds)}
                        </td>

                        <td className="px-2 py-3 whitespace-nowrap text-sm text-right font-medium text-emerald-600 align-middle">
                        {formatCurrency(row.totalRevenue)}
                        </td>
                        <td className={`px-2 py-3 whitespace-nowrap text-sm text-right font-bold ${row.netRevenue >= 0 ? 'text-content' : 'text-red-500'} align-middle`}>
                        {formatCurrency(row.netRevenue)}
                        </td>
                        <td className="px-2 py-3 whitespace-nowrap text-sm text-right text-content-secondary border-r border-edge align-middle">
                        {row.roas.toFixed(2)}x
                        </td>

                        <td className="px-4 py-3 cursor-pointer group-hover:bg-surface-sunken/50 transition-colors">
                            <div className="flex items-center justify-between text-sm text-content-secondary">
                                <div className="flex items-center truncate max-w-[200px]">
                                    {note ? (
                                        <>
                                            <FileText className="w-4 h-4 mr-2 text-brand-500 flex-shrink-0" />
                                            <span className="truncate">{note}</span>
                                        </>
                                    ) : (
                                        <span className="text-content-muted italic pl-1">Add note...</span>
                                    )}
                                </div>
                                {isExpanded ? <ChevronUp className="w-4 h-4 text-brand-500" /> : <ChevronDown className="w-4 h-4 text-content-muted" />}
                            </div>
                        </td>
                    </tr>
                    
                    {/* Expandable Details Row */}
                    {isExpanded && (
                        <tr className="bg-brand-50/30 animate-fade-in">
                            <td colSpan={8} className="px-4 py-4 border-b border-brand-100">
                                <div className="max-w-4xl mx-auto">
                                    <label className="block text-xs font-bold text-content-secondary uppercase tracking-wider mb-2">
                                        Notes for Week {row.weekNumber} ({fmtDate(start)} - {fmtDate(end)})
                                    </label>
                                    <AutoResizeTextarea 
                                        value={note}
                                        onChange={(val) => onUpdateNote(row.weekStart, val)}
                                        placeholder="Enter details, observations, or context for this week..."
                                        minHeight="80px"
                                        autoFocus={true}
                                    />
                                    <div className="flex justify-end mt-2">
                                        <button 
                                            onClick={() => toggleRow(row.weekStart)}
                                            className="text-xs text-brand-600 hover:text-brand-800 font-medium px-3 py-1 bg-brand-100 hover:bg-brand-200 rounded-full transition-colors"
                                        >
                                            Done
                                        </button>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          
          {filteredData.length === 0 && (
             <div className="p-12 text-center text-content-secondary">
                <p>No data available for {selectedYear}.</p>
             </div>
          )}
        </div>
      </div>
    </div>
  );
};
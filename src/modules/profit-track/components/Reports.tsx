import React, { useState, useMemo } from 'react';
import { DailyRecord, OrderSource, MonthlyOrderEntry, MonthlyPageReads, ProfitCategory } from '../types';
import { groupDataByMonth, groupDataByYear, formatCurrency, formatPercent, formatNumber } from '../utils/calculations';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { ChevronDown, BookOpen, Layers } from 'lucide-react';
import { SummaryCard } from './SummaryCard';

interface ReportsProps {
  data: DailyRecord[];
  sources: OrderSource[];
  monthlyOrders: MonthlyOrderEntry[];
  monthlyPageReads: MonthlyPageReads[];
  categories: ProfitCategory[];
}

export const Reports: React.FC<ReportsProps> = ({ data, sources, monthlyOrders, monthlyPageReads, categories }) => {
  const [activeTab, setActiveTab] = useState<'monthly' | 'yearly'>('monthly');
  const [selectedYear, setSelectedYear] = useState<string>('All');

  const yearlyData = useMemo(
    () => groupDataByYear(data, sources, monthlyOrders, monthlyPageReads, categories),
    [data, sources, monthlyOrders, monthlyPageReads, categories],
  );
  const monthlyData = useMemo(
    () => groupDataByMonth(data, sources, monthlyOrders, monthlyPageReads, categories),
    [data, sources, monthlyOrders, monthlyPageReads, categories],
  );

  // Extract available years for filter
  const years = useMemo(() => {
    const y = Array.from(new Set(monthlyData.map(d => d.year))); // Use monthlyData year property which covers all data types
    return y.sort().reverse();
  }, [monthlyData]);

  const filteredMonthlyData = useMemo(() => {
    if (selectedYear === 'All') return monthlyData;
    return monthlyData.filter(m => m.year === selectedYear);
  }, [monthlyData, selectedYear]);

  // Aggregates for the current view
  const viewAggregates = useMemo(() => {
    const dataset = activeTab === 'monthly' ? filteredMonthlyData : yearlyData;
    return dataset.reduce((acc, curr) => ({
      units: acc.units + curr.unitsSold,
      reads: acc.reads + curr.pageReads
    }), { units: 0, reads: 0 });
  }, [activeTab, filteredMonthlyData, yearlyData]);

  return (
    <div className="space-y-6 animate-fade-in">
      
      {/* Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-center bg-surface p-4 rounded-card shadow-sm border border-gray-100">
        <div className="flex bg-gray-100 p-1 rounded-control mb-4 sm:mb-0">
          <button
            onClick={() => setActiveTab('monthly')}
            className={`px-4 py-2 text-sm font-medium rounded-control transition-all ${
              activeTab === 'monthly' ? 'bg-surface text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Month by Month
          </button>
          <button
            onClick={() => setActiveTab('yearly')}
            className={`px-4 py-2 text-sm font-medium rounded-control transition-all ${
              activeTab === 'yearly' ? 'bg-surface text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Yearly Overview
          </button>
        </div>

        {activeTab === 'monthly' && (
          <div className="relative">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="appearance-none bg-surface border border-gray-300 text-gray-700 py-2 px-4 pr-8 rounded-control leading-tight focus:outline-none focus:bg-surface focus:border-blue-500"
            >
              <option value="All">All Years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
              <ChevronDown className="w-4 h-4" />
            </div>
          </div>
        )}
      </div>

      {/* Metric Highlights for this View */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
         <SummaryCard 
            title="Total Units Sold" 
            value={formatNumber(viewAggregates.units)}
            subValue="Calculated using bundle multipliers"
            icon={Layers}
            colorClass="text-blue-600"
         />
         <SummaryCard 
            title="Total Page Reads" 
            value={formatNumber(viewAggregates.reads)}
            subValue="KENP & Kobo Plus"
            icon={BookOpen}
            colorClass="text-indigo-600"
         />
      </div>

      {activeTab === 'monthly' && (
        <>
          <div className="bg-surface p-6 rounded-card shadow-sm border border-gray-100">
            <h3 className="text-lg font-bold text-gray-800 mb-6">Financial Overview</h3>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={filteredMonthlyData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-edge)" />
                  <XAxis dataKey="monthKey" stroke="var(--color-content-muted)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--color-content-muted)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `$${val}`} />
                  <Tooltip 
                    formatter={(value: number) => formatCurrency(value)}
                    labelFormatter={(label) => {
                        const m = filteredMonthlyData.find(d => d.monthKey === label);
                        return m ? `${m.monthName} ${m.year}` : label;
                    }}
                  />
                  <Legend />
                  <Bar dataKey="totalRevenue" name="Revenue" fill="#10B981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="totalSpend" name="Spend" fill="#EF4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-surface rounded-card shadow-sm border border-gray-100 overflow-hidden">
             <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Month</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Revenue</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Spend</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Net Profit</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">ROAS</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Units Sold</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Page Reads</th>
                  </tr>
                </thead>
                <tbody className="bg-surface divide-y divide-gray-200">
                  {filteredMonthlyData.map((row) => (
                    <tr key={row.monthKey} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {row.monthName} <span className="text-gray-400 font-normal">{row.year}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                        {formatCurrency(row.totalRevenue)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-600">
                        {formatCurrency(row.totalSpend)}
                      </td>
                      <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-bold ${row.netRevenue >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {formatCurrency(row.netRevenue)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-900">
                        {row.roas.toFixed(2)}x
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-blue-700 bg-blue-50/50">
                        {formatNumber(row.unitsSold)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">
                        {formatNumber(row.pageReads)}
                      </td>
                    </tr>
                  ))}
                </tbody>
             </table>
          </div>
        </>
      )}

      {activeTab === 'yearly' && (
        <div className="grid grid-cols-1 gap-6">
           <div className="bg-surface p-6 rounded-card shadow-sm border border-gray-100">
            <h3 className="text-lg font-bold text-gray-800 mb-6">Yearly Growth</h3>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={[...yearlyData].reverse()} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-edge)" />
                  <XAxis dataKey="year" stroke="var(--color-content-muted)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--color-content-muted)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `$${val}`} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend />
                  <Bar dataKey="totalRevenue" name="Revenue" fill="#4F46E5" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="netRevenue" name="Net Profit" fill="#10B981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-surface rounded-card shadow-sm border border-gray-100 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Year</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Revenue</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Spend</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Net Profit</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">ROAS</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Units Sold</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Page Reads</th>
                </tr>
              </thead>
              <tbody className="bg-surface divide-y divide-gray-200">
                {yearlyData.map((row) => (
                  <tr key={row.year} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-lg font-bold text-gray-900">
                      {row.year}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                      {formatCurrency(row.totalRevenue)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-600">
                      {formatCurrency(row.totalSpend)}
                    </td>
                    <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-bold ${row.netRevenue >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {formatCurrency(row.netRevenue)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-900">
                        {row.roas.toFixed(2)}x
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-blue-700 bg-blue-50/50">
                        {formatNumber(row.unitsSold)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">
                        {formatNumber(row.pageReads)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
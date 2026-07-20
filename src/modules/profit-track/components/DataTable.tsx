import React, { useState, useMemo, useEffect } from 'react';
import { DailyRecord, ProfitCategory } from '../types';
import { calculateMetrics, formatCurrency, formatPercent } from '../utils/calculations';
import { Pencil, Trash2, Search, ChevronLeft, ChevronRight, Filter } from 'lucide-react';

interface DataTableProps {
  data: DailyRecord[];
  categories: ProfitCategory[];
  onDelete: (id: string) => void;
  onEdit: (record: DailyRecord) => void;
}

export const DataTable: React.FC<DataTableProps> = ({ data, categories, onDelete, onEdit }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedYear, setSelectedYear] = useState('All');
  const [selectedMonth, setSelectedMonth] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Extract unique years from data
  const years = useMemo(() => {
    const y = new Set(data.map(r => r.date.substring(0, 4)));
    return Array.from(y).sort().reverse();
  }, [data]);

  const months = [
    { value: '01', label: 'January' },
    { value: '02', label: 'February' },
    { value: '03', label: 'March' },
    { value: '04', label: 'April' },
    { value: '05', label: 'May' },
    { value: '06', label: 'June' },
    { value: '07', label: 'July' },
    { value: '08', label: 'August' },
    { value: '09', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' },
  ];

  // Filter logic
  const filteredData = useMemo(() => {
    return data.filter(record => {
      const matchesSearch = record.date.includes(searchTerm);
      const matchesYear = selectedYear === 'All' || record.date.startsWith(selectedYear);
      const matchesMonth = selectedMonth === 'All' || record.date.substring(5, 7) === selectedMonth;
      return matchesSearch && matchesYear && matchesMonth;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [data, searchTerm, selectedYear, selectedMonth]);

  // Pagination logic
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const paginatedData = filteredData.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedYear, selectedMonth]);

  if (data.length === 0) {
    return (
        <div className="bg-surface p-8 rounded-card shadow-sm border border-edge-soft text-center text-content-secondary">
            No records found. Add some data to get started.
        </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Search & Filter Bar */}
      <div className="bg-surface p-4 rounded-card shadow-sm border border-edge-soft flex flex-col lg:flex-row gap-4 justify-between items-center">
        <div className="relative w-full lg:max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-content-muted" />
            </div>
            <input
                type="text"
                placeholder="Search by date (YYYY-MM-DD)..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 block w-full border-edge-strong rounded-control focus:ring-brand-500 focus:border-brand-500 p-2.5 border"
            />
        </div>

        <div className="flex gap-4 w-full lg:w-auto">
            <div className="relative w-full lg:w-40">
                <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(e.target.value)}
                    className="block w-full pl-3 pr-10 py-2.5 text-base border-edge-strong focus:outline-none focus:ring-brand-500 focus:border-brand-500 sm:text-sm rounded-control border appearance-none bg-surface"
                >
                    <option value="All">All Years</option>
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-content-secondary">
                    <Filter className="h-4 w-4" />
                </div>
            </div>

            <div className="relative w-full lg:w-40">
                <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="block w-full pl-3 pr-10 py-2.5 text-base border-edge-strong focus:outline-none focus:ring-brand-500 focus:border-brand-500 sm:text-sm rounded-control border appearance-none bg-surface"
                >
                    <option value="All">All Months</option>
                    {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-content-secondary">
                    <Filter className="h-4 w-4" />
                </div>
            </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-surface rounded-card shadow-sm border border-edge-soft overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-edge">
            <thead className="bg-surface-hover">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-content-secondary uppercase tracking-wider sticky left-0 bg-surface-hover z-10">Date</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-content-secondary uppercase tracking-wider">Total Revenue</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-content-secondary uppercase tracking-wider">Total Spend</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-content-secondary uppercase tracking-wider">Net Rev</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-content-secondary uppercase tracking-wider">ROAS</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-content-secondary uppercase tracking-wider">Ads %</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-content-secondary uppercase tracking-wider sticky right-0 bg-surface-hover z-10">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-surface divide-y divide-edge">
              {paginatedData.length > 0 ? (
                  paginatedData.map((record) => {
                    const metrics = calculateMetrics(record, categories);
                    return (
                        <tr key={record.id} className="hover:bg-surface-hover transition-colors group">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-content sticky left-0 bg-surface group-hover:bg-surface-hover">
                            {new Date(record.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-content">
                            {formatCurrency(metrics.totalRevenue)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-600">
                            {formatCurrency(metrics.totalAdSpend)}
                        </td>
                        <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-semibold ${metrics.netRevenue >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {formatCurrency(metrics.netRevenue)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-content">
                            {metrics.roas.toFixed(2)}x
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-content-secondary">
                            {formatPercent(metrics.adsToIncomePercent)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium flex justify-end space-x-2 sticky right-0 bg-surface group-hover:bg-surface-hover">
                            <button 
                            onClick={() => onEdit(record)} 
                            className="p-1.5 text-brand-600 hover:text-brand-900 hover:bg-brand-100 rounded-control transition-colors"
                            title="Edit Record"
                            >
                            <Pencil className="w-4 h-4" />
                            </button>
                            <button 
                            onClick={() => onDelete(record.id)} 
                            className="p-1.5 text-red-600 hover:text-red-900 hover:bg-red-100 rounded-control transition-colors"
                            title="Delete Record"
                            >
                            <Trash2 className="w-4 h-4" />
                            </button>
                        </td>
                        </tr>
                    );
                    })
              ) : (
                  <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-content-secondary">
                          No matching records found. Try adjusting your filters.
                      </td>
                  </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination Footer */}
        {filteredData.length > 0 && (
             <div className="bg-surface-hover px-4 py-3 flex items-center justify-between border-t border-edge sm:px-6">
                <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                    <div>
                        <p className="text-sm text-content">
                            Showing <span className="font-medium">{Math.min((currentPage - 1) * itemsPerPage + 1, filteredData.length)}</span> to <span className="font-medium">{Math.min(currentPage * itemsPerPage, filteredData.length)}</span> of <span className="font-medium">{filteredData.length}</span> results
                        </p>
                    </div>
                    <div>
                        <nav className="relative z-0 inline-flex rounded-control shadow-sm -space-x-px" aria-label="Pagination">
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="relative inline-flex items-center px-2 py-2 rounded-l-control border border-edge-strong bg-surface text-sm font-medium text-content-secondary hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <span className="sr-only">Previous</span>
                                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                            </button>
                            <div className="relative inline-flex items-center px-4 py-2 border border-edge-strong bg-surface text-sm font-medium text-content">
                                Page {currentPage} of {Math.max(1, totalPages)}
                            </div>
                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages || totalPages === 0}
                                className="relative inline-flex items-center px-2 py-2 rounded-r-control border border-edge-strong bg-surface text-sm font-medium text-content-secondary hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <span className="sr-only">Next</span>
                                <ChevronRight className="h-5 w-5" aria-hidden="true" />
                            </button>
                        </nav>
                    </div>
                </div>
                {/* Mobile Pagination View */}
                 <div className="flex items-center justify-between w-full sm:hidden">
                    <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="relative inline-flex items-center px-4 py-2 border border-edge-strong text-sm font-medium rounded-control text-content bg-surface hover:bg-surface-hover disabled:opacity-50"
                    >
                        Previous
                    </button>
                    <span className="text-sm text-content">
                        {currentPage} / {Math.max(1, totalPages)}
                    </span>
                    <button
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="relative inline-flex items-center px-4 py-2 border border-edge-strong text-sm font-medium rounded-control text-content bg-surface hover:bg-surface-hover disabled:opacity-50"
                    >
                        Next
                    </button>
                </div>
            </div>
        )}
      </div>
    </div>
  );
};
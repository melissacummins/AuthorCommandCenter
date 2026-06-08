
import React, { useState, useMemo } from 'react';
import { BookProduct, BookDailyMetric } from '../types';
import { Plus, Trash2, Save, Layers, Book, Calendar, ChevronDown, ChevronRight, Calculator, RefreshCw, CornerDownRight } from 'lucide-react';
import { formatCurrency } from '../utils/calculations';
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface BookTrackerProps {
  books: BookProduct[];
  onUpdateBooks: (books: BookProduct[]) => void;
  metrics: BookDailyMetric[];
  onUpdateMetrics: (metrics: BookDailyMetric[]) => void;
  onSyncDailyMetrics?: (
      date: string, 
      totals: { 
          pnrAds: number, contempAds: number, trafficAds: number, miscAds: number,
          amazonRev: number, shopifyRev: number, d2dRev: number, 
          googleRev: number, koboRev: number, koboPlusRev: number
      }
  ) => void;
}

// --- Extracted Components to prevent re-render focus loss ---

interface TableCellInputProps {
  bookId: string;
  field: keyof BookDailyMetric;
  metrics: BookDailyMetric[];
  pendingMetrics: Record<string, Partial<BookDailyMetric>>;
  selectedDate: string;
  onChange: (bookId: string, field: keyof BookDailyMetric, val: string) => void;
}

const TableCellInput: React.FC<TableCellInputProps> = ({ 
  bookId, 
  field, 
  metrics, 
  pendingMetrics, 
  selectedDate, 
  onChange 
}) => {
  // Determine value: pending > existing > empty
  // UPDATE: Convert 0 to '' so the placeholder "-" shows instead of "0"
  const value = useMemo(() => {
     if (pendingMetrics[bookId] && pendingMetrics[bookId][field] !== undefined) {
        const val = pendingMetrics[bookId][field];
        return val === 0 ? '' : val;
     }
     const existing = metrics.find(m => m.date === selectedDate && m.bookId === bookId);
     const val = existing ? existing[field] : '';
     return val === 0 ? '' : val;
  }, [metrics, pendingMetrics, bookId, field, selectedDate]);

  return (
      <input 
        type="number" 
        step="0.01" 
        placeholder="-" 
        value={value as string | number}
        onChange={(e) => onChange(bookId, field, e.target.value)} 
        className="w-24 text-right p-1.5 border border-gray-200 rounded text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-transparent placeholder-gray-300" 
      />
  );
};

interface BookRowProps {
  book: BookProduct;
  allBooks: BookProduct[];
  metrics: BookDailyMetric[];
  pendingMetrics: Record<string, Partial<BookDailyMetric>>;
  selectedDate: string;
  onMetricChange: (bookId: string, field: keyof BookDailyMetric, val: string) => void;
  expandedParents: Set<string>;
  onToggleExpand: (id: string) => void;
  isChild?: boolean;
}

const BookRow: React.FC<BookRowProps> = ({ 
  book, 
  allBooks, 
  metrics, 
  pendingMetrics, 
  selectedDate, 
  onMetricChange, 
  expandedParents, 
  onToggleExpand, 
  isChild = false 
}) => {
    // Find children for this book (translations)
    const children = allBooks.filter(b => b.parentId === book.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedParents.has(book.id);

    return (
        <>
          <tr className={`hover:bg-gray-50 ${isChild ? 'bg-gray-50/50' : 'bg-white'}`}>
              <td className={`px-4 py-2 sticky left-0 z-10 shadow-sm border-r border-gray-100 ${isChild ? 'bg-gray-50' : 'bg-white'}`}>
                  <div className={`flex items-center ${isChild ? 'pl-6' : ''}`}>
                      {hasChildren && !isChild && (
                           <button onClick={() => onToggleExpand(book.id)} className="mr-2 text-gray-400 hover:text-blue-500 focus:outline-none">
                               {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                           </button>
                      )}
                      {isChild && <CornerDownRight className="w-3 h-3 text-gray-400 mr-2" />}
                      <div className="overflow-hidden">
                          <div className="text-sm font-medium text-gray-900 truncate w-44" title={book.title}>
                              {book.title}
                          </div>
                          <div className="text-xs text-gray-500 truncate flex items-center">
                              {book.language && book.language !== 'English' && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 mr-2">
                                      {book.language}
                                  </span>
                              )}
                              {book.series}
                          </div>
                      </div>
                  </div>
              </td>
              <td className="px-2 py-2 bg-red-50/10"><TableCellInput bookId={book.id} field="pnrAds" metrics={metrics} pendingMetrics={pendingMetrics} selectedDate={selectedDate} onChange={onMetricChange} /></td>
              <td className="px-2 py-2 bg-red-50/10"><TableCellInput bookId={book.id} field="contempAds" metrics={metrics} pendingMetrics={pendingMetrics} selectedDate={selectedDate} onChange={onMetricChange} /></td>
              <td className="px-2 py-2 bg-red-50/10"><TableCellInput bookId={book.id} field="trafficAds" metrics={metrics} pendingMetrics={pendingMetrics} selectedDate={selectedDate} onChange={onMetricChange} /></td>
              <td className="px-2 py-2 bg-red-50/10"><TableCellInput bookId={book.id} field="miscAds" metrics={metrics} pendingMetrics={pendingMetrics} selectedDate={selectedDate} onChange={onMetricChange} /></td>
              <td className="px-2 py-2 bg-green-50/10"><TableCellInput bookId={book.id} field="amazonRev" metrics={metrics} pendingMetrics={pendingMetrics} selectedDate={selectedDate} onChange={onMetricChange} /></td>
              <td className="px-2 py-2 bg-green-50/10"><TableCellInput bookId={book.id} field="shopifyRev" metrics={metrics} pendingMetrics={pendingMetrics} selectedDate={selectedDate} onChange={onMetricChange} /></td>
              <td className="px-2 py-2 bg-green-50/10"><TableCellInput bookId={book.id} field="d2dRev" metrics={metrics} pendingMetrics={pendingMetrics} selectedDate={selectedDate} onChange={onMetricChange} /></td>
              <td className="px-2 py-2 bg-green-50/10"><TableCellInput bookId={book.id} field="googleRev" metrics={metrics} pendingMetrics={pendingMetrics} selectedDate={selectedDate} onChange={onMetricChange} /></td>
              <td className="px-2 py-2 bg-green-50/10"><TableCellInput bookId={book.id} field="koboRev" metrics={metrics} pendingMetrics={pendingMetrics} selectedDate={selectedDate} onChange={onMetricChange} /></td>
              <td className="px-2 py-2 bg-green-50/10"><TableCellInput bookId={book.id} field="koboPlusRev" metrics={metrics} pendingMetrics={pendingMetrics} selectedDate={selectedDate} onChange={onMetricChange} /></td>
          </tr>
          {hasChildren && isExpanded && children.map(child => (
              <BookRow 
                key={child.id} 
                book={child} 
                allBooks={allBooks}
                metrics={metrics}
                pendingMetrics={pendingMetrics}
                selectedDate={selectedDate}
                onMetricChange={onMetricChange}
                expandedParents={expandedParents}
                onToggleExpand={onToggleExpand}
                isChild={true} 
              />
          ))}
        </>
    );
};


export const BookTracker: React.FC<BookTrackerProps> = ({ books, onUpdateBooks, metrics, onUpdateMetrics, onSyncDailyMetrics }) => {
  const [activeTab, setActiveTab] = useState<'daily' | 'stats' | 'manage'>('daily');
  
  // -- Manage State --
  const [newTitle, setNewTitle] = useState('');
  const [newSeries, setNewSeries] = useState('');
  const [isBundle, setIsBundle] = useState(false);
  const [selectedBooksForBundle, setSelectedBooksForBundle] = useState<Set<string>>(new Set());
  
  // Translation State
  const [isTranslation, setIsTranslation] = useState(false);
  const [translationLanguage, setTranslationLanguage] = useState('');
  const [selectedParentId, setSelectedParentId] = useState('');

  // -- Daily Entry State --
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [pendingMetrics, setPendingMetrics] = useState<Record<string, Partial<BookDailyMetric>>>({});
  const [saveMessage, setSaveMessage] = useState('');
  const [shouldSync, setShouldSync] = useState(true);
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());

  // -- Stats State --
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string>('');

  // --- Helpers ---
  const singleBooks = books.filter(b => !b.isBundle);
  const rootBooks = singleBooks.filter(b => !b.parentId); // Original books (not translations)
  const translations = singleBooks.filter(b => b.parentId); // Only translations
  const bundles = books.filter(b => b.isBundle);

  const getTranslations = (parentId: string) => translations.filter(t => t.parentId === parentId);

  // --- Manage Logic ---
  const handleAddProduct = () => {
    if (!newTitle) return;
    
    // Auto-append language to title if not present
    let finalTitle = newTitle;
    if (isTranslation && translationLanguage && !newTitle.toLowerCase().includes(translationLanguage.toLowerCase())) {
        finalTitle = `${newTitle} (${translationLanguage})`;
    }

    const newBook: BookProduct = {
        id: crypto.randomUUID(),
        title: finalTitle,
        series: newSeries,
        isBundle: isBundle,
        includedBookIds: isBundle ? Array.from(selectedBooksForBundle) : [],
        language: isTranslation ? translationLanguage : 'English',
        parentId: isTranslation ? selectedParentId : undefined
    };

    onUpdateBooks([...books, newBook]);
    
    // Reset Form
    setNewTitle('');
    setNewSeries('');
    setIsBundle(false);
    setSelectedBooksForBundle(new Set());
    setIsTranslation(false);
    setTranslationLanguage('');
    setSelectedParentId('');
  };

  const handleDeleteBook = (id: string) => {
      // Check if it's a parent with children
      const hasChildren = books.some(b => b.parentId === id);
      if (hasChildren) {
          alert('Cannot delete: This book has translations linked to it. Please delete the translations first.');
          return;
      }

      if (confirm('Delete this book? This will not delete historical data, but it will be removed from lists.')) {
          onUpdateBooks(books.filter(b => b.id !== id));
      }
  };

  const toggleBookInBundle = (id: string) => {
      const next = new Set(selectedBooksForBundle);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelectedBooksForBundle(next);
  };

  const toggleParentExpand = (id: string) => {
      const next = new Set(expandedParents);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setExpandedParents(next);
  };

  // --- Daily Entry Logic ---
  const handleMetricChange = (bookId: string, field: keyof BookDailyMetric, val: string) => {
      const numVal = val === '' ? 0 : parseFloat(val);
      setPendingMetrics(prev => ({
          ...prev,
          [bookId]: {
              ...prev[bookId],
              [field]: numVal
          }
      }));
  };

  const handleSaveDaily = () => {
      let updatedMetrics = [...metrics];
      
      const booksToUpdate = Object.keys(pendingMetrics);
      
      // 1. Update/Add Metrics
      booksToUpdate.forEach(bookId => {
         const updates = pendingMetrics[bookId];
         const existingIndex = updatedMetrics.findIndex(m => m.date === selectedDate && m.bookId === bookId);
         
         if (existingIndex >= 0) {
             updatedMetrics[existingIndex] = { ...updatedMetrics[existingIndex], ...updates };
         } else {
             // Create new record with 0s for missing fields
             const newRecord: BookDailyMetric = {
                 id: crypto.randomUUID(),
                 date: selectedDate,
                 bookId,
                 pnrAds: 0, contempAds: 0, trafficAds: 0, miscAds: 0,
                 amazonRev: 0, shopifyRev: 0, d2dRev: 0, googleRev: 0, koboRev: 0, koboPlusRev: 0,
                 ...updates
             };
             updatedMetrics.push(newRecord);
         }
      });

      onUpdateMetrics(updatedMetrics);
      setPendingMetrics({});

      // 2. Sync to Daily Dashboard if requested
      if (shouldSync && onSyncDailyMetrics) {
        // Calculate daily totals for selectedDate using the updated metrics
        const dailyTotals = updatedMetrics
            .filter(m => m.date === selectedDate)
            .reduce((acc, curr) => ({
                pnrAds: acc.pnrAds + (curr.pnrAds || 0),
                contempAds: acc.contempAds + (curr.contempAds || 0),
                trafficAds: acc.trafficAds + (curr.trafficAds || 0),
                miscAds: acc.miscAds + (curr.miscAds || 0),
                
                amazonRev: acc.amazonRev + (curr.amazonRev || 0),
                shopifyRev: acc.shopifyRev + (curr.shopifyRev || 0),
                d2dRev: acc.d2dRev + (curr.d2dRev || 0),
                googleRev: acc.googleRev + (curr.googleRev || 0),
                koboRev: acc.koboRev + (curr.koboRev || 0),
                koboPlusRev: acc.koboPlusRev + (curr.koboPlusRev || 0)
            }), { 
                pnrAds: 0, contempAds: 0, trafficAds: 0, miscAds: 0,
                amazonRev: 0, shopifyRev: 0, d2dRev: 0, googleRev: 0, koboRev: 0, koboPlusRev: 0 
            });
        
        onSyncDailyMetrics(selectedDate, dailyTotals);
        setSaveMessage('Saved & Synced!');
      } else {
        setSaveMessage('Saved!');
      }
      
      setTimeout(() => setSaveMessage(''), 3000);
  };

  // --- Helper to sum generic fields for stats ---
  const sumSpend = (m: BookDailyMetric) => (m.pnrAds||0) + (m.contempAds||0) + (m.trafficAds||0) + (m.miscAds||0);
  const sumRev = (m: BookDailyMetric) => (m.amazonRev||0) + (m.shopifyRev||0) + (m.d2dRev||0) + (m.googleRev||0) + (m.koboRev||0) + (m.koboPlusRev||0);

  // --- Statistics Logic: Aggregated Summary Table ---
  const aggregatedStats = useMemo(() => {
      const now = new Date();
      const cutoff = new Date();
      if (dateRange === '7d') cutoff.setDate(now.getDate() - 7);
      if (dateRange === '30d') cutoff.setDate(now.getDate() - 30);
      if (dateRange === '90d') cutoff.setDate(now.getDate() - 90);
      if (dateRange === 'all') cutoff.setFullYear(2000);

      const filteredMetrics = metrics.filter(m => new Date(m.date) >= cutoff);

      const stats: Record<string, { spend: number, revenue: number, name: string, isBundle: boolean }> = {};
      books.forEach(b => {
          stats[b.id] = { spend: 0, revenue: 0, name: b.title, isBundle: b.isBundle };
      });

      filteredMetrics.forEach(m => {
          if (stats[m.bookId]) {
             stats[m.bookId].spend += sumSpend(m);
             stats[m.bookId].revenue += sumRev(m);
          }
      });

      // Distribute bundle metrics to individual books
      bundles.forEach(bundle => {
          if (bundle.includedBookIds && bundle.includedBookIds.length > 0) {
             const bundleSpend = stats[bundle.id]?.spend || 0;
             const bundleRev = stats[bundle.id]?.revenue || 0;
             
             const splitSpend = bundleSpend / bundle.includedBookIds.length;
             const splitRev = bundleRev / bundle.includedBookIds.length;

             bundle.includedBookIds.forEach(childId => {
                 if (stats[childId]) {
                     stats[childId].spend += splitSpend;
                     stats[childId].revenue += splitRev;
                 }
             });
          }
      });

      return Object.entries(stats).map(([id, data]) => ({
          id,
          ...data,
          profit: data.revenue - data.spend,
          roas: data.spend > 0 ? data.revenue / data.spend : 0
      })).sort((a,b) => b.revenue - a.revenue);

  }, [metrics, books, dateRange]);


  // --- Statistics Logic: Daily Trend for Selected Product ---
  const dailyTrendData = useMemo(() => {
    if (!selectedAnalysisId) return [];

    const product = books.find(b => b.id === selectedAnalysisId);
    if (!product) return [];

    const now = new Date();
    const cutoff = new Date();
    if (dateRange === '7d') cutoff.setDate(now.getDate() - 7);
    if (dateRange === '30d') cutoff.setDate(now.getDate() - 30);
    if (dateRange === '90d') cutoff.setDate(now.getDate() - 90);
    if (dateRange === 'all') cutoff.setFullYear(2000);

    // Get relevant metrics in range
    const filteredMetrics = metrics.filter(m => new Date(m.date) >= cutoff);
    // Explicitly type uniqueDates to avoid unknown type errors
    const uniqueDates = (Array.from(new Set(filteredMetrics.map(m => m.date))) as string[]).sort();

    const getRaw = (id: string, date: string) => metrics.find(m => m.bookId === id && m.date === date);

    return uniqueDates.map(date => {
        let spend = 0;
        let revenue = 0;

        if (product.isBundle) {
            // For a bundle, we just show its raw data
            const m = getRaw(product.id, date);
            if (m) {
                spend = sumSpend(m);
                revenue = sumRev(m);
            }
        } else {
            // For a book, we show direct + bundle splits
            const m = getRaw(product.id, date);
            if (m) {
                spend += sumSpend(m);
                revenue += sumRev(m);
            }

            // Find parent bundles
            const parentBundles = bundles.filter(b => b.includedBookIds.includes(product.id));
            parentBundles.forEach(bundle => {
                const bm = getRaw(bundle.id, date);
                if (bm) {
                    const bSpend = sumSpend(bm);
                    const bRev = sumRev(bm);
                    spend += (bSpend / bundle.includedBookIds.length);
                    revenue += (bRev / bundle.includedBookIds.length);
                }
            });
        }

        return {
            date,
            spend,
            revenue,
            profit: revenue - spend,
            roas: spend > 0 ? revenue / spend : 0
        };
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  }, [selectedAnalysisId, dateRange, metrics, books, bundles]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-4 mb-6">
        <button 
           onClick={() => setActiveTab('daily')}
           className={`px-5 py-2.5 rounded-lg font-medium flex items-center transition-colors ${activeTab === 'daily' ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
        >
           <Calendar className="w-4 h-4 mr-2" />
           Daily Entry
        </button>
        <button 
           onClick={() => setActiveTab('stats')}
           className={`px-5 py-2.5 rounded-lg font-medium flex items-center transition-colors ${activeTab === 'stats' ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
        >
           <Calculator className="w-4 h-4 mr-2" />
           Profitability & ROI
        </button>
        <button 
           onClick={() => setActiveTab('manage')}
           className={`px-5 py-2.5 rounded-lg font-medium flex items-center transition-colors ${activeTab === 'manage' ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
        >
           <Book className="w-4 h-4 mr-2" />
           Manage Books & Bundles
        </button>
      </div>

      {/* --- DAILY ENTRY VIEW --- */}
      {activeTab === 'daily' && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
             <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 pb-6 border-b border-gray-100">
                 <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Select Date</label>
                    <input 
                       type="date" 
                       value={selectedDate}
                       onChange={(e) => setSelectedDate(e.target.value)}
                       className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                 </div>
                 <div className="mt-4 sm:mt-0 flex flex-col items-end">
                     <div className="flex items-center space-x-2 mb-2">
                        <input 
                            type="checkbox" 
                            id="syncToggle"
                            checked={shouldSync}
                            onChange={(e) => setShouldSync(e.target.checked)}
                            className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
                        />
                        <label htmlFor="syncToggle" className="text-sm text-gray-700 select-none flex items-center" title="Sums up all book revenue/spend for this date and overwrites the main dashboard record">
                            <RefreshCw className="w-3 h-3 mr-1 text-gray-500" />
                            Sync totals to Daily Dashboard
                        </label>
                     </div>
                     <div className="flex items-center space-x-4">
                        {saveMessage && <span className="text-green-600 text-sm font-medium animate-pulse">{saveMessage}</span>}
                        <button 
                            onClick={handleSaveDaily}
                            className="flex items-center px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold shadow-sm"
                        >
                            <Save className="w-4 h-4 mr-2" />
                            Save Entries
                        </button>
                     </div>
                 </div>
             </div>
             
             {books.length === 0 ? (
                 <div className="text-center py-12 text-gray-500">
                     No books found. Go to "Manage Books" to set up your library.
                 </div>
             ) : (
                 <div className="overflow-x-auto pb-4 max-h-[70vh] relative">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase sticky left-0 top-0 bg-gray-50 z-30 w-48 shadow-sm outline outline-1 outline-gray-200">Product</th>
                                <th className="px-2 py-3 text-center text-xs font-bold text-red-600 uppercase w-28 bg-red-50 sticky top-0 z-20 shadow-sm">PNR Ads</th>
                                <th className="px-2 py-3 text-center text-xs font-bold text-red-600 uppercase w-28 bg-red-50 sticky top-0 z-20 shadow-sm">Contemp Ads</th>
                                <th className="px-2 py-3 text-center text-xs font-bold text-red-600 uppercase w-28 bg-red-50 sticky top-0 z-20 shadow-sm">Traffic Ads</th>
                                <th className="px-2 py-3 text-center text-xs font-bold text-red-600 uppercase w-28 bg-red-50 sticky top-0 z-20 shadow-sm">Misc Ads</th>
                                <th className="px-2 py-3 text-center text-xs font-bold text-green-600 uppercase w-28 bg-green-50 sticky top-0 z-20 shadow-sm">Amazon Rev</th>
                                <th className="px-2 py-3 text-center text-xs font-bold text-green-600 uppercase w-28 bg-green-50 sticky top-0 z-20 shadow-sm">Shopify Rev</th>
                                <th className="px-2 py-3 text-center text-xs font-bold text-green-600 uppercase w-28 bg-green-50 sticky top-0 z-20 shadow-sm">D2D Rev</th>
                                <th className="px-2 py-3 text-center text-xs font-bold text-green-600 uppercase w-28 bg-green-50 sticky top-0 z-20 shadow-sm">Google Rev</th>
                                <th className="px-2 py-3 text-center text-xs font-bold text-green-600 uppercase w-28 bg-green-50 sticky top-0 z-20 shadow-sm">Kobo Rev</th>
                                <th className="px-2 py-3 text-center text-xs font-bold text-green-600 uppercase w-28 bg-green-50 sticky top-0 z-20 shadow-sm">Kobo+ Rev</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {/* Render Bundles First */}
                            {bundles.length > 0 && (
                                <tr className="bg-blue-50/50">
                                    <td colSpan={11} className="px-4 py-2 text-xs font-bold text-blue-800 uppercase tracking-wider sticky left-0 bg-blue-50 z-10">Bundles</td>
                                </tr>
                            )}
                            {bundles.map(b => (
                                <tr key={b.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-2 sticky left-0 bg-white hover:bg-gray-50 z-10 shadow-sm border-r border-gray-100">
                                        <div className="text-sm font-medium text-gray-900 truncate w-44" title={b.title}>{b.title}</div>
                                        <div className="text-xs text-gray-500">{b.includedBookIds.length} books</div>
                                    </td>
                                    <td className="px-2 py-2 bg-red-50/10"><TableCellInput bookId={b.id} field="pnrAds" metrics={metrics} pendingMetrics={pendingMetrics} selectedDate={selectedDate} onChange={handleMetricChange} /></td>
                                    <td className="px-2 py-2 bg-red-50/10"><TableCellInput bookId={b.id} field="contempAds" metrics={metrics} pendingMetrics={pendingMetrics} selectedDate={selectedDate} onChange={handleMetricChange} /></td>
                                    <td className="px-2 py-2 bg-red-50/10"><TableCellInput bookId={b.id} field="trafficAds" metrics={metrics} pendingMetrics={pendingMetrics} selectedDate={selectedDate} onChange={handleMetricChange} /></td>
                                    <td className="px-2 py-2 bg-red-50/10"><TableCellInput bookId={b.id} field="miscAds" metrics={metrics} pendingMetrics={pendingMetrics} selectedDate={selectedDate} onChange={handleMetricChange} /></td>
                                    <td className="px-2 py-2 bg-green-50/10"><TableCellInput bookId={b.id} field="amazonRev" metrics={metrics} pendingMetrics={pendingMetrics} selectedDate={selectedDate} onChange={handleMetricChange} /></td>
                                    <td className="px-2 py-2 bg-green-50/10"><TableCellInput bookId={b.id} field="shopifyRev" metrics={metrics} pendingMetrics={pendingMetrics} selectedDate={selectedDate} onChange={handleMetricChange} /></td>
                                    <td className="px-2 py-2 bg-green-50/10"><TableCellInput bookId={b.id} field="d2dRev" metrics={metrics} pendingMetrics={pendingMetrics} selectedDate={selectedDate} onChange={handleMetricChange} /></td>
                                    <td className="px-2 py-2 bg-green-50/10"><TableCellInput bookId={b.id} field="googleRev" metrics={metrics} pendingMetrics={pendingMetrics} selectedDate={selectedDate} onChange={handleMetricChange} /></td>
                                    <td className="px-2 py-2 bg-green-50/10"><TableCellInput bookId={b.id} field="koboRev" metrics={metrics} pendingMetrics={pendingMetrics} selectedDate={selectedDate} onChange={handleMetricChange} /></td>
                                    <td className="px-2 py-2 bg-green-50/10"><TableCellInput bookId={b.id} field="koboPlusRev" metrics={metrics} pendingMetrics={pendingMetrics} selectedDate={selectedDate} onChange={handleMetricChange} /></td>
                                </tr>
                            ))}

                            <tr className="bg-gray-50/50">
                                <td colSpan={11} className="px-4 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider mt-4 sticky left-0 bg-gray-50 z-10">Individual Books</td>
                            </tr>
                            {/* Render Root Books (Hierarchical) */}
                            {rootBooks.map(b => (
                                <BookRow 
                                  key={b.id} 
                                  book={b} 
                                  allBooks={books}
                                  metrics={metrics}
                                  pendingMetrics={pendingMetrics}
                                  selectedDate={selectedDate}
                                  onMetricChange={handleMetricChange}
                                  expandedParents={expandedParents}
                                  onToggleExpand={toggleParentExpand}
                                />
                            ))}
                        </tbody>
                    </table>
                 </div>
             )}
          </div>
      )}

      {/* --- STATS VIEW --- */}
      {activeTab === 'stats' && (
          <div className="space-y-6">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                      <div className="flex-1">
                          <h3 className="text-lg font-bold text-gray-900">Profitability Analysis</h3>
                          <p className="text-sm text-gray-500">Analyze performance by Product or view the aggregated Summary Table.</p>
                      </div>
                      <div className="flex gap-4">
                           <select 
                             value={selectedAnalysisId}
                             onChange={(e) => setSelectedAnalysisId(e.target.value)}
                             className="border border-gray-300 rounded-md px-3 py-1.5 text-sm min-w-[200px]"
                           >
                              <option value="">-- View Summary Table --</option>
                              <optgroup label="Bundles (Raw Data)">
                                  {bundles.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                              </optgroup>
                              <optgroup label="Individual Books">
                                  {rootBooks.map(b => {
                                      const children = getTranslations(b.id);
                                      return (
                                        <React.Fragment key={b.id}>
                                            <option value={b.id}>{b.title}</option>
                                            {children.map(c => (
                                                <option key={c.id} value={c.id}>&nbsp;&nbsp;&nbsp;↳ {c.title}</option>
                                            ))}
                                        </React.Fragment>
                                      );
                                  })}
                              </optgroup>
                           </select>

                           <select 
                             value={dateRange}
                             onChange={(e) => setDateRange(e.target.value as any)}
                             className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                           >
                              <option value="7d">Last 7 Days</option>
                              <option value="30d">Last 30 Days</option>
                              <option value="90d">Last 90 Days</option>
                              <option value="all">All Time</option>
                           </select>
                      </div>
                  </div>

                  {/* DETAIL VIEW: If a specific product is selected */}
                  {selectedAnalysisId ? (
                      <div className="space-y-8">
                          {/* Chart */}
                          <div className="h-80 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={dailyTrendData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                        <XAxis 
                                            dataKey="date" 
                                            stroke="#9CA3AF" 
                                            fontSize={12} 
                                            tickLine={false} 
                                            axisLine={false} 
                                            tickFormatter={(val) => new Date(val).toLocaleDateString(undefined, {month:'short', day:'numeric'})}
                                        />
                                        <YAxis yAxisId="left" stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `$${val}`} />
                                        <YAxis yAxisId="right" orientation="right" stroke="#60A5FA" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `${val}x`} />
                                        <Tooltip 
                                            labelFormatter={(label) => new Date(label).toLocaleDateString(undefined, {weekday:'short', year:'numeric', month:'short', day:'numeric'})}
                                            formatter={(value: number, name: string) => {
                                                if (name === 'ROAS') return [`${value.toFixed(2)}x`, name];
                                                return [formatCurrency(value), name];
                                            }}
                                        />
                                        <Legend />
                                        <Bar yAxisId="left" dataKey="revenue" name="Revenue" fill="#10B981" barSize={20} radius={[4,4,0,0]} />
                                        <Bar yAxisId="left" dataKey="spend" name="Spend" fill="#EF4444" barSize={20} radius={[4,4,0,0]} />
                                        <Line yAxisId="right" type="monotone" dataKey="roas" name="ROAS" stroke="#2563EB" strokeWidth={2} dot={{r:3}} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                          </div>
                          
                          {/* Breakdown Table */}
                          <div>
                              <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3">Daily Breakdown</h4>
                              <div className="overflow-x-auto border rounded-lg">
                                  <table className="min-w-full divide-y divide-gray-200">
                                      <thead className="bg-gray-50">
                                          <tr>
                                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                                              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Spend</th>
                                              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Revenue</th>
                                              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Profit</th>
                                              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">ROAS</th>
                                          </tr>
                                      </thead>
                                      <tbody className="bg-white divide-y divide-gray-200">
                                          {[...dailyTrendData].reverse().map(row => (
                                              <tr key={row.date} className="hover:bg-gray-50">
                                                  <td className="px-6 py-3 text-sm text-gray-900 font-medium">
                                                      {new Date(row.date).toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric'})}
                                                  </td>
                                                  <td className="px-6 py-3 text-sm text-right text-red-600">{formatCurrency(row.spend)}</td>
                                                  <td className="px-6 py-3 text-sm text-right text-gray-900">{formatCurrency(row.revenue)}</td>
                                                  <td className={`px-6 py-3 text-sm text-right font-bold ${row.profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                                      {formatCurrency(row.profit)}
                                                  </td>
                                                  <td className="px-6 py-3 text-sm text-right text-blue-600 font-medium">
                                                      {row.roas.toFixed(2)}x
                                                  </td>
                                              </tr>
                                          ))}
                                          {dailyTrendData.length === 0 && (
                                              <tr><td colSpan={5} className="p-8 text-center text-gray-500">No data for this period.</td></tr>
                                          )}
                                      </tbody>
                                  </table>
                              </div>
                          </div>
                      </div>
                  ) : (
                      /* SUMMARY TABLE VIEW (Legacy View) */
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Revenue</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Spend</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Net Profit</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">ROAS</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {aggregatedStats.filter(s => !s.isBundle).map(stat => (
                                    <tr key={stat.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{stat.name}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{formatCurrency(stat.revenue)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-600">{formatCurrency(stat.spend)}</td>
                                        <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-bold ${stat.profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                            {formatCurrency(stat.profit)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-blue-600">
                                            {stat.roas.toFixed(2)}x
                                        </td>
                                    </tr>
                                ))}
                                {aggregatedStats.filter(s => !s.isBundle).length === 0 && (
                                    <tr><td colSpan={5} className="p-8 text-center text-gray-500">No data available for this period.</td></tr>
                                )}
                            </tbody>
                        </table>
                        <p className="mt-4 text-xs text-gray-500 bg-blue-50 p-3 rounded-md">
                            * Note: Bundle revenue and ad spend entered in the Daily Entry tab is automatically split evenly and added to the individual books in this table.
                        </p>
                      </div>
                  )}
              </div>
          </div>
      )}

      {/* --- MANAGE VIEW --- */}
      {activeTab === 'manage' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
             {/* Form */}
             <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-fit">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Add Product</h3>
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                        <input 
                            type="text" 
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                            placeholder="e.g. Dark Desires"
                        />
                    </div>
                    
                    {!isBundle && (
                        <>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Series (Optional)</label>
                                <input 
                                    type="text" 
                                    value={newSeries}
                                    onChange={(e) => setNewSeries(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                                    placeholder="e.g. The Vampire War"
                                />
                            </div>

                            <div className="pt-2">
                                <div className="flex items-center space-x-2 mb-2">
                                    <input 
                                        type="checkbox" 
                                        id="isTranslation"
                                        checked={isTranslation}
                                        onChange={(e) => setIsTranslation(e.target.checked)}
                                        className="w-4 h-4 text-blue-600 rounded"
                                    />
                                    <label htmlFor="isTranslation" className="text-sm text-gray-900 font-medium">Is this a Translation?</label>
                                </div>
                                
                                {isTranslation && (
                                    <div className="bg-blue-50 p-3 rounded-md space-y-3 border border-blue-100 animate-fade-in">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Original Book</label>
                                            <select
                                                value={selectedParentId}
                                                onChange={(e) => setSelectedParentId(e.target.value)}
                                                className="w-full px-3 py-2 border border-blue-200 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
                                            >
                                                <option value="">-- Select Original --</option>
                                                {rootBooks.map(b => (
                                                    <option key={b.id} value={b.id}>{b.title}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Language</label>
                                            <input 
                                                type="text"
                                                value={translationLanguage}
                                                onChange={(e) => setTranslationLanguage(e.target.value)}
                                                placeholder="e.g. German"
                                                className="w-full px-3 py-2 border border-blue-200 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {!isTranslation && (
                        <div className="flex items-center space-x-2 py-2">
                            <input 
                                type="checkbox" 
                                id="isBundle" 
                                checked={isBundle} 
                                onChange={(e) => setIsBundle(e.target.checked)}
                                className="w-4 h-4 text-blue-600 rounded"
                            />
                            <label htmlFor="isBundle" className="text-sm text-gray-900 font-medium">This is a Bundle</label>
                        </div>
                    )}

                    {isBundle && (
                        <div className="bg-gray-50 p-3 rounded-md border border-gray-200">
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Select Books in Bundle</label>
                            <div className="max-h-40 overflow-y-auto space-y-1">
                                {singleBooks.length === 0 && <p className="text-sm text-gray-400">Add individual books first.</p>}
                                {singleBooks.map(b => (
                                    <div key={b.id} className="flex items-center space-x-2">
                                        <input 
                                            type="checkbox" 
                                            checked={selectedBooksForBundle.has(b.id)}
                                            onChange={() => toggleBookInBundle(b.id)}
                                            className="rounded text-blue-600"
                                        />
                                        <span className="text-sm text-gray-700">{b.title}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <button 
                        onClick={handleAddProduct}
                        disabled={!newTitle || (isBundle && selectedBooksForBundle.size === 0) || (isTranslation && (!selectedParentId || !translationLanguage))}
                        className="w-full flex justify-center items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        Create {isBundle ? 'Bundle' : (isTranslation ? 'Translation' : 'Book')}
                    </button>
                </div>
             </div>

             {/* List */}
             <div className="lg:col-span-2 space-y-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                    <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
                        <Book className="w-5 h-5 mr-2 text-indigo-500" />
                        Individual Books
                    </h3>
                    {rootBooks.length === 0 && <p className="text-gray-500 italic">No books added yet.</p>}
                    <div className="space-y-3">
                        {rootBooks.map(b => {
                            const children = getTranslations(b.id);
                            return (
                                <div key={b.id} className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
                                    <div className="flex justify-between items-center p-3">
                                        <div>
                                            <p className="font-medium text-gray-900">{b.title}</p>
                                            <p className="text-xs text-gray-500">{b.series}</p>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            {children.length > 0 && <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded-full">{children.length} Translations</span>}
                                            <button onClick={() => handleDeleteBook(b.id)} className="text-gray-400 hover:text-red-500 p-1"><Trash2 className="w-4 h-4" /></button>
                                        </div>
                                    </div>
                                    {children.length > 0 && (
                                        <div className="bg-gray-100/50 border-t border-gray-200 p-2 space-y-1">
                                            {children.map(child => (
                                                <div key={child.id} className="flex justify-between items-center pl-4 pr-2 py-1.5 rounded hover:bg-white/50">
                                                    <div className="flex items-center text-sm text-gray-600">
                                                        <CornerDownRight className="w-3 h-3 text-gray-400 mr-2" />
                                                        <span>{child.title}</span>
                                                        <span className="ml-2 text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">{child.language}</span>
                                                    </div>
                                                    <button onClick={() => handleDeleteBook(child.id)} className="text-gray-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                    <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
                        <Layers className="w-5 h-5 mr-2 text-purple-500" />
                        Bundles
                    </h3>
                    {bundles.length === 0 && <p className="text-gray-500 italic">No bundles added yet.</p>}
                    <div className="space-y-3">
                        {bundles.map(b => (
                            <div key={b.id} className="p-3 bg-purple-50 rounded-lg border border-purple-100">
                                <div className="flex justify-between items-start">
                                    <h4 className="font-medium text-purple-900">{b.title}</h4>
                                    <button onClick={() => handleDeleteBook(b.id)} className="text-purple-300 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                                </div>
                                <div className="mt-2 text-xs text-purple-700">
                                    <span className="font-bold">Includes:</span> {b.includedBookIds.map(id => books.find(x => x.id === id)?.title).join(', ')}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
             </div>
          </div>
      )}
    </div>
  );
};

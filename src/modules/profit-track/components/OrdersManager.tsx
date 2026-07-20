
import React, { useState, useEffect, useMemo } from 'react';
import { OrderSource, MonthlyOrderEntry, MonthlyPageReads } from '../types';
import { Plus, Trash2, Save, BookOpen, Settings, AlertCircle, CheckCircle, Archive, RotateCcw, BarChart2 } from 'lucide-react';
import { formatNumber } from '../utils/calculations';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface OrdersManagerProps {
  sources: OrderSource[];
  onUpdateSources: (sources: OrderSource[]) => void;
  monthlyOrders: MonthlyOrderEntry[];
  onUpdateOrders: (orders: MonthlyOrderEntry[]) => void;
  monthlyPageReads: MonthlyPageReads[];
  onUpdatePageReads: (reads: MonthlyPageReads[]) => void;
}

export const OrdersManager: React.FC<OrdersManagerProps> = ({
  sources,
  onUpdateSources,
  monthlyOrders,
  onUpdateOrders,
  monthlyPageReads,
  onUpdatePageReads
}) => {
  const [activeTab, setActiveTab] = useState<'entry' | 'stats' | 'config'>('entry');
  const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().substring(0, 7)); // YYYY-MM
  
  // Local state for edits before saving
  const [pendingOrders, setPendingOrders] = useState<MonthlyOrderEntry[]>(monthlyOrders);
  const [pendingReads, setPendingReads] = useState<MonthlyPageReads[]>(monthlyPageReads);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  // Stats State
  const [statsYear, setStatsYear] = useState<string>('All');

  useEffect(() => {
    setPendingOrders(monthlyOrders);
    setPendingReads(monthlyPageReads);
    setHasUnsavedChanges(false);
  }, [monthlyOrders, monthlyPageReads]);

  // -- Config Logic --
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceMultiplier, setNewSourceMultiplier] = useState(1);

  const handleAddSource = () => {
    if (!newSourceName.trim()) return;
    const newSource: OrderSource = {
      id: crypto.randomUUID(),
      name: newSourceName,
      multiplier: newSourceMultiplier,
      isArchived: false
    };
    onUpdateSources([...sources, newSource]);
    setNewSourceName('');
    setNewSourceMultiplier(1);
  };

  const handleArchiveSource = (id: string) => {
    // Soft delete: Mark as archived
    if (confirm('Archive this source? It will be hidden from new entries but kept in historical reports.')) {
        onUpdateSources(sources.map(s => s.id === id ? { ...s, isArchived: true } : s));
    }
  };

  const handleUnarchiveSource = (id: string) => {
    onUpdateSources(sources.map(s => s.id === id ? { ...s, isArchived: false } : s));
  };

  const handleDeleteSource = (id: string) => {
      // Hard delete: Only allowed if no data exists or user confirms extreme danger
      const hasData = monthlyOrders.some(o => o.sourceId === id);
      if (hasData) {
          alert('Cannot delete: This source has existing sales data. Please Archive it instead to preserve your history.');
          return;
      }
      if (confirm('Permanently delete this source?')) {
          onUpdateSources(sources.filter(s => s.id !== id));
      }
  };

  const handleUpdateSource = (id: string, field: 'name' | 'multiplier', value: any) => {
    onUpdateSources(sources.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  // -- Data Entry Logic --
  const getOrderValue = (sourceId: string) => {
    return pendingOrders.find(o => o.monthKey === selectedMonth && o.sourceId === sourceId)?.count || '';
  };

  const getPageReadsValue = () => {
    return pendingReads.find(p => p.monthKey === selectedMonth)?.reads || '';
  };

  const handleOrderChange = (sourceId: string, val: string) => {
    const numVal = val === '' ? 0 : parseInt(val);
    const existingIndex = pendingOrders.findIndex(o => o.monthKey === selectedMonth && o.sourceId === sourceId);
    
    let newOrders = [...pendingOrders];
    if (existingIndex >= 0) {
      if (val === '') {
          newOrders.splice(existingIndex, 1);
      } else {
          // Keep existing properties (including snapshotMultiplier)
          newOrders[existingIndex] = { ...newOrders[existingIndex], count: numVal };
      }
    } else if (val !== '') {
      // New entries don't have snapshotMultiplier yet, will be added on save
      newOrders.push({ monthKey: selectedMonth, sourceId, count: numVal });
    }
    setPendingOrders(newOrders);
    setHasUnsavedChanges(true);
    setSaveMessage('');
  };

  const handlePageReadsChange = (val: string) => {
    const numVal = val === '' ? 0 : parseInt(val);
    const existingIndex = pendingReads.findIndex(p => p.monthKey === selectedMonth);

    let newReads = [...pendingReads];
    if (existingIndex >= 0) {
       if (val === '') {
           newReads.splice(existingIndex, 1);
       } else {
           newReads[existingIndex] = { ...newReads[existingIndex], reads: numVal };
       }
    } else if (val !== '') {
       newReads.push({ monthKey: selectedMonth, reads: numVal });
    }
    setPendingReads(newReads);
    setHasUnsavedChanges(true);
    setSaveMessage('');
  };

  const handleSave = () => {
    const processedOrders = pendingOrders.map(order => {
        if (order.snapshotMultiplier !== undefined) {
            return order;
        }
        const source = sources.find(s => s.id === order.sourceId);
        return {
            ...order,
            snapshotMultiplier: source?.multiplier || 1
        };
    });

    onUpdateOrders(processedOrders);
    onUpdatePageReads(pendingReads);
    setHasUnsavedChanges(false);
    setSaveMessage('Changes saved successfully!');
    setTimeout(() => setSaveMessage(''), 3000);
  };

  // -- Statistics Logic --
  const statsData = useMemo(() => {
    const data: Record<string, { name: string, totalUnits: number, rawCount: number }> = {};
    
    // Initialize all sources (even archived ones if they have data)
    sources.forEach(s => {
        data[s.id] = { name: s.name, totalUnits: 0, rawCount: 0 };
    });

    monthlyOrders.forEach(entry => {
        // Filter by year if needed
        if (statsYear !== 'All' && !entry.monthKey.startsWith(statsYear)) return;

        if (data[entry.sourceId]) {
            // Use snapshot if available
            const mult = entry.snapshotMultiplier !== undefined 
                ? entry.snapshotMultiplier 
                : (sources.find(s => s.id === entry.sourceId)?.multiplier || 1);
            
            data[entry.sourceId].rawCount += entry.count;
            data[entry.sourceId].totalUnits += (entry.count * mult);
        }
    });

    return Object.values(data)
        .filter(d => d.totalUnits > 0)
        .sort((a,b) => b.totalUnits - a.totalUnits);
  }, [monthlyOrders, sources, statsYear]);

  const years = useMemo(() => {
      const y = new Set(monthlyOrders.map(o => o.monthKey.substring(0, 4)));
      return Array.from(y).sort().reverse();
  }, [monthlyOrders]);

  // -- Render Helpers --
  const currentTotalUnits = sources.reduce((acc, source) => {
    const order = pendingOrders.find(o => o.monthKey === selectedMonth && o.sourceId === source.id);
    if (!order) return acc;
    const mult = order.snapshotMultiplier !== undefined ? order.snapshotMultiplier : source.multiplier;
    return acc + (order.count * mult);
  }, 0);

  // Filter sources for Entry view: Show if NOT archived OR if it has a value for selected month
  const visibleSourcesForEntry = sources.filter(s => {
      if (!s.isArchived) return true;
      const hasValue = pendingOrders.some(o => o.monthKey === selectedMonth && o.sourceId === s.id && o.count > 0);
      return hasValue;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Tabs */}
      <div className="flex flex-wrap gap-4 mb-6">
        <button 
          onClick={() => setActiveTab('entry')}
          className={`flex items-center px-4 py-2 rounded-control font-medium transition-colors ${activeTab === 'entry' ? 'bg-brand-600 text-brand-fg shadow-sm' : 'bg-surface text-content-secondary hover:bg-surface-hover'}`}
        >
          <BookOpen className="w-4 h-4 mr-2" />
          Monthly Entry
        </button>
        <button 
          onClick={() => setActiveTab('stats')}
          className={`flex items-center px-4 py-2 rounded-control font-medium transition-colors ${activeTab === 'stats' ? 'bg-brand-600 text-brand-fg shadow-sm' : 'bg-surface text-content-secondary hover:bg-surface-hover'}`}
        >
          <BarChart2 className="w-4 h-4 mr-2" />
          Statistics & Breakdown
        </button>
        <button 
          onClick={() => setActiveTab('config')}
          className={`flex items-center px-4 py-2 rounded-control font-medium transition-colors ${activeTab === 'config' ? 'bg-brand-600 text-brand-fg shadow-sm' : 'bg-surface text-content-secondary hover:bg-surface-hover'}`}
        >
          <Settings className="w-4 h-4 mr-2" />
          Manage Bundles & Sources
        </button>
      </div>

      {/* --- CONFIG TAB --- */}
      {activeTab === 'config' && (
        <div className="bg-surface p-6 rounded-card shadow-sm border border-edge-soft">
          <h2 className="text-lg font-bold text-content mb-4">Order Sources & Multipliers</h2>
          <p className="text-sm text-content-secondary mb-6">
            Manage your retailers and bundles. 
            <br/><span className="text-brand-600 font-medium">Tip: Archive old bundles instead of deleting them to preserve your historical reports.</span>
          </p>
          
          <div className="space-y-4">
             {/* Active Sources */}
             {sources.filter(s => !s.isArchived).map(source => (
               <div key={source.id} className="flex items-center space-x-4 p-3 bg-surface-hover rounded-control border border-edge-soft">
                 <input 
                    type="text" 
                    value={source.name}
                    onChange={(e) => handleUpdateSource(source.id, 'name', e.target.value)}
                    className="flex-1 px-3 py-2 border border-edge-strong rounded-control text-sm focus:ring-2 focus:ring-brand-500"
                 />
                 <div className="flex items-center space-x-2">
                    <span className="text-xs text-content-secondary font-medium">Multiplier:</span>
                    <input 
                        type="number" 
                        min="1"
                        step="1"
                        value={source.multiplier}
                        onChange={(e) => handleUpdateSource(source.id, 'multiplier', parseFloat(e.target.value))}
                        className="w-20 px-3 py-2 border border-edge-strong rounded-control text-sm focus:ring-2 focus:ring-brand-500"
                    />
                 </div>
                 
                 {!source.isSystem && (
                     <button 
                        onClick={() => handleArchiveSource(source.id)}
                        className="flex items-center px-3 py-2 text-amber-600 bg-amber-50 hover:bg-amber-100 rounded-control transition-colors text-xs font-medium"
                        title="Archive Source"
                     >
                        <Archive className="w-3.5 h-3.5 mr-1" />
                        Archive
                     </button>
                 )}
               </div>
             ))}

             {/* Add New Source */}
             <div className="flex items-center space-x-4 p-3 border-2 border-dashed border-edge rounded-control bg-surface-hover/50 mt-4">
                <input 
                    type="text" 
                    placeholder="New Source Name (e.g. My New Bundle)"
                    value={newSourceName}
                    onChange={(e) => setNewSourceName(e.target.value)}
                    className="flex-1 px-3 py-2 border border-edge-strong rounded-control text-sm focus:ring-2 focus:ring-brand-500"
                 />
                 <div className="flex items-center space-x-2">
                    <span className="text-xs text-content-secondary font-medium">Multiplier:</span>
                    <input 
                        type="number" 
                        min="1"
                        value={newSourceMultiplier}
                        onChange={(e) => setNewSourceMultiplier(parseFloat(e.target.value))}
                        className="w-20 px-3 py-2 border border-edge-strong rounded-control text-sm focus:ring-2 focus:ring-brand-500"
                    />
                 </div>
                 <button 
                    onClick={handleAddSource}
                    disabled={!newSourceName}
                    className="flex items-center px-4 py-2 bg-brand-600 text-brand-fg rounded-control text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                 >
                    <Plus className="w-4 h-4 mr-1" />
                    Add
                 </button>
             </div>

             {/* Archived Sources Section */}
             {sources.some(s => s.isArchived) && (
                 <div className="mt-8 pt-6 border-t border-edge-soft">
                     <h3 className="text-sm font-bold text-content-secondary uppercase tracking-wider mb-4 flex items-center">
                         <Archive className="w-4 h-4 mr-2" />
                         Archived Sources
                     </h3>
                     <div className="space-y-2 opacity-75">
                         {sources.filter(s => s.isArchived).map(source => (
                             <div key={source.id} className="flex items-center justify-between p-3 bg-surface-sunken rounded-control border border-edge">
                                 <span className="text-sm text-content-secondary line-through">{source.name}</span>
                                 <div className="flex items-center space-x-3">
                                     <button 
                                        onClick={() => handleUnarchiveSource(source.id)}
                                        className="text-brand-600 hover:text-brand-800 text-xs font-medium flex items-center"
                                     >
                                        <RotateCcw className="w-3 h-3 mr-1" /> Restore
                                     </button>
                                     <button 
                                        onClick={() => handleDeleteSource(source.id)}
                                        className="text-content-muted hover:text-red-600"
                                        title="Permanently Delete"
                                     >
                                        <Trash2 className="w-4 h-4" />
                                     </button>
                                 </div>
                             </div>
                         ))}
                     </div>
                 </div>
             )}
          </div>
        </div>
      )}

      {/* --- STATS TAB --- */}
      {activeTab === 'stats' && (
        <div className="space-y-6">
            <div className="bg-surface p-6 rounded-card shadow-sm border border-edge-soft flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-bold text-content">Unit Breakdown</h2>
                    <p className="text-sm text-content-secondary">Total units sold per retailer/bundle for the selected period.</p>
                </div>
                <select 
                    value={statsYear}
                    onChange={(e) => setStatsYear(e.target.value)}
                    className="border border-edge-strong rounded-control px-4 py-2 text-sm font-medium"
                >
                    <option value="All">All Time</option>
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Chart */}
                <div className="lg:col-span-3 bg-surface p-6 rounded-card shadow-sm border border-edge-soft h-80">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={statsData.slice(0, 10)} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                            <XAxis type="number" hide />
                            <YAxis dataKey="name" type="category" width={150} tick={{fontSize: 12}} />
                            <Tooltip formatter={(val) => formatNumber(val as number)} />
                            <Bar dataKey="totalUnits" fill="#3B82F6" radius={[0, 4, 4, 0]} barSize={20}>
                                {statsData.slice(0, 10).map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#3B82F6' : '#60A5FA'} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Detailed Table */}
                <div className="lg:col-span-3 bg-surface rounded-card shadow-sm border border-edge-soft overflow-hidden">
                    <table className="min-w-full divide-y divide-edge">
                        <thead className="bg-surface-hover">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-content-secondary uppercase tracking-wider">Source Name</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-content-secondary uppercase tracking-wider">Raw Count (Orders)</th>
                                <th className="px-6 py-3 text-right text-xs font-bold text-content uppercase tracking-wider">Total Units (w/ Multiplier)</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-content-secondary uppercase tracking-wider">% of Volume</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-edge bg-surface">
                            {statsData.map((row) => {
                                const totalVolume = statsData.reduce((acc, curr) => acc + curr.totalUnits, 0);
                                const percentage = totalVolume > 0 ? (row.totalUnits / totalVolume) * 100 : 0;
                                return (
                                    <tr key={row.name} className="hover:bg-surface-hover">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-content">{row.name}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-content-secondary">{formatNumber(row.rawCount)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-brand-600 bg-brand-50/30">{formatNumber(row.totalUnits)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-content-secondary">{percentage.toFixed(1)}%</td>
                                    </tr>
                                );
                            })}
                            {statsData.length === 0 && (
                                <tr><td colSpan={4} className="p-8 text-center text-content-secondary">No data available for {statsYear}.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
      )}

      {/* --- ENTRY TAB --- */}
      {activeTab === 'entry' && (
        <div className="bg-surface p-8 rounded-card shadow-sm border border-edge-soft relative">
           {/* Header with Save Controls */}
           <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 pb-6 border-b border-edge-soft">
              <div className="flex items-center space-x-6">
                 <div>
                    <label className="block text-xs font-bold text-content-secondary uppercase tracking-wider mb-1">Select Month</label>
                    <input 
                        type="month" 
                        value={selectedMonth}
                        onChange={(e) => setSelectedMonth(e.target.value)}
                        className="px-4 py-2 border border-edge-strong rounded-control shadow-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 font-medium text-content"
                    />
                 </div>
                 {hasUnsavedChanges && (
                    <div className="flex items-center text-amber-600 bg-amber-50 px-3 py-1 rounded-control text-sm animate-pulse">
                        <AlertCircle className="w-4 h-4 mr-2" />
                        Unsaved Changes
                    </div>
                 )}
                 {saveMessage && (
                    <div className="flex items-center text-green-600 bg-green-50 px-3 py-1 rounded-control text-sm">
                        <CheckCircle className="w-4 h-4 mr-2" />
                        {saveMessage}
                    </div>
                 )}
              </div>
              
              <div className="mt-4 md:mt-0 flex items-center space-x-6">
                <div className="text-right hidden sm:block">
                    <p className="text-xs text-content-secondary">Total Units Sold (Pending)</p>
                    <p className="text-2xl font-bold text-content">{formatNumber(currentTotalUnits)}</p>
                </div>
                <button 
                    onClick={handleSave}
                    disabled={!hasUnsavedChanges}
                    className={`flex items-center px-6 py-3 rounded-control font-bold shadow-md transition-all ${
                        hasUnsavedChanges 
                        ? 'bg-brand-600 text-brand-fg hover:bg-brand-700 hover:shadow-lg transform hover:-translate-y-0.5' 
                        : 'bg-surface-sunken text-content-muted cursor-not-allowed'
                    }`}
                >
                    <Save className="w-5 h-5 mr-2" />
                    Save Changes
                </button>
              </div>
           </div>

           <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Left Column: Page Reads */}
              <div>
                <h3 className="text-lg font-bold text-content mb-4 flex items-center">
                    <BookOpen className="w-5 h-5 mr-2 text-brand-500" />
                    Page Reads
                </h3>
                <div className="bg-brand-50 p-4 rounded-control border border-brand-100 transition-colors focus-within:bg-surface focus-within:ring-2 focus-within:ring-brand-500">
                    <label className="block text-sm font-medium text-brand-900 mb-2">Total Page Reads</label>
                    <input 
                        type="number"
                        placeholder="0"
                        value={getPageReadsValue()}
                        onChange={(e) => handlePageReadsChange(e.target.value)}
                        className={`w-full px-4 py-3 border rounded-control text-lg font-semibold transition-colors ${hasUnsavedChanges ? 'bg-yellow-50 border-yellow-300 text-content' : 'bg-surface border-brand-200 text-content'}`}
                    />
                    <p className="text-xs text-brand-600 mt-2">Enter total KENP reads for this month.</p>
                </div>
              </div>

              {/* Right Column: Order Sources */}
              <div>
                <h3 className="text-lg font-bold text-content mb-4">Orders by Source</h3>
                <div className="space-y-4">
                    {visibleSourcesForEntry.map(source => {
                        const val = getOrderValue(source.id);
                        return (
                            <div key={source.id} className="flex items-center justify-between group">
                                <label className={`text-sm font-medium flex-1 mr-4 transition-colors ${source.isArchived ? 'text-content-muted italic' : 'text-content group-hover:text-brand-600'}`}>
                                    {source.name} 
                                    {source.isArchived && <span className="ml-2 text-xs bg-edge text-content-secondary px-2 py-0.5 rounded-full">Archived</span>}
                                    {source.multiplier > 1 && !source.isArchived && <span className="ml-2 text-xs bg-brand-100 text-brand-800 px-2 py-0.5 rounded-full">x{source.multiplier} units</span>}
                                </label>
                                <input 
                                    type="number"
                                    placeholder="0"
                                    value={val}
                                    onChange={(e) => handleOrderChange(source.id, e.target.value)}
                                    className={`w-32 px-3 py-2 border rounded-control text-right font-medium transition-all ${
                                        hasUnsavedChanges 
                                        ? 'focus:ring-yellow-400 border-edge-strong focus:bg-yellow-50' 
                                        : 'focus:ring-brand-500 border-edge-strong'
                                    }`}
                                />
                            </div>
                        );
                    })}
                    {sources.length === 0 && (
                        <p className="text-sm text-content-muted italic">No sources configured. Go to "Manage Bundles" to add sources.</p>
                    )}
                    {visibleSourcesForEntry.length === 0 && sources.length > 0 && (
                        <p className="text-sm text-content-muted italic text-center py-4">All sources are archived. Unarchive them in "Manage Bundles" to add data.</p>
                    )}
                </div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

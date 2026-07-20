import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  PlusCircle,
  Table,
  Calendar,
  TrendingUp,
  BookOpen,
  Settings as SettingsIcon,
  Library,
} from 'lucide-react';
import { Dashboard } from './components/Dashboard';
import { DataEntry } from './components/DataEntry';
import { DataTable } from './components/DataTable';
import { WeeklySummary } from './components/WeeklySummary';
import { Reports } from './components/Reports';
import { OrdersManager } from './components/OrdersManager';
import { Settings } from './components/Settings';
import { BookTracker } from './components/BookTracker';
import { useProfitData } from './hooks/useProfitData';
import type {
  DailyRecord,
  ViewMode,
  AppDataBackup,
  BookDailyMetric,
  OrderSource,
} from './types';

const VIEW_TITLES: Record<ViewMode, { title: string; subtitle: string }> = {
  dashboard: {
    title: 'Financial Overview',
    subtitle: 'Track your ad performance and revenue in real-time.',
  },
  weekly: {
    title: 'Weekly Summary',
    subtitle: 'Review performance week by week with custom notes.',
  },
  books: {
    title: 'Book Profitability Tracker',
    subtitle: 'Track per-book ROAS with automatic bundle splitting.',
  },
  reports: {
    title: 'Performance Reports',
    subtitle: 'Analyze monthly trends and year-over-year growth.',
  },
  orders: {
    title: 'Orders & Page Reads',
    subtitle: 'Track monthly unit sales across sources and page reads.',
  },
  entry: {
    title: 'Data Management',
    subtitle: 'Import your data or add daily metrics.',
  },
  data: {
    title: 'Raw Data Logs',
    subtitle: 'View and manage individual daily entries.',
  },
  settings: {
    title: 'System Settings',
    subtitle: 'Backup and restore your Profit data.',
  },
};

export default function ProfitTrackModule() {
  const {
    loading,
    dailyRecords,
    weeklyNotes,
    orderSources,
    monthlyOrders,
    monthlyPageReads,
    books,
    bookMetrics,
    categories,
    uiPrefs,
    setDailyRecords,
    setWeeklyNotes,
    setOrderSources,
    setMonthlyOrders,
    setMonthlyPageReads,
    setBooks,
    setBookMetrics,
    setCategories,
    setUIPrefs,
    clearAll,
  } = useProfitData();

  const [view, setView] = useState<ViewMode>('dashboard');
  const [editingRecord, setEditingRecord] = useState<DailyRecord | null>(null);

  // One-time migration: lock in historical multipliers for orders
  useEffect(() => {
    if (loading) return;
    const needsMigration = monthlyOrders.some(
      (o) => o.snapshotMultiplier === undefined,
    );
    if (!needsMigration) return;
    const migrated = monthlyOrders.map((order) => {
      if (order.snapshotMultiplier !== undefined) return order;
      const source = orderSources.find((s) => s.id === order.sourceId);
      return source
        ? { ...order, snapshotMultiplier: source.multiplier }
        : order;
    });
    setMonthlyOrders(migrated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Bundle-as-source sync: every bundle book should have a matching order
  // source so the user can enter monthly units sold for it. Early backups
  // (and imports from them) didn't serialize bundle sources, so we derive
  // them on load. Multiplier defaults to the number of books in the bundle.
  useEffect(() => {
    if (loading) return;
    const existingNames = new Set(orderSources.map((s) => s.name));
    const missing = books.filter(
      (b) => b.isBundle && !existingNames.has(b.title),
    );
    if (missing.length === 0) return;
    const additions: OrderSource[] = missing.map((b) => ({
      id: crypto.randomUUID(),
      name: b.title,
      multiplier: (b.includedBookIds || []).length || 1,
      isSystem: false,
      isArchived: false,
    }));
    setOrderSources([...orderSources, ...additions]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, books]);

  const handleAddRecord = (record: DailyRecord) => {
    setDailyRecords((prev) => [...prev, record]);
  };

  const handleBulkAdd = (records: DailyRecord[]) => {
    setDailyRecords((prev) => [...prev, ...records]);
    setView('dashboard');
  };

  const handleBulkMerge = (records: Partial<DailyRecord>[]) => {
    setDailyRecords((prev) => {
      const next = [...prev];
      records.forEach((record) => {
        if (!record.date) return;
        const existingIndex = next.findIndex((r) => r.date === record.date);
        if (existingIndex >= 0) {
          // Deep-merge customAmounts so multiple CSV imports into different
          // custom categories on the same date accumulate instead of clobber.
          const mergedCustom = {
            ...(next[existingIndex].customAmounts || {}),
            ...(record.customAmounts || {}),
          };
          next[existingIndex] = {
            ...next[existingIndex],
            ...record,
            customAmounts: mergedCustom,
            id: next[existingIndex].id,
          };
        } else {
          next.push({
            id: crypto.randomUUID(),
            date: record.date,
            pnrAds: 0,
            contempAds: 0,
            trafficAds: 0,
            miscAds: 0,
            shopifyRev: 0,
            amazonRev: 0,
            d2dRev: 0,
            googleRev: 0,
            koboRev: 0,
            koboPlusRev: 0,
            customAmounts: {},
            ...record,
          } as DailyRecord);
        }
      });
      return next;
    });
    setView('dashboard');
  };

  const handleDelete = (id: string) => {
    if (!confirm('Are you sure you want to delete this record?')) return;
    setDailyRecords((prev) => prev.filter((r) => r.id !== id));
  };

  const handleEditRecord = (record: DailyRecord) => {
    setEditingRecord(record);
    setView('entry');
  };

  const handleUpdateRecord = (updated: DailyRecord) => {
    setDailyRecords((prev) =>
      prev.map((r) => (r.id === updated.id ? updated : r)),
    );
    setEditingRecord(null);
  };

  const handleCancelEdit = () => {
    setEditingRecord(null);
    setView('data');
  };

  const handleUpdateNote = (weekStartDate: string, content: string) => {
    setWeeklyNotes((prev) => {
      const existing = prev.find((n) => n.weekStartDate === weekStartDate);
      if (existing) {
        return prev.map((n) =>
          n.weekStartDate === weekStartDate ? { ...n, content } : n,
        );
      }
      return [...prev, { weekStartDate, content }];
    });
  };

  const handleSyncBookMetrics = (
    date: string,
    totals: Pick<
      BookDailyMetric,
      | 'pnrAds'
      | 'contempAds'
      | 'trafficAds'
      | 'miscAds'
      | 'amazonRev'
      | 'shopifyRev'
      | 'd2dRev'
      | 'googleRev'
      | 'koboRev'
      | 'koboPlusRev'
    >,
  ) => {
    setDailyRecords((prev) => {
      const idx = prev.findIndex((r) => r.date === date);
      const base: DailyRecord =
        idx >= 0
          ? { ...prev[idx] }
          : {
              id: crypto.randomUUID(),
              date,
              pnrAds: 0,
              contempAds: 0,
              trafficAds: 0,
              miscAds: 0,
              shopifyRev: 0,
              amazonRev: 0,
              d2dRev: 0,
              googleRev: 0,
              koboRev: 0,
              koboPlusRev: 0,
            };
      const next: DailyRecord = { ...base, ...totals };
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = next;
        return copy;
      }
      return [...prev, next];
    });
  };

  const generateBackup = (): AppDataBackup => ({
    version: 2,
    dailyRecords,
    weeklyNotes,
    orderSources,
    monthlyOrders,
    monthlyPageReads,
    books,
    bookMetrics,
  });

  const restoreBackup = (backup: AppDataBackup) => {
    setDailyRecords(backup.dailyRecords || []);
    setWeeklyNotes(backup.weeklyNotes || []);
    setOrderSources(backup.orderSources || []);
    setMonthlyOrders(backup.monthlyOrders || []);
    setMonthlyPageReads(backup.monthlyPageReads || []);
    setBooks(backup.books || []);
    setBookMetrics(backup.bookMetrics || []);
  };

  const allNavItems: Array<{
    view: ViewMode;
    label: string;
    icon: typeof LayoutDashboard;
  }> = [
    { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { view: 'weekly', label: 'Weekly Summary', icon: Calendar },
    { view: 'books', label: 'Book ROI', icon: Library },
    { view: 'reports', label: 'Reports (M/Y)', icon: TrendingUp },
    { view: 'orders', label: 'Orders & Reads', icon: BookOpen },
    { view: 'entry', label: 'Add Data / Upload', icon: PlusCircle },
    { view: 'data', label: 'All Records', icon: Table },
    { view: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  const hiddenTabs = new Set(uiPrefs.hiddenProfitTabs);
  const navItems = allNavItems.filter((item) => !hiddenTabs.has(item.view));

  // If the active view got hidden via Settings, fall back to dashboard.
  useEffect(() => {
    if (hiddenTabs.has(view)) setView('dashboard');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiPrefs.hiddenProfitTabs.join(',')]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const header = VIEW_TITLES[view];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-content">{header.title}</h1>
        <p className="text-content-secondary text-sm mt-1">{header.subtitle}</p>
      </div>

      <div className="flex flex-wrap gap-1 bg-surface-sunken rounded-control p-1 mb-6 w-fit">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = view === item.view;
          return (
            <button
              key={item.view}
              onClick={() => {
                setView(item.view);
                setEditingRecord(null);
              }}
              className={`flex items-center gap-2 px-3 py-2 rounded-control text-sm font-medium transition-colors ${
                active
                  ? 'bg-surface text-content shadow-sm'
                  : 'text-content-secondary hover:text-content'
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </button>
          );
        })}
      </div>

      {view === 'dashboard' && (
        <Dashboard
          data={dailyRecords}
          monthlyOrders={monthlyOrders}
          monthlyPageReads={monthlyPageReads}
          sources={orderSources}
          categories={categories}
        />
      )}
      {view === 'weekly' && (
        <WeeklySummary
          data={dailyRecords}
          notes={weeklyNotes}
          categories={categories}
          onUpdateNote={handleUpdateNote}
        />
      )}
      {view === 'reports' && (
        <Reports
          data={dailyRecords}
          sources={orderSources}
          monthlyOrders={monthlyOrders}
          monthlyPageReads={monthlyPageReads}
          categories={categories}
        />
      )}
      {view === 'orders' && (
        <OrdersManager
          sources={orderSources}
          onUpdateSources={setOrderSources}
          monthlyOrders={monthlyOrders}
          onUpdateOrders={setMonthlyOrders}
          monthlyPageReads={monthlyPageReads}
          onUpdatePageReads={setMonthlyPageReads}
        />
      )}
      {view === 'books' && (
        <BookTracker
          books={books}
          onUpdateBooks={setBooks}
          metrics={bookMetrics}
          onUpdateMetrics={setBookMetrics}
          onSyncDailyMetrics={handleSyncBookMetrics}
        />
      )}
      {view === 'entry' && (
        <DataEntry
          existingData={dailyRecords}
          categories={categories}
          onAddRecord={handleAddRecord}
          onBulkAdd={handleBulkAdd}
          onBulkMerge={handleBulkMerge}
          editingRecord={editingRecord}
          onUpdateRecord={handleUpdateRecord}
          onCancelEdit={handleCancelEdit}
        />
      )}
      {view === 'data' && (
        <DataTable
          data={dailyRecords}
          categories={categories}
          onDelete={handleDelete}
          onEdit={handleEditRecord}
        />
      )}
      {view === 'settings' && (
        <Settings
          onBackup={generateBackup}
          onRestore={restoreBackup}
          onClear={clearAll}
          categories={categories}
          onUpdateCategories={setCategories}
          uiPrefs={uiPrefs}
          onUpdateUIPrefs={setUIPrefs}
        />
      )}
    </div>
  );
}

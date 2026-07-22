import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Loader2,
  ShieldAlert,
  CalendarRange,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getCashFlow,
  upsertCashFlowWeek,
  addCashFlowLine,
  updateCashFlowLine,
  deleteCashFlowLine,
  type CashFlowWeek,
  type CashFlowLineRow,
} from './api';

// ---------------------------------------------------------------------------
// Date + money helpers

/** Current month as YYYY-MM. */
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Shift a YYYY-MM string by n months. */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Parse a YYYY-MM-DD date string as a local Date (no TZ drift). */
function parseDate(s: string): Date {
  return new Date(`${s}T00:00:00`);
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

const MONTH_LABEL = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

const shortDate = (s: string) =>
  parseDate(s).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// Module

export default function CashFlowModule() {
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const [month, setMonth] = useState<string>(currentMonth());
  const [weeks, setWeeks] = useState<CashFlowWeek[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!userId) return;
    try {
      const data = await getCashFlow(userId, { month });
      setWeeks(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load cash flow.');
    }
  }, [userId, month]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      await refetch();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [refetch]);

  // Add the next week in the month: starts the day after the last week ends,
  // or on the first of the month for the first week. One-week (7-day) span.
  async function handleAddWeek() {
    if (!userId || busy) return;
    setBusy(true);
    try {
      const last = weeks[weeks.length - 1];
      const weekStart = last ? addDays(last.week.week_end, 1) : `${month}-01`;
      const weekEnd = addDays(weekStart, 6);
      await upsertCashFlowWeek(userId, { weekStart, weekEnd });
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add week.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-content">Cash Flow</h1>
          <p className="text-content-secondary text-sm mt-1">
            Plan each week's income and bills, and watch the worst-case ending — your safety number.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-surface-sunken rounded-control p-1">
            <button
              onClick={() => setMonth((m) => shiftMonth(m, -1))}
              className="p-1.5 text-content-secondary hover:text-content rounded-control hover:bg-surface transition-colors"
              title="Previous month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 text-sm font-medium text-content min-w-[9rem] text-center">
              {MONTH_LABEL(month)}
            </span>
            <button
              onClick={() => setMonth((m) => shiftMonth(m, 1))}
              className="p-1.5 text-content-secondary hover:text-content rounded-control hover:bg-surface transition-colors"
              title="Next month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={handleAddWeek}
            disabled={busy || loading}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-brand-fg text-sm font-medium rounded-control hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add week
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-control bg-status-paused-bg border border-edge">
          <p className="text-sm text-status-paused-fg">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
        </div>
      ) : weeks.length === 0 ? (
        <EmptyState month={month} onAddWeek={handleAddWeek} busy={busy} />
      ) : (
        <div className="space-y-5">
          {weeks.map((w, i) => (
            <WeekCard
              key={w.week.id}
              index={i}
              week={w}
              userId={userId}
              onChanged={refetch}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state

function EmptyState({
  month,
  onAddWeek,
  busy,
}: {
  month: string;
  onAddWeek: () => void;
  busy: boolean;
}) {
  return (
    <div className="bg-surface rounded-card border border-edge p-10 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 bg-brand-100 text-brand-600 rounded-control mb-3">
        <CalendarRange className="w-6 h-6" />
      </div>
      <h3 className="font-semibold text-content mb-1">No weeks for {MONTH_LABEL(month)} yet</h3>
      <p className="text-sm text-content-secondary mb-5 max-w-md mx-auto">
        Add a week to start tracking opening balance, planned income, and bills — the board will
        compute your worst-case and projected endings.
      </p>
      <button
        onClick={onAddWeek}
        disabled={busy}
        className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-brand-fg text-sm font-medium rounded-control hover:bg-brand-700 disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        Add your first week
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Week card

function WeekCard({
  index,
  week,
  userId,
  onChanged,
}: {
  index: number;
  week: CashFlowWeek;
  userId: string;
  onChanged: () => Promise<void> | void;
}) {
  const { week: row, income, bills, incomeSubtotal, billsSubtotal, worstCaseEnding, projectedEnding } = week;

  async function saveBalance(field: 'openingBalance' | 'actualEndingBalance', raw: string) {
    const trimmed = raw.trim();
    if (trimmed === '') return; // can't null via the partial upsert; leave as-is
    const value = Number(trimmed);
    if (!Number.isFinite(value)) return;
    await upsertCashFlowWeek(userId, {
      weekStart: row.week_start,
      weekEnd: row.week_end,
      [field]: value,
    });
    await onChanged();
  }

  const worstNegative = worstCaseEnding !== null && worstCaseEnding < 0;

  return (
    <div className="bg-surface rounded-card border border-edge shadow-card overflow-hidden">
      {/* Week header */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 bg-surface-hover border-b border-edge">
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center justify-center w-9 h-9 bg-brand-100 text-brand-600 rounded-control shrink-0">
            <CalendarRange className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-content">Week {index + 1}</h2>
            <p className="text-xs text-content-muted">
              {shortDate(row.week_start)} – {shortDate(row.week_end)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <BalanceField
            label="Opening balance"
            initial={row.opening_balance}
            onCommit={(v) => saveBalance('openingBalance', v)}
          />
          <BalanceField
            label="Actual ending"
            initial={row.actual_ending_balance}
            onCommit={(v) => saveBalance('actualEndingBalance', v)}
          />
        </div>
      </div>

      {/* Income + Bills */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-edge-soft">
        <LineSection
          title="Planned income"
          kind="income"
          lines={income}
          subtotal={incomeSubtotal}
          weekStart={row.week_start}
          userId={userId}
          onChanged={onChanged}
        />
        <LineSection
          title="Bills"
          kind="bill"
          lines={bills}
          subtotal={billsSubtotal}
          weekStart={row.week_start}
          userId={userId}
          onChanged={onChanged}
        />
      </div>

      {/* Week summary */}
      <div className="flex flex-wrap items-stretch gap-3 px-4 py-3 bg-surface-hover border-t border-edge">
        <SummaryStat label="Income" value={usd(incomeSubtotal)} tone="income" />
        <SummaryStat label="Bills" value={usd(billsSubtotal)} tone="bill" />
        {/* Worst-case ending — the emphasized safety number */}
        <div
          className={`flex items-center gap-2 px-4 py-2 rounded-control border ${
            worstNegative
              ? 'bg-status-paused-bg border-status-paused-fg/30'
              : 'bg-status-published-bg border-status-published-fg/30'
          }`}
        >
          <ShieldAlert
            className={`w-5 h-5 shrink-0 ${worstNegative ? 'text-status-paused-fg' : 'text-status-published-fg'}`}
          />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-content-secondary leading-none mb-0.5">
              Worst-case ending
            </p>
            <p
              className={`text-base font-bold leading-none ${
                worstNegative ? 'text-status-paused-fg' : 'text-status-published-fg'
              }`}
            >
              {worstCaseEnding === null ? '—' : usd(worstCaseEnding)}
            </p>
          </div>
        </div>
        <SummaryStat
          label="Projected ending"
          value={projectedEnding === null ? '—' : usd(projectedEnding)}
          tone={projectedEnding !== null && projectedEnding < 0 ? 'bill' : 'neutral'}
        />
        <SummaryStat
          label="Actual ending"
          value={row.actual_ending_balance === null ? '—' : usd(Number(row.actual_ending_balance))}
          tone="neutral"
        />
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'income' | 'bill' | 'neutral';
}) {
  const toneClass =
    tone === 'income'
      ? 'text-status-published-fg'
      : tone === 'bill'
        ? 'text-status-paused-fg'
        : 'text-content';
  return (
    <div className="flex flex-col justify-center px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-content-muted leading-none mb-1">
        {label}
      </p>
      <p className={`text-sm font-semibold leading-none ${toneClass}`}>{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Opening / actual ending balance field

function BalanceField({
  label,
  initial,
  onCommit,
}: {
  label: string;
  initial: number | null;
  onCommit: (raw: string) => Promise<void> | void;
}) {
  const [value, setValue] = useState(initial === null ? '' : String(initial));

  // Keep in sync when the underlying row changes (e.g. after a refetch).
  useEffect(() => {
    setValue(initial === null ? '' : String(initial));
  }, [initial]);

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-content-muted">
        {label}
      </span>
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-content-muted text-sm">$</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => onCommit(value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          placeholder="0.00"
          className="w-32 pl-6 pr-2 py-1.5 text-sm text-right bg-surface border border-edge rounded-control focus:outline-none focus:border-brand-400"
        />
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Income / Bills section (a table with inline add-row)

function LineSection({
  title,
  kind,
  lines,
  subtotal,
  weekStart,
  userId,
  onChanged,
}: {
  title: string;
  kind: 'income' | 'bill';
  lines: CashFlowLineRow[];
  subtotal: number;
  weekStart: string;
  userId: string;
  onChanged: () => Promise<void> | void;
}) {
  const amountTone = kind === 'income' ? 'text-status-published-fg' : 'text-status-paused-fg';

  return (
    <div className="bg-surface">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-content-secondary">{title}</h3>
        <span className={`text-sm font-semibold ${amountTone}`}>{usd(subtotal)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-content-muted border-y border-edge-soft">
              <th className="px-2 py-1.5 font-medium w-24">Date</th>
              <th className="px-2 py-1.5 font-medium">Source</th>
              <th className="px-2 py-1.5 font-medium text-right w-24">Amount</th>
              <th className="px-2 py-1.5 font-medium text-center w-16">Settled</th>
              <th className="px-2 py-1.5 font-medium">Notes</th>
              <th className="px-2 py-1.5 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-edge-soft">
            {lines.map((line) => (
              <LineRow
                key={line.id}
                line={line}
                amountTone={amountTone}
                userId={userId}
                onChanged={onChanged}
              />
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-4 text-center text-xs text-content-muted italic">
                  No {kind === 'income' ? 'income' : 'bills'} yet.
                </td>
              </tr>
            )}
            <AddLineRow kind={kind} weekStart={weekStart} userId={userId} onChanged={onChanged} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Existing editable line row

function LineRow({
  line,
  amountTone,
  userId,
  onChanged,
}: {
  line: CashFlowLineRow;
  amountTone: string;
  userId: string;
  onChanged: () => Promise<void> | void;
}) {
  const [date, setDate] = useState(line.line_date ?? '');
  const [source, setSource] = useState(line.source ?? '');
  const [amount, setAmount] = useState(String(line.amount ?? ''));
  const [notes, setNotes] = useState(line.notes ?? '');
  const [deleting, setDeleting] = useState(false);

  // Resync from server after a refetch.
  useEffect(() => {
    setDate(line.line_date ?? '');
    setSource(line.source ?? '');
    setAmount(String(line.amount ?? ''));
    setNotes(line.notes ?? '');
  }, [line.line_date, line.source, line.amount, line.notes]);

  async function commit(patch: Omit<Parameters<typeof updateCashFlowLine>[1], 'lineId'>) {
    await updateCashFlowLine(userId, { lineId: line.id, ...patch });
    await onChanged();
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteCashFlowLine(userId, { lineId: line.id });
      await onChanged();
    } finally {
      setDeleting(false);
    }
  }

  const cell = 'px-2 py-1.5';
  const inputBase =
    'bg-transparent border border-transparent rounded-control px-1.5 py-1 hover:border-edge focus:outline-none focus:border-brand-400 focus:bg-surface';

  return (
    <tr className="hover:bg-surface-hover">
      <td className={cell}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          onBlur={() => {
            if ((date || null) !== (line.line_date ?? null)) commit({ date });
          }}
          className={`${inputBase} w-full text-content-secondary`}
        />
      </td>
      <td className={cell}>
        <input
          type="text"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          onBlur={() => {
            if (source !== (line.source ?? '')) commit({ source });
          }}
          placeholder="Source"
          className={`${inputBase} w-full text-content`}
        />
      </td>
      <td className={`${cell} text-right`}>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={() => {
            const n = Number(amount);
            if (Number.isFinite(n) && n !== Number(line.amount)) commit({ amount: n });
          }}
          className={`${inputBase} w-full text-right font-medium ${amountTone}`}
        />
      </td>
      <td className={`${cell} text-center`}>
        <input
          type="checkbox"
          checked={line.settled}
          onChange={(e) => commit({ settled: e.target.checked })}
          className="w-4 h-4 accent-brand-600 cursor-pointer"
        />
      </td>
      <td className={cell}>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== (line.notes ?? '')) commit({ notes });
          }}
          placeholder="—"
          className={`${inputBase} w-full text-content-secondary`}
        />
      </td>
      <td className={`${cell} text-center`}>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="p-1 text-content-faint hover:text-status-paused-fg disabled:opacity-50"
          title="Delete line"
        >
          {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Inline add-row

function AddLineRow({
  kind,
  weekStart,
  userId,
  onChanged,
}: {
  kind: 'income' | 'bill';
  weekStart: string;
  userId: string;
  onChanged: () => Promise<void> | void;
}) {
  const [date, setDate] = useState('');
  const [source, setSource] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const canAdd = source.trim() !== '' && amount.trim() !== '' && Number.isFinite(Number(amount));

  async function handleAdd() {
    if (!canAdd || saving) return;
    setSaving(true);
    try {
      await addCashFlowLine(userId, {
        weekStart,
        kind,
        date: date || undefined,
        source: source.trim(),
        amount: Number(amount),
        notes: notes.trim() || undefined,
      });
      setDate('');
      setSource('');
      setAmount('');
      setNotes('');
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  const cell = 'px-2 py-1.5';
  const inputBase =
    'bg-surface border border-edge rounded-control px-1.5 py-1 focus:outline-none focus:border-brand-400';

  return (
    <tr className="bg-surface-hover/40">
      <td className={cell}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={`${inputBase} w-full text-content-secondary`}
        />
      </td>
      <td className={cell}>
        <input
          type="text"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
          }}
          placeholder={kind === 'income' ? 'Add income…' : 'Add bill…'}
          className={`${inputBase} w-full text-content`}
        />
      </td>
      <td className={`${cell} text-right`}>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
          }}
          placeholder="0.00"
          className={`${inputBase} w-full text-right`}
        />
      </td>
      <td className={`${cell} text-center text-content-faint`}>—</td>
      <td className={cell}>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
          }}
          placeholder="Notes"
          className={`${inputBase} w-full text-content-secondary`}
        />
      </td>
      <td className={`${cell} text-center`}>
        <button
          onClick={handleAdd}
          disabled={!canAdd || saving}
          className="p-1 text-brand-600 hover:text-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Add line"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        </button>
      </td>
    </tr>
  );
}

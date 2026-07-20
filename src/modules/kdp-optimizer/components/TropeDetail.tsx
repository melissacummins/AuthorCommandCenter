import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, Copy, Trash2, Upload } from 'lucide-react';
import { copyKeywordToTrope, deleteKeywords, importTropeCsv } from '../api';
import type { Keyword, ScoreColor, Trope } from '../types';

interface Props {
  trope: Trope;
  allTropes: Trope[];
  keywords: Keyword[]; // already filtered to this trope
  onBack: () => void;
  onChange: () => void;
}

const COLOR_BG: Record<ScoreColor, string> = {
  Green: 'bg-emerald-100 text-emerald-800',
  Yellow: 'bg-amber-100 text-amber-800',
  Red: 'bg-rose-100 text-rose-800',
  Gray: 'bg-surface-sunken text-content-secondary',
};

const fmtNum = (n: number) => n.toLocaleString();
const fmtCurrency = (n: number) => `$${n.toFixed(2)}`;

export default function TropeDetail({ trope, allTropes, keywords, onBack, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copyTarget, setCopyTarget] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const otherTropes = useMemo(() => allTropes.filter(t => t.id !== trope.id), [allTropes, trope.id]);
  const sorted = useMemo(
    () => [...keywords].sort((a, b) => b.search_volume - a.search_volume),
    [keywords],
  );

  function toggle(id: string) {
    setSelected(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (selected.size === sorted.length) setSelected(new Set());
    else setSelected(new Set(sorted.map(k => k.id)));
  }

  async function onCsv(file: File) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const text = await file.text();
      const result = await importTropeCsv(trope.user_id, trope.id, text);
      setInfo(`CSV imported — ${result.inserted} added, ${result.updated} updated (${result.rows} rows).`);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} keyword${selected.size === 1 ? '' : 's'}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteKeywords(Array.from(selected));
      setSelected(new Set());
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copySelectedTo() {
    if (selected.size === 0 || !copyTarget) return;
    setBusy(true);
    setError(null);
    try {
      for (const id of selected) {
        await copyKeywordToTrope(trope.user_id, id, copyTarget);
      }
      setInfo(`Copied ${selected.size} keyword${selected.size === 1 ? '' : 's'}.`);
      setSelected(new Set());
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-content-secondary hover:text-content">
        <ArrowLeft className="w-4 h-4" /> Back to Tropes
      </button>

      <div className="bg-surface rounded-card border border-edge p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-content">{trope.name}</h2>
            {trope.description && <p className="text-sm text-content-secondary">{trope.description}</p>}
          </div>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) onCsv(f);
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-edge-strong rounded-control shadow-sm"
            >
              <Upload className="w-4 h-4" /> Upload Publisher Rocket CSV
            </button>
          </div>
        </div>
        {error && <div className="mt-3 p-3 rounded-control bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>}
        {info && <div className="mt-3 p-3 rounded-control bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">{info}</div>}
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-card p-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium text-indigo-800">{selected.size} selected</span>
          <button
            onClick={deleteSelected}
            disabled={busy}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-rose-700 bg-surface border border-rose-200 hover:bg-rose-50 rounded-control"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
          <div className="flex items-center gap-1">
            <select
              value={copyTarget}
              onChange={e => setCopyTarget(e.target.value)}
              className="rounded-control border border-edge-strong px-2 py-1 text-sm bg-surface"
            >
              <option value="">Copy to…</option>
              {otherTropes.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <button
              onClick={copySelectedTo}
              disabled={busy || !copyTarget}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-indigo-700 bg-surface border border-indigo-200 hover:bg-indigo-50 disabled:opacity-50 rounded-control"
            >
              <Copy className="w-3.5 h-3.5" /> Copy
            </button>
          </div>
        </div>
      )}

      {/* Keywords table */}
      <div className="bg-surface rounded-card border border-edge overflow-hidden">
        <div className="px-4 py-3 border-b border-edge-soft text-sm flex items-center justify-between">
          <span>
            <strong>{sorted.length}</strong> keyword{sorted.length === 1 ? '' : 's'} in this trope
          </span>
        </div>
        {sorted.length === 0 ? (
          <div className="p-8 text-center text-sm text-content-secondary">
            No keywords yet. Upload a Publisher Rocket CSV to populate.
          </div>
        ) : (
          <div className="overflow-auto max-h-[640px]">
            <table className="w-full text-sm text-left">
              <thead className="bg-surface-hover text-content-secondary font-medium sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 w-10">
                    <input
                      type="checkbox"
                      checked={selected.size === sorted.length && sorted.length > 0}
                      onChange={toggleAll}
                    />
                  </th>
                  <th className="px-3 py-2">Keyword</th>
                  <th className="px-3 py-2 whitespace-nowrap">Est. Searches</th>
                  <th className="px-3 py-2 whitespace-nowrap">Comp Score</th>
                  <th className="px-3 py-2 whitespace-nowrap">Competitors</th>
                  <th className="px-3 py-2 whitespace-nowrap">Avg Pages</th>
                  <th className="px-3 py-2 whitespace-nowrap">Avg Price</th>
                  <th className="px-3 py-2 whitespace-nowrap">Avg Monthly</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge-soft">
                {sorted.map(k => (
                  <tr key={k.id} className={selected.has(k.id) ? 'bg-indigo-50' : ''}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selected.has(k.id)} onChange={() => toggle(k.id)} />
                    </td>
                    <td className="px-3 py-2 font-medium text-content">{k.text}</td>
                    <td className="px-3 py-2"><Chip text={fmtNum(k.search_volume)} color={k.search_volume_color as ScoreColor} /></td>
                    <td className="px-3 py-2"><Chip text={String(k.competitive_score)} color={k.competitive_score_color as ScoreColor} /></td>
                    <td className="px-3 py-2 text-content-secondary">{fmtNum(k.competitors)}</td>
                    <td className="px-3 py-2 text-content-secondary">{fmtNum(k.avg_pages)}</td>
                    <td className="px-3 py-2 text-content-secondary">{fmtCurrency(k.avg_price)}</td>
                    <td className="px-3 py-2 text-content-secondary">{fmtCurrency(k.avg_monthly_earnings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ text, color }: { text: string; color: ScoreColor | '' }) {
  const klass = color ? COLOR_BG[color] : COLOR_BG.Gray;
  return <span className={`inline-block px-1.5 py-0.5 rounded font-mono text-xs ${klass}`}>{text}</span>;
}

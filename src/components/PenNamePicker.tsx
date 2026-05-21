import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePenNames } from '../contexts/PenNameContext';
import { penNameClasses } from './PenNameChip';

// Header dropdown for filtering by pen name. "All pen names" is the
// default and means no filter is applied — module views interpret
// `selectedPenNameId === null` as a passthrough.

export default function PenNamePicker() {
  const { penNames, selectedPenNameId, setSelectedPenNameId, selectedPenName, loading } = usePenNames();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickAway(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [open]);

  const label = selectedPenName?.name ?? 'All pen names';
  const dot = selectedPenName ? penNameClasses(selectedPenName.color).dot : 'bg-slate-300';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700"
        title="Filter by pen name"
      >
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <span className="font-medium">{label}</span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1">
          <button
            onClick={() => { setSelectedPenNameId(null); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-slate-50"
          >
            <span className="w-2 h-2 rounded-full bg-slate-300" />
            <span className="flex-1 font-medium text-slate-700">All pen names</span>
            {selectedPenNameId === null && <Check className="w-4 h-4 text-emerald-600" />}
          </button>

          {penNames.length > 0 && <div className="my-1 border-t border-slate-100" />}

          {penNames.map(pn => {
            const c = penNameClasses(pn.color);
            const active = pn.id === selectedPenNameId;
            return (
              <button
                key={pn.id}
                onClick={() => { setSelectedPenNameId(pn.id); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-slate-50"
              >
                <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                <span className="flex-1 font-medium text-slate-700">{pn.name}</span>
                {active && <Check className="w-4 h-4 text-emerald-600" />}
              </button>
            );
          })}

          {!loading && penNames.length === 0 && (
            <div className="px-3 py-2 text-xs text-slate-500 italic">
              No pen names yet.
            </div>
          )}

          <div className="my-1 border-t border-slate-100" />
          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            <Users className="w-3.5 h-3.5" />
            Manage pen names…
          </Link>
        </div>
      )}
    </div>
  );
}

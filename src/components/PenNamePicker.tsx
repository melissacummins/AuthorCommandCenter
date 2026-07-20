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
  const dot = selectedPenName ? penNameClasses(selectedPenName.color).dot : 'bg-edge-strong';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-surface border border-edge rounded-control hover:bg-surface-hover text-content"
        title="Filter by pen name"
      >
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <span className="font-medium">{label}</span>
        <ChevronDown className="w-3.5 h-3.5 text-content-muted" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-surface border border-edge rounded-card shadow-lg z-50 py-1">
          <button
            onClick={() => { setSelectedPenNameId(null); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-surface-hover"
          >
            <span className="w-2 h-2 rounded-full bg-edge-strong" />
            <span className="flex-1 font-medium text-content">All pen names</span>
            {selectedPenNameId === null && <Check className="w-4 h-4 text-emerald-600" />}
          </button>

          {penNames.length > 0 && <div className="my-1 border-t border-edge-soft" />}

          {penNames.map(pn => {
            const c = penNameClasses(pn.color);
            const active = pn.id === selectedPenNameId;
            return (
              <button
                key={pn.id}
                onClick={() => { setSelectedPenNameId(pn.id); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-surface-hover"
              >
                <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                <span className="flex-1 font-medium text-content">{pn.name}</span>
                {active && <Check className="w-4 h-4 text-emerald-600" />}
              </button>
            );
          })}

          {!loading && penNames.length === 0 && (
            <div className="px-3 py-2 text-xs text-content-secondary italic">
              No pen names yet.
            </div>
          )}

          <div className="my-1 border-t border-edge-soft" />
          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-content-secondary hover:bg-surface-hover"
          >
            <Users className="w-3.5 h-3.5" />
            Manage pen names…
          </Link>
        </div>
      )}
    </div>
  );
}

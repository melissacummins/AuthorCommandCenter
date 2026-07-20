import { useState, type FormEvent } from 'react';
import { Users, Plus, Trash2, Edit2, X, Check, AlertCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePenNames } from '../../contexts/PenNameContext';
import { createPenName, updatePenName, deletePenName, PEN_NAME_COLORS, type PenName, type PenNameColor } from '../../lib/penNames';
import { penNameClasses } from '../../components/PenNameChip';

export default function PenNamesSection() {
  const { user } = useAuth();
  const { penNames, refresh } = usePenNames();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function handleCreate(name: string, color: PenNameColor) {
    if (!user) return;
    setError(null);
    try {
      await createPenName(user.id, { name, color });
      await refresh();
      setCreating(false);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  }

  async function handleSave(id: string, patch: { name: string; color: PenNameColor }) {
    setError(null);
    try {
      await updatePenName(id, patch);
      await refresh();
      setEditingId(null);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete pen name "${name}"? Books assigned to it will become unassigned.`)) return;
    setError(null);
    try {
      await deletePenName(id);
      await refresh();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  }

  return (
    <section className="bg-surface rounded-card border border-edge p-6 mb-6">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-brand-600" />
          <h2 className="text-lg font-semibold text-content">Pen names</h2>
        </div>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-brand-600 text-brand-fg font-medium rounded-control hover:bg-brand-700"
          >
            <Plus className="w-4 h-4" /> New pen name
          </button>
        )}
      </div>
      <p className="text-sm text-content-secondary mb-5">
        Each pen name groups your books — useful when you write under more than one author persona.
        Filter the whole app by pen name from the picker in the top right.
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-control p-3 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {creating && (
        <PenNameRowEdit
          initial={{ name: '', color: 'pink' }}
          onCancel={() => setCreating(false)}
          onSave={({ name, color }) => handleCreate(name, color)}
        />
      )}

      <div className="space-y-2 mt-3">
        {penNames.map(pn => (
          editingId === pn.id ? (
            <PenNameRowEdit
              key={pn.id}
              initial={pn}
              onCancel={() => setEditingId(null)}
              onSave={patch => handleSave(pn.id, patch)}
            />
          ) : (
            <PenNameRow
              key={pn.id}
              penName={pn}
              onEdit={() => setEditingId(pn.id)}
              onDelete={() => handleDelete(pn.id, pn.name)}
            />
          )
        ))}
        {penNames.length === 0 && !creating && (
          <p className="text-sm text-content-muted italic">No pen names yet. Add one to start grouping your books.</p>
        )}
      </div>
    </section>
  );
}

function PenNameRow({ penName, onEdit, onDelete }: { penName: PenName; onEdit: () => void; onDelete: () => void }) {
  const c = penNameClasses(penName.color);
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border border-edge rounded-card">
      <span className={`w-2.5 h-2.5 rounded-full ${c.dot}`} />
      <span className="font-medium text-content flex-1">{penName.name}</span>
      <button
        onClick={onEdit}
        className="p-1.5 text-content-muted hover:text-content hover:bg-surface-sunken rounded-control"
        aria-label="Edit"
      >
        <Edit2 className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onDelete}
        className="p-1.5 text-content-muted hover:text-rose-600 hover:bg-rose-50 rounded-control"
        aria-label="Delete"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function PenNameRowEdit({
  initial,
  onSave,
  onCancel,
}: {
  initial: { name: string; color: PenNameColor };
  onSave: (patch: { name: string; color: PenNameColor }) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState<PenNameColor>(initial.color);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), color });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="border border-brand-300 bg-brand-50/40 rounded-card p-3 space-y-2">
      <div className="flex gap-2 items-center">
        <input
          autoFocus
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. your pen name"
          className="flex-1 px-3 py-1.5 border border-edge-strong rounded-control text-sm"
        />
        <button
          type="submit"
          disabled={!name.trim() || saving}
          className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-control disabled:opacity-50"
          aria-label="Save"
        >
          <Check className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="p-2 text-content-muted hover:bg-surface-sunken rounded-control"
          aria-label="Cancel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PEN_NAME_COLORS.map(c => {
          const cls = penNameClasses(c);
          const active = c === color;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`w-6 h-6 rounded-full ${cls.dot} ${active ? 'ring-2 ring-offset-2 ring-slate-700' : ''}`}
              aria-label={c}
              title={c}
            />
          );
        })}
      </div>
    </form>
  );
}

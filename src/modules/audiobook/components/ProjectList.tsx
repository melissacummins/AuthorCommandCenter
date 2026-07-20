import { useState } from 'react';
import { Plus, Loader2, Trash2, ChevronRight, AudioLines } from 'lucide-react';
import type { AudiobookProject } from '../types';

// Landing view: every audiobook project, plus a quick "new project" composer.
export default function ProjectList({
  projects, loading, onOpen, onCreate, onDelete,
}: {
  projects: AudiobookProject[];
  loading: boolean;
  onOpen: (id: string) => void;
  onCreate: (title: string) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);

  async function create() {
    setCreating(true);
    try { await onCreate(title.trim() || 'Untitled audiobook'); setTitle(''); }
    finally { setCreating(false); }
  }

  return (
    <div className="max-w-3xl mx-auto p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-content">Audiobooks</h1>
        <p className="text-content-secondary mt-1 text-sm">
          Turn a manuscript into multi-voice narration with ElevenLabs — AI tags who speaks each line, you
          correct it, then render.
        </p>
      </div>

      <div className="flex items-center gap-2 mb-6">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="New audiobook title…"
          onKeyDown={e => { if (e.key === 'Enter') create(); }}
          className="flex-1 px-3 py-2.5 border border-edge-strong rounded-control text-sm" />
        <button onClick={create} disabled={creating}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-white rounded-control bg-violet-600 hover:bg-violet-700 disabled:opacity-50">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} New
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-violet-500 animate-spin" /></div>
      ) : projects.length === 0 ? (
        <div className="text-center py-12 bg-surface rounded-card border border-edge">
          <AudioLines className="w-8 h-8 text-content-faint mx-auto mb-2" />
          <p className="text-sm text-content-secondary">No audiobooks yet. Name one above to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {projects.map(p => (
            <div key={p.id} className="group flex items-center gap-3 p-4 bg-surface rounded-card border border-edge hover:border-edge-strong hover:shadow-sm transition-all">
              <button onClick={() => onOpen(p.id)} className="flex-1 text-left min-w-0">
                <p className="text-sm font-semibold text-content truncate">{p.title}</p>
                <p className="text-xs text-content-muted">
                  {p.narration_mode === 'duet' ? 'Two-voice duet' : 'Narrator + two voices'} · updated {new Date(p.updated_at).toLocaleDateString()}
                </p>
              </button>
              <button onClick={() => { if (confirm(`Delete "${p.title}" and its audio?`)) onDelete(p.id); }}
                className="text-content-faint hover:text-rose-600 opacity-0 group-hover:opacity-100 transition-opacity">
                <Trash2 className="w-4 h-4" />
              </button>
              <button onClick={() => onOpen(p.id)} className="text-content-faint group-hover:text-content-secondary"><ChevronRight className="w-5 h-5" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

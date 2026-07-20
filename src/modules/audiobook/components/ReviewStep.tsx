import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { AudiobookSegment, Speaker } from '../types';

const SPEAKER_STYLE: Record<Speaker, string> = {
  narrator: 'bg-amber-100 text-amber-700 border-amber-200',
  male: 'bg-brand-100 text-brand-700 border-brand-200',
  female: 'bg-brand-100 text-brand-700 border-brand-200',
};

// Step 3 — the payoff for "no more manual selection": AI pre-filled who speaks
// each line; here you skim and correct. Speaker changes save immediately; text /
// name edits save on blur.
export default function ReviewStep({
  segments, onUpdate, onDelete,
}: {
  segments: AudiobookSegment[];
  onUpdate: (id: string, patch: Partial<AudiobookSegment>) => void;
  onDelete: (id: string) => void;
}) {
  if (!segments.length) {
    return <p className="text-sm text-content-muted">No segments yet — analyze a manuscript in the first step.</p>;
  }
  const counts = segments.reduce((acc, s) => { acc[s.speaker] = (acc[s.speaker] ?? 0) + 1; return acc; }, {} as Record<string, number>);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        {(['narrator', 'female', 'male'] as Speaker[]).map(sp => (
          <span key={sp} className={`px-2 py-0.5 rounded-full border ${SPEAKER_STYLE[sp]}`}>
            {sp} · {counts[sp] ?? 0}
          </span>
        ))}
      </div>
      <div className="space-y-2">
        {segments.map(s => <SegmentRow key={s.id} segment={s} onUpdate={onUpdate} onDelete={onDelete} />)}
      </div>
    </div>
  );
}

function SegmentRow({
  segment, onUpdate, onDelete,
}: {
  segment: AudiobookSegment;
  onUpdate: (id: string, patch: Partial<AudiobookSegment>) => void;
  onDelete: (id: string) => void;
}) {
  const [text, setText] = useState(segment.text);
  const [name, setName] = useState(segment.character_name ?? '');

  return (
    <div className="flex items-start gap-2 p-2.5 rounded-control border border-edge-soft">
      <div className="flex flex-col gap-1.5 w-32 shrink-0">
        <select value={segment.speaker} onChange={e => onUpdate(segment.id, { speaker: e.target.value as Speaker })}
          className={`px-2 py-1 text-xs font-medium rounded-control border ${SPEAKER_STYLE[segment.speaker]}`}>
          <option value="narrator">narrator</option>
          <option value="female">female</option>
          <option value="male">male</option>
        </select>
        <input value={name} onChange={e => setName(e.target.value)}
          onBlur={() => { const v = name.trim() || null; if (v !== segment.character_name) onUpdate(segment.id, { character_name: v }); }}
          placeholder="name" className="px-2 py-1 text-xs border border-edge rounded-control" />
        {segment.status === 'rendered' && <span className="text-[10px] text-emerald-600">● rendered</span>}
        {segment.status === 'error' && <span className="text-[10px] text-rose-600" title={segment.error ?? ''}>● error</span>}
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)}
        onBlur={() => { if (text !== segment.text) onUpdate(segment.id, { text, status: 'pending', audio_path: null }); }}
        rows={Math.min(6, Math.max(2, Math.ceil(text.length / 70)))}
        className="flex-1 px-2.5 py-1.5 text-sm border border-edge rounded-control leading-relaxed" />
      <button onClick={() => { if (confirm('Delete this segment?')) onDelete(segment.id); }}
        className="text-content-faint hover:text-rose-600 mt-1"><Trash2 className="w-4 h-4" /></button>
    </div>
  );
}

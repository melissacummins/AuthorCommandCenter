import { useEffect, useRef, useState } from 'react';
import { X, Loader2, Library, Wand2, Mic, Play, Check, Upload, Trash2 } from 'lucide-react';
import type { ElevenVoice, VoicePreview } from '../types';
import { listVoices, designVoice, saveDesignedVoice, cloneVoice, type CloneSample } from '../lib/client';

type Tab = 'library' | 'design' | 'clone';

// Modal for assigning a voice to a cast role via any of the three methods the
// user asked for: pick an existing voice, design a new one from a description,
// or clone one from uploaded audio. Calls onAssign(voice_id, name) on success.
export default function VoicePicker({
  roleLabel, onClose, onAssign,
}: {
  roleLabel: string;
  onClose: () => void;
  onAssign: (voiceId: string, name: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('library');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-surface rounded-card w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
          <h3 className="font-semibold text-content">Assign a voice — <span className="text-violet-600">{roleLabel}</span></h3>
          <button onClick={onClose} className="text-content-muted hover:text-content"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex gap-1 px-5 pt-3">
          {([['library', 'Pick from library', Library], ['design', 'Create from description', Wand2], ['clone', 'Clone from audio', Mic]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-control ${tab === id ? 'bg-violet-50 text-violet-700' : 'text-content-secondary hover:bg-surface-hover'}`}>
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'library' && <LibraryTab onAssign={onAssign} />}
          {tab === 'design' && <DesignTab onAssign={onAssign} />}
          {tab === 'clone' && <CloneTab onAssign={onAssign} />}
        </div>
      </div>
    </div>
  );
}

function PreviewButton({ src }: { src: string | null }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (!src) return null;
  return (
    <>
      <button onClick={() => audioRef.current?.play()} className="inline-flex items-center gap-1 text-xs text-content-secondary hover:text-violet-600">
        <Play className="w-3.5 h-3.5" /> Preview
      </button>
      <audio ref={audioRef} src={src} preload="none" />
    </>
  );
}

// ---- Library ----
function LibraryTab({ onAssign }: { onAssign: (id: string, name: string) => void }) {
  const [voices, setVoices] = useState<ElevenVoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    listVoices().then(setVoices).catch(e => setError((e as Error)?.message ?? 'Could not load voices.'));
  }, []);

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!voices) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 text-violet-500 animate-spin" /></div>;

  const q = filter.trim().toLowerCase();
  const shown = q ? voices.filter(v => `${v.name} ${v.gender ?? ''} ${v.accent ?? ''}`.toLowerCase().includes(q)) : voices;

  return (
    <div>
      <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by name, gender, accent…"
        className="w-full mb-3 px-3 py-2 border border-edge-strong rounded-control text-sm" />
      {shown.length === 0 && <p className="text-sm text-content-muted py-4 text-center">No voices match.</p>}
      <div className="space-y-1.5">
        {shown.map(v => (
          <div key={v.voice_id} className="flex items-center gap-3 p-2.5 rounded-control border border-edge-soft hover:border-edge">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-content truncate">{v.name}</p>
              <p className="text-xs text-content-muted truncate">
                {[v.gender, v.accent, v.age, v.category].filter(Boolean).join(' · ') || 'Voice'}
              </p>
            </div>
            <PreviewButton src={v.preview_url} />
            <button onClick={() => onAssign(v.voice_id, v.name)}
              className="px-3 py-1.5 text-xs font-medium text-white rounded-control bg-violet-600 hover:bg-violet-700">
              Use
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Design ----
function DesignTab({ onAssign }: { onAssign: (id: string, name: string) => void }) {
  const [description, setDescription] = useState('');
  const [name, setName] = useState('');
  const [previews, setPreviews] = useState<VoicePreview[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (description.trim().length < 20) { setError('Describe the voice in at least 20 characters.'); return; }
    setBusy(true); setError(null); setPreviews([]); setChosen(null);
    try {
      const { previews } = await designVoice(description.trim());
      setPreviews(previews);
      if (previews[0]) setChosen(previews[0].generated_voice_id);
    } catch (e) { setError((e as Error)?.message ?? 'Could not generate previews.'); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!chosen) return;
    if (!name.trim()) { setError('Give the voice a name to save it.'); return; }
    setSaving(true); setError(null);
    try {
      const { voice_id, name: savedName } = await saveDesignedVoice(name.trim(), description.trim(), chosen);
      onAssign(voice_id, savedName);
    } catch (e) { setError((e as Error)?.message ?? 'Could not save voice.'); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-content-secondary mb-1">Describe the voice</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
          placeholder="A warm woman in her early 30s, soft Southern accent, calm and intimate — like a late-night radio host."
          className="w-full px-3 py-2 border border-edge-strong rounded-control text-sm" />
      </div>
      <button onClick={generate} disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white rounded-control bg-violet-600 hover:bg-violet-700 disabled:opacity-50">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />} Generate previews
      </button>

      {previews.length > 0 && (
        <div className="space-y-2 pt-1">
          <p className="text-xs font-medium text-content-secondary">Pick the one you like, name it, and save:</p>
          {previews.map((p, i) => (
            <label key={p.generated_voice_id} className={`flex items-center gap-3 p-2.5 rounded-control border cursor-pointer ${chosen === p.generated_voice_id ? 'border-violet-400 bg-violet-50' : 'border-edge-soft'}`}>
              <input type="radio" name="preview" checked={chosen === p.generated_voice_id} onChange={() => setChosen(p.generated_voice_id)} />
              <span className="text-sm text-content flex-1">Preview {i + 1}</span>
              <PreviewButton src={`data:${p.media_type};base64,${p.audio_base64}`} />
            </label>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Voice name (e.g. Elena)"
              className="flex-1 px-3 py-2 border border-edge-strong rounded-control text-sm" />
            <button onClick={save} disabled={saving || !chosen}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white rounded-control bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save & use
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}

// ---- Clone ----
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function CloneTab({ onAssign }: { onAssign: (id: string, name: string) => void }) {
  const [name, setName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function clone() {
    if (!name.trim()) { setError('Name the cloned voice.'); return; }
    if (!files.length) { setError('Add at least one audio sample.'); return; }
    setBusy(true); setError(null);
    try {
      const samples: CloneSample[] = await Promise.all(files.map(async f => ({
        filename: f.name, content_type: f.type || 'audio/mpeg', base64: await fileToBase64(f),
      })));
      const { voice_id, name: savedName } = await cloneVoice(name.trim(), samples);
      onAssign(voice_id, savedName);
    } catch (e) { setError((e as Error)?.message ?? 'Could not clone voice.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-content-secondary">
        Upload 1–2 minutes of clean speech (no music or background noise) for the best clone. Keep total
        upload under ~3 MB.
      </p>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Voice name (e.g. Marcus)"
        className="w-full px-3 py-2 border border-edge-strong rounded-control text-sm" />
      <label className="flex items-center justify-center gap-2 px-3 py-6 border-2 border-dashed border-edge-strong rounded-control text-sm text-content-secondary cursor-pointer hover:border-violet-400">
        <Upload className="w-4 h-4" /> Choose audio file(s)
        <input type="file" accept="audio/*" multiple className="hidden"
          onChange={e => setFiles(prev => [...prev, ...Array.from(e.target.files ?? [])])} />
      </label>
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 text-sm text-content-secondary">
              <span className="flex-1 truncate">{f.name}</span>
              <span className="text-xs text-content-muted">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
              <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-content-muted hover:text-rose-600">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button onClick={clone} disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white rounded-control bg-violet-600 hover:bg-violet-700 disabled:opacity-50">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />} Clone & use
      </button>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}

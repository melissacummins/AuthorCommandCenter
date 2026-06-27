import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FileText, Users, ListChecks, AudioLines } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import ElevenLabsKeyGate from './components/ElevenLabsKeyGate';
import ProjectList from './components/ProjectList';
import ManuscriptStep from './components/ManuscriptStep';
import CastStep from './components/CastStep';
import ReviewStep from './components/ReviewStep';
import RenderStep from './components/RenderStep';
import {
  listProjects, createProject, getProject, updateProject, deleteProject,
  listSegments, replaceSegments, updateSegment, deleteSegment,
  uploadSegmentAudio, signedAudioUrl,
} from './api';
import { renderSegment } from './lib/client';
import { attributeManuscript, type AttributeProgress } from './lib/attribution';
import { castComplete, voiceForSpeaker } from './types';
import type { AudiobookProject, AudiobookProjectUpdate, AudiobookSegment } from './types';
import { listBooks } from '../catalog/api';

type Step = 'manuscript' | 'cast' | 'review' | 'render';

const STEPS: { id: Step; label: string; Icon: typeof FileText }[] = [
  { id: 'manuscript', label: 'Manuscript', Icon: FileText },
  { id: 'cast', label: 'Cast', Icon: Users },
  { id: 'review', label: 'Review', Icon: ListChecks },
  { id: 'render', label: 'Render', Icon: AudioLines },
];

export default function AudiobookModule() {
  const { user } = useAuth();
  return (
    <ElevenLabsKeyGate>
      {user ? <AudiobookInner userId={user.id} /> : null}
    </ElevenLabsKeyGate>
  );
}

function AudiobookInner({ userId }: { userId: string }) {
  const [projects, setProjects] = useState<AudiobookProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [project, setProject] = useState<AudiobookProject | null>(null);
  const [segments, setSegments] = useState<AudiobookSegment[]>([]);
  const [step, setStep] = useState<Step>('manuscript');
  const [books, setBooks] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      listProjects(userId),
      listBooks(userId).then(rows => rows.map(b => ({ id: b.id, title: b.title }))).catch(() => []),
    ])
      .then(([rows, bookList]) => { if (!cancelled) { setProjects(rows); setBooks(bookList); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId]);

  async function open(id: string) {
    const [p, segs] = await Promise.all([getProject(id), listSegments(id)]);
    setProject(p); setSegments(segs); setOpenId(id); setStep('manuscript');
  }

  function backToList() {
    setOpenId(null); setProject(null); setSegments([]);
    listProjects(userId).then(setProjects);
  }

  async function create(title: string) {
    const p = await createProject(userId, { title });
    setProjects(prev => [p, ...prev]);
    await open(p.id);
  }

  async function remove(id: string) {
    await deleteProject(id);
    setProjects(prev => prev.filter(p => p.id !== id));
  }

  async function patch(patch: AudiobookProjectUpdate) {
    if (!project) return;
    setProject(prev => (prev ? { ...prev, ...patch } : prev));
    try { const updated = await updateProject(project.id, patch); setProject(updated); }
    catch { /* keep optimistic state; surfaced elsewhere if it matters */ }
  }

  async function analyze(manuscript: string, onProgress: (p: AttributeProgress) => void): Promise<number> {
    if (!project) return 0;
    const attributed = await attributeManuscript(manuscript, project.narration_mode, onProgress);
    const rows = await replaceSegments(project.id, userId, attributed);
    setSegments(rows);
    await patch({ status: 'review' });
    return rows.length;
  }

  async function editSegment(id: string, p: Partial<AudiobookSegment>) {
    setSegments(prev => prev.map(s => (s.id === id ? { ...s, ...p } : s)));
    try { await updateSegment(id, p); } catch { /* optimistic */ }
  }

  async function removeSegment(id: string) {
    setSegments(prev => prev.filter(s => s.id !== id));
    try { await deleteSegment(id); } catch { /* optimistic */ }
  }

  async function renderOne(seg: AudiobookSegment) {
    if (!project) return;
    const voice = voiceForSpeaker(project, seg.speaker);
    if (!voice.id) {
      await editSegment(seg.id, { status: 'error', error: `No voice assigned for ${seg.speaker}.` });
      return;
    }
    try {
      const { audioBase64, contentType } = await renderSegment(voice.id, seg.text, project.model_id);
      const path = await uploadSegmentAudio(userId, project.id, seg.id, audioBase64, contentType);
      await editSegment(seg.id, { audio_path: path, status: 'rendered', error: null });
    } catch (e) {
      await editSegment(seg.id, { status: 'error', error: (e as Error)?.message ?? 'Render failed.' });
      throw e;
    }
  }

  async function downloadAll() {
    if (!project) return;
    const rendered = [...segments].sort((a, b) => a.idx - b.idx).filter(s => s.status === 'rendered' && s.audio_path);
    const blobs: Blob[] = [];
    for (const s of rendered) {
      const url = await signedAudioUrl(s.audio_path!);
      const resp = await fetch(url);
      blobs.push(await resp.blob());
    }
    // Concatenating MP3 clips end-to-end plays back as one continuous file in
    // every common player; good enough for a draft master without a re-encode.
    const full = new Blob(blobs, { type: 'audio/mpeg' });
    const href = URL.createObjectURL(full);
    const a = document.createElement('a');
    a.href = href;
    a.download = `${project.title.replace(/[^\w\-]+/g, '_') || 'audiobook'}.mp3`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(href);
  }

  const castReady = useMemo(() => (project ? castComplete(project) : false), [project]);

  if (!openId || !project) {
    return <ProjectList projects={projects} loading={loading} onOpen={open} onCreate={create} onDelete={remove} />;
  }

  return (
    <div className="max-w-4xl mx-auto p-6 lg:p-8">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={backToList} className="text-slate-400 hover:text-slate-700"><ArrowLeft className="w-5 h-5" /></button>
        <input
          value={project.title}
          onChange={e => setProject(prev => (prev ? { ...prev, title: e.target.value } : prev))}
          onBlur={e => patch({ title: e.target.value.trim() || 'Untitled audiobook' })}
          className="text-xl font-bold text-slate-800 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-violet-400 outline-none flex-1 min-w-0"
        />
      </div>

      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {STEPS.map(s => {
          const active = step === s.id;
          return (
            <button key={s.id} onClick={() => setStep(s.id)}
              className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 -mb-px ${active ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              <s.Icon className="w-4 h-4" /> <span className="hidden sm:inline">{s.label}</span>
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6">
        {step === 'manuscript' && (
          <ManuscriptStep project={project} onChange={patch} segmentCount={segments.length}
            onAnalyze={analyze} books={books} onAttachBook={id => patch({ book_id: id })} />
        )}
        {step === 'cast' && <CastStep project={project} onChange={patch} />}
        {step === 'review' && <ReviewStep segments={segments} onUpdate={editSegment} onDelete={removeSegment} />}
        {step === 'render' && (
          <RenderStep
            segments={segments}
            castReady={castReady}
            voiceMissingFor={s => !voiceForSpeaker(project, s.speaker).id}
            renderOne={renderOne}
            getAudioUrl={signedAudioUrl}
            onDownloadAll={downloadAll}
          />
        )}
      </div>
    </div>
  );
}

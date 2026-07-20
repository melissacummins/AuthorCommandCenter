import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpenText, Users, ListChecks, AudioLines } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import ElevenLabsKeyGate from './components/ElevenLabsKeyGate';
import ProjectList from './components/ProjectList';
import ChaptersStep from './components/ChaptersStep';
import CastStep from './components/CastStep';
import ScriptStep from './components/ScriptStep';
import RenderStep from './components/RenderStep';
import {
  listProjects, createProject, getProject, updateProject, deleteProject,
  listChapters, saveChapters, listSegments, replaceChapterSegments, updateSegment, deleteSegment,
  uploadSegmentAudio, signedAudioUrl,
} from './api';
import { renderSegment } from './lib/client';
import { attributeManuscript, type AttributeProgress } from './lib/attribution';
import { castComplete, voiceForSpeaker } from './types';
import type { AudiobookChapter, AudiobookProject, AudiobookProjectUpdate, AudiobookSegment, ChapterDraft } from './types';
import { listBooks } from '../catalog/api';

type Step = 'chapters' | 'cast' | 'script' | 'render';

const STEPS: { id: Step; label: string; Icon: typeof BookOpenText }[] = [
  { id: 'chapters', label: 'Chapters', Icon: BookOpenText },
  { id: 'cast', label: 'Cast', Icon: Users },
  { id: 'script', label: 'Script', Icon: ListChecks },
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
  const [chapters, setChapters] = useState<AudiobookChapter[]>([]);
  const [segments, setSegments] = useState<AudiobookSegment[]>([]);
  const [step, setStep] = useState<Step>('chapters');
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
    const [p, chs, segs] = await Promise.all([getProject(id), listChapters(id), listSegments(id)]);
    setProject(p); setChapters(chs); setSegments(segs); setOpenId(id); setStep('chapters');
  }

  function backToList() {
    setOpenId(null); setProject(null); setChapters([]); setSegments([]);
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

  async function patch(p: AudiobookProjectUpdate) {
    if (!project) return;
    setProject(prev => (prev ? { ...prev, ...p } : prev));
    try { const updated = await updateProject(project.id, p); setProject(updated); }
    catch { /* keep optimistic state */ }
  }

  async function acceptChapters(drafts: ChapterDraft[]) {
    if (!project) return;
    const rows = await saveChapters(project.id, userId, drafts);
    setChapters(rows);
    setSegments([]); // saveChapters clears all prior segments + audio
    await patch({ status: 'cast' });
  }

  async function analyzeChapter(chapter: AudiobookChapter, onProgress: (p: AttributeProgress) => void): Promise<number> {
    if (!project) return 0;
    const attributed = await attributeManuscript(chapter.source_text, project.narration_mode, onProgress);
    const rows = await replaceChapterSegments(chapter.id, project.id, userId, attributed);
    setSegments(prev => [...prev.filter(s => s.chapter_id !== chapter.id), ...rows]);
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
    if (!voice.id) { await editSegment(seg.id, { status: 'error', error: `No voice assigned for ${seg.speaker}.` }); return; }
    try {
      const { audioBase64, contentType } = await renderSegment(voice.id, seg.text, project.model_id);
      const path = await uploadSegmentAudio(userId, project.id, seg.id, audioBase64, contentType);
      await editSegment(seg.id, { audio_path: path, status: 'rendered', error: null });
    } catch (e) {
      await editSegment(seg.id, { status: 'error', error: (e as Error)?.message ?? 'Render failed.' });
      throw e;
    }
  }

  // Concatenate a set of rendered clips (in order) into one MP3 and download it.
  // End-to-end MP3 concatenation plays back as one continuous file in common
  // players — fine for a draft master without re-encoding.
  async function concatAndDownload(segs: AudiobookSegment[], filename: string) {
    const ordered = segs.filter(s => s.status === 'rendered' && s.audio_path);
    if (!ordered.length) return;
    const blobs: Blob[] = [];
    for (const s of ordered) {
      const url = await signedAudioUrl(s.audio_path!);
      blobs.push(await (await fetch(url)).blob());
    }
    const href = URL.createObjectURL(new Blob(blobs, { type: 'audio/mpeg' }));
    const a = document.createElement('a');
    a.href = href; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(href);
  }

  function safeName(s: string): string { return s.replace(/[^\w\-]+/g, '_') || 'audiobook'; }

  const segmentsByChapter = useMemo(() => {
    const map: Record<string, AudiobookSegment[]> = {};
    for (const c of chapters) {
      map[c.id] = segments.filter(s => s.chapter_id === c.id).sort((a, b) => a.idx - b.idx);
    }
    return map;
  }, [chapters, segments]);

  async function downloadChapter(chapterId: string) {
    if (!project) return;
    const ch = chapters.find(c => c.id === chapterId);
    await concatAndDownload(segmentsByChapter[chapterId] ?? [], `${safeName(project.title)}-${safeName(ch?.title ?? 'chapter')}.mp3`);
  }

  async function downloadAll() {
    if (!project) return;
    const ordered = [...chapters].sort((a, b) => a.idx - b.idx).flatMap(c => segmentsByChapter[c.id] ?? []);
    await concatAndDownload(ordered, `${safeName(project.title)}.mp3`);
  }

  const castReady = useMemo(() => (project ? castComplete(project) : false), [project]);

  if (!openId || !project) {
    return <ProjectList projects={projects} loading={loading} onOpen={open} onCreate={create} onDelete={remove} />;
  }

  return (
    <div className="max-w-4xl mx-auto p-6 lg:p-8">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={backToList} className="text-content-muted hover:text-content"><ArrowLeft className="w-5 h-5" /></button>
        <input
          value={project.title}
          onChange={e => setProject(prev => (prev ? { ...prev, title: e.target.value } : prev))}
          onBlur={e => patch({ title: e.target.value.trim() || 'Untitled audiobook' })}
          className="text-xl font-bold text-content bg-transparent border-b border-transparent hover:border-edge focus:border-violet-400 outline-none flex-1 min-w-0"
        />
      </div>

      <div className="flex gap-1 mb-6 border-b border-edge">
        {STEPS.map(s => {
          const active = step === s.id;
          return (
            <button key={s.id} onClick={() => setStep(s.id)}
              className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 -mb-px ${active ? 'border-violet-600 text-violet-700' : 'border-transparent text-content-secondary hover:text-content'}`}>
              <s.Icon className="w-4 h-4" /> <span className="hidden sm:inline">{s.label}</span>
            </button>
          );
        })}
      </div>

      <div className="bg-surface rounded-card border border-edge p-5 sm:p-6">
        {step === 'chapters' && (
          <ChaptersStep project={project} chapters={chapters} onChange={patch} onAccept={acceptChapters}
            books={books} onAttachBook={id => patch({ book_id: id })} />
        )}
        {step === 'cast' && <CastStep project={project} onChange={patch} />}
        {step === 'script' && (
          <ScriptStep chapters={chapters} segmentsByChapter={segmentsByChapter}
            onAnalyzeChapter={analyzeChapter} onUpdateSegment={editSegment} onDeleteSegment={removeSegment} />
        )}
        {step === 'render' && (
          <RenderStep
            chapters={chapters} segmentsByChapter={segmentsByChapter} castReady={castReady}
            voiceMissingFor={s => !voiceForSpeaker(project, s.speaker).id}
            renderOne={renderOne} getAudioUrl={signedAudioUrl}
            onDownloadChapter={downloadChapter} onDownloadAll={downloadAll}
          />
        )}
      </div>
    </div>
  );
}

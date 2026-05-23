import { useState } from 'react';
import { BookOpen, ChevronRight, Wand2, Loader2 } from 'lucide-react';
import type { ReaderAvatar, CompAuthor } from '../../../lib/types';
import BookBasicsForm from './BookBasicsForm';
import AIAnalysisResults from './AIAnalysisResults';

interface Props {
  onComplete: () => void;
}

export default function BookAnalysisStep({ onComplete }: Props) {
  const [phase, setPhase] = useState<'basics' | 'analyzing' | 'review'>('basics');

  // Basics (user provides)
  const [bookTitle, setBookTitle] = useState('');
  const [series, setSeries] = useState('');
  const [penName, setPenName] = useState('');
  const [subgenre, setSubgenre] = useState('');
  const [heatLevel, setHeatLevel] = useState('');
  const [selectedTropes, setSelectedTropes] = useState<string[]>([]);

  // AI-generated (editable after analysis)
  const [themes, setThemes] = useState<string[]>([]);
  const [dynamics, setDynamics] = useState<string[]>([]);
  const [keyScenes, setKeyScenes] = useState<string[]>([]);
  const [toneKeywords, setToneKeywords] = useState<string[]>([]);
  const [compAuthors, setCompAuthors] = useState<CompAuthor[]>([]);
  const [avatars, setAvatars] = useState<ReaderAvatar[]>([]);

  const canAnalyze = bookTitle.trim() && subgenre && selectedTropes.length > 0;

  function handleAnalyze() {
    if (!canAnalyze) return;
    setPhase('analyzing');

    // Simulate AI analysis (replace with real API call)
    setTimeout(() => {
      setThemes(['Power and control', 'Identity and self-discovery', 'Trust after betrayal', 'Desire vs. safety']);
      setDynamics(['He kneels for her', 'She holds the knife', 'Push-pull tension', 'Protective but not controlling']);
      setKeyScenes(['The first confrontation', 'The chase scene', 'The moment he breaks', 'The surrender']);
      setToneKeywords(['Dark', 'Intense', 'Tender', 'Possessive', 'Raw']);
      setCompAuthors([
        { name: 'Rina Kent', relevance: 'Dark power dynamics', source: 'AI suggestion' },
        { name: 'Danielle Lori', relevance: 'Slow-burn intensity', source: 'AI suggestion' },
        { name: 'Penelope Douglas', relevance: 'Morally gray antiheroes', source: 'AI suggestion' },
      ]);
      setAvatars([
        { id: crypto.randomUUID(), name: 'The Primal Reader', description: 'Wants raw intensity and consent-forward kink exploration', desires: ['primal energy', 'body worship'], tropes_searched: ['possessive hero', 'fated mates'], framework: 'Primal/Kink-Curious Reader' },
        { id: crypto.randomUUID(), name: 'The BookTok Devotee', description: 'Wants to scream about this book to everyone', desires: ['emotional devastation', 'book hangover'], tropes_searched: ['he falls first', 'touch her and die'], framework: 'BookTok Friend: Unhinged Recommendation' },
        { id: crypto.randomUUID(), name: 'The Dark Romance Veteran', description: 'Has read it all, wants something that still surprises', desires: ['complex dynamics', 'anti-hero depth'], tropes_searched: ['morally gray hero', 'enemies to lovers'], framework: "Main Character: Hero's POV" },
      ]);
      setPhase('review');
    }, 2500);
  }

  if (phase === 'basics') {
    return (
      <div className="p-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-pink-500" />
            Book Analysis
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            Tell us the basics, then AI will analyze the manuscript to extract themes, dynamics, scenes, and build reader avatars.
          </p>
        </div>

        <div className="mb-6 px-4 py-3 bg-pink-50 border border-pink-200 rounded-lg">
          <p className="text-sm text-pink-800 font-medium">You provide the basics below. AI handles the rest.</p>
          <p className="text-xs text-pink-600 mt-1">Themes, character dynamics, key scenes, tone, comp authors, and reader avatars will be generated for you to review and edit.</p>
        </div>

        <BookBasicsForm
          bookTitle={bookTitle} setBookTitle={setBookTitle}
          series={series} setSeries={setSeries}
          penName={penName} setPenName={setPenName}
          subgenre={subgenre} setSubgenre={setSubgenre}
          heatLevel={heatLevel} setHeatLevel={setHeatLevel}
          selectedTropes={selectedTropes} setSelectedTropes={setSelectedTropes}
        />

        <div className="flex items-center justify-between pt-6 mt-6 border-t border-slate-200">
          <p className="text-xs text-slate-400">
            {canAnalyze ? 'Ready to analyze.' : 'Fill in book title, subgenre, and at least one trope.'}
          </p>
          <button
            onClick={handleAnalyze}
            disabled={!canAnalyze}
            className="flex items-center gap-2 px-6 py-2.5 bg-pink-600 text-white text-sm font-medium rounded-lg hover:bg-pink-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Wand2 className="w-4 h-4" /> Analyze with AI
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'analyzing') {
    return (
      <div className="p-6 flex flex-col items-center justify-center py-20">
        <Loader2 className="w-10 h-10 text-pink-500 animate-spin mb-4" />
        <h3 className="text-lg font-semibold text-slate-800 mb-1">Analyzing "{bookTitle}"</h3>
        <p className="text-sm text-slate-500">Extracting themes, dynamics, key scenes, and building reader avatars...</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-pink-500" />
          Book Analysis — Review & Edit
        </h3>
        <p className="text-sm text-slate-500 mt-1">
          AI analyzed <strong>{bookTitle}</strong>. Review the results below and edit anything that's off.
        </p>
      </div>

      <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
        <p className="text-sm text-green-800 font-medium">Analysis complete. Everything below is editable.</p>
        <p className="text-xs text-green-600 mt-1">Add, remove, or rewrite anything. This data drives all your ad copy.</p>
      </div>

      <AIAnalysisResults
        themes={themes} setThemes={setThemes}
        dynamics={dynamics} setDynamics={setDynamics}
        keyScenes={keyScenes} setKeyScenes={setKeyScenes}
        toneKeywords={toneKeywords} setToneKeywords={setToneKeywords}
        compAuthors={compAuthors} setCompAuthors={setCompAuthors}
        avatars={avatars} setAvatars={setAvatars}
      />

      <div className="flex items-center justify-between pt-6 mt-6 border-t border-slate-200">
        <button
          onClick={() => setPhase('basics')}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          Back to basics
        </button>
        <button
          onClick={onComplete}
          className="flex items-center gap-2 px-6 py-2.5 bg-pink-600 text-white text-sm font-medium rounded-lg hover:bg-pink-700 shadow-sm"
        >
          Continue to Creative Studio <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

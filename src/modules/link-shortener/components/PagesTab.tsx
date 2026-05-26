import { useState } from 'react';
import { BookOpen, Library } from 'lucide-react';
import LandingPagesPanel from './LandingPagesPanel';
import SeriesPagesPanel from './SeriesPagesPanel';

// Wraps the two page builders (single book pages + multi-book series) behind
// a small sub-toggle, since both live under the "Pages" tab.
export default function PagesTab() {
  const [view, setView] = useState<'books' | 'series'>('books');
  return (
    <div>
      <div className="inline-flex gap-1 bg-slate-100 rounded-lg p-1 mb-6">
        <button
          onClick={() => setView('books')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            view === 'books' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <BookOpen className="w-4 h-4" /> Books
        </button>
        <button
          onClick={() => setView('series')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            view === 'series' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Library className="w-4 h-4" /> Series
        </button>
      </div>
      {view === 'books' ? <LandingPagesPanel /> : <SeriesPagesPanel />}
    </div>
  );
}

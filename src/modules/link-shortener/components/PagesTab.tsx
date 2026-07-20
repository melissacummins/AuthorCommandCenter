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
      <div className="inline-flex gap-1 bg-surface-sunken rounded-control p-1 mb-6">
        <button
          onClick={() => setView('books')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-control text-sm font-medium transition-colors ${
            view === 'books' ? 'bg-surface text-content shadow-sm' : 'text-content-secondary hover:text-content'
          }`}
        >
          <BookOpen className="w-4 h-4" /> Books
        </button>
        <button
          onClick={() => setView('series')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-control text-sm font-medium transition-colors ${
            view === 'series' ? 'bg-surface text-content shadow-sm' : 'text-content-secondary hover:text-content'
          }`}
        >
          <Library className="w-4 h-4" /> Series
        </button>
      </div>
      {view === 'books' ? <LandingPagesPanel /> : <SeriesPagesPanel />}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Anchor, Clapperboard, GalleryHorizontalEnd, BookOpenText, Video, LibraryBig, Flame } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import CatalogBookPicker from '../../components/CatalogBookPicker';
import { listBooks } from '../catalog/api';
import type { Book } from '../catalog/types';
import { getManuscriptForBook } from '../writing/api';
import type { Manuscript } from '../writing/types';
import HooksTab from './components/HooksTab';
import PlaybookTab from './components/PlaybookTab';
import SlideshowsTab from './components/SlideshowsTab';
import ScreenshotsTab from './components/ScreenshotsTab';

type Tab = 'hooks' | 'slideshows' | 'screenshots' | 'videos' | 'playbook';

const LAST_BOOK_KEY = 'content-creator-book';

// Content Creator: the studio that turns a finished manuscript into marketing
// assets. The catalog supplies book facts, the Writing module supplies the
// manuscript text — this module never asks for either by hand.
export default function ContentCreatorModule() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('hooks');
  const [bookId, setBookId] = useState<string | null>(() => localStorage.getItem(LAST_BOOK_KEY));
  const [book, setBook] = useState<Book | null>(null);
  const [manuscript, setManuscript] = useState<Manuscript | null>(null);
  const [manuscriptLoading, setManuscriptLoading] = useState(false);

  // Restore the remembered book on first load (the picker only reports
  // selections the user makes; a stored id needs its Book object fetched).
  useEffect(() => {
    if (!user || !bookId || book) return;
    let cancelled = false;
    listBooks(user.id)
      .then(books => {
        if (cancelled) return;
        const found = books.find(b => b.id === bookId);
        if (found) setBook(found);
        else { setBookId(null); localStorage.removeItem(LAST_BOOK_KEY); }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [user, bookId, book]);

  useEffect(() => {
    if (!user || !book) { setManuscript(null); return; }
    let cancelled = false;
    setManuscriptLoading(true);
    getManuscriptForBook(user.id, book.id)
      .then(m => { if (!cancelled) setManuscript(m); })
      .catch(() => { if (!cancelled) setManuscript(null); })
      .finally(() => { if (!cancelled) setManuscriptLoading(false); });
    return () => { cancelled = true; };
  }, [user, book]);

  function handleBookChange(id: string, b: Book) {
    setBookId(id);
    setBook(b);
    localStorage.setItem(LAST_BOOK_KEY, id);
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <Clapperboard className="w-6 h-6 text-pink-500" /> Content Creator
        </h1>
        <p className="text-slate-500 mt-1">
          Scan your manuscript for hooks, then turn them into slideshows, Kindle screenshots, and videos.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(280px,380px)_1fr] items-start">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Book</label>
            <CatalogBookPicker value={bookId} onChange={handleBookChange} />
          </div>
          {book && <BookFacts book={book} manuscript={manuscript} manuscriptLoading={manuscriptLoading} />}
        </div>
      </div>

      <div className="flex flex-wrap gap-1 bg-slate-100 rounded-lg p-1 mb-6 w-fit">
        <TabButton active={tab === 'hooks'} onClick={() => setTab('hooks')}>
          <Anchor className="w-4 h-4" /> Hooks
        </TabButton>
        <TabButton active={tab === 'slideshows'} onClick={() => setTab('slideshows')}>
          <GalleryHorizontalEnd className="w-4 h-4" /> Slideshows
        </TabButton>
        <TabButton active={tab === 'screenshots'} onClick={() => setTab('screenshots')}>
          <BookOpenText className="w-4 h-4" /> Kindle Screenshots
        </TabButton>
        <TabButton active={tab === 'videos'} onClick={() => setTab('videos')}>
          <Video className="w-4 h-4" /> Videos
        </TabButton>
        <TabButton active={tab === 'playbook'} onClick={() => setTab('playbook')}>
          <LibraryBig className="w-4 h-4" /> Playbook
        </TabButton>
      </div>

      {tab === 'hooks' && (
        book ? (
          <HooksTab key={book.id} book={book} manuscript={manuscript} />
        ) : (
          <ComingNext
            title="Hook Scanner"
            body="Pick a book above to see its hooks. Scanning reads the linked manuscript chapter by chapter and builds your saved hook list — manual, resumable, and only when you start it."
          />
        )
      )}
      {tab === 'slideshows' && (
        book ? (
          <SlideshowsTab key={book.id} book={book} />
        ) : (
          <ComingNext
            title="Slideshow Studio"
            body="Pick a book above, approve a hook, and generate an editable carousel with AI, library, or uploaded backgrounds. Exports 9:16 for TikTok and 4:5 for Instagram."
          />
        )
      )}
      {tab === 'screenshots' && (
        book ? (
          <ScreenshotsTab key={book.id} book={book} manuscript={manuscript} />
        ) : (
          <ComingNext
            title="Kindle Screenshots"
            body="Pick a book above, then pull a scene, auto-highlight the dialogue, strike out the naughty words, and stamp hearts, circles, and exclamations — then export as a PNG."
          />
        )
      )}
      {tab === 'videos' && (
        <ComingNext
          title="Video Composer"
          body="Timed script text over a generated or uploaded video, with music from your library or ElevenLabs. Preview live, export WebM or the assets for CapCut."
        />
      )}
      {tab === 'playbook' && <PlaybookTab />}
    </div>
  );
}

function BookFacts({ book, manuscript, manuscriptLoading }: {
  book: Book;
  manuscript: Manuscript | null;
  manuscriptLoading: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600 lg:pt-7">
      {book.series && (
        <span><span className="text-slate-400">Series:</span> {book.series}{book.series_position ? ` #${book.series_position}` : ''}</span>
      )}
      {book.subgenre && (
        <span><span className="text-slate-400">Subgenre:</span> {book.subgenre}</span>
      )}
      {book.heat_level && (
        <span className="flex items-center gap-1">
          <span className="text-slate-400">Heat:</span>
          {Array.from({ length: book.heat_level }, (_, i) => (
            <Flame key={i} className="w-3.5 h-3.5 text-orange-500 fill-orange-400" />
          ))}
        </span>
      )}
      {book.tropes.length > 0 && (
        <span><span className="text-slate-400">Tropes:</span> {book.tropes.slice(0, 4).join(', ')}{book.tropes.length > 4 ? '…' : ''}</span>
      )}
      <span>
        <span className="text-slate-400">Manuscript:</span>{' '}
        {manuscriptLoading ? 'checking…' : manuscript
          ? `${manuscript.title} (${manuscript.status})`
          : 'none linked — link one in Writing to enable scanning'}
      </span>
    </div>
  );
}

function ComingNext({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center max-w-2xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-700 mb-2">{title}</h2>
      <p className="text-slate-500">{body}</p>
      <p className="text-xs text-slate-400 mt-4">Coming in the next update.</p>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  );
}

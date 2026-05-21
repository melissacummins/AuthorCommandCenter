import { useState } from 'react';
import { Plus, X, AlertCircle } from 'lucide-react';
import type { Book } from '../../catalog/types';
import CatalogBookPicker from '../../../components/CatalogBookPicker';
import PenNameChip from '../../../components/PenNameChip';
import { usePenNames } from '../../../contexts/PenNameContext';
import type { UnmatchedTitles, ReaderBookRelationship } from '../types';

interface Props {
  label: string;
  relationship: ReaderBookRelationship;
  // Book ids currently linked under this relationship (form-local state).
  bookIds: string[];
  // All catalog books, used to render chips for already-linked rows
  // and to feed the picker. The picker pulls its own list but we use
  // this to resolve titles for currently-selected ids.
  catalogBooks: Book[];
  // Free-text titles from the legacy backfill that couldn't be
  // matched. UI offers a one-click "link to Catalog" path that opens
  // the picker pre-seeded for matching.
  unmatched?: string[];
  onAdd: (bookId: string) => void;
  onRemove: (bookId: string) => void;
  onDismissUnmatched?: (title: string) => void;
}

// Per-relationship book picker + linked-book chips. Used three times
// in ReaderForm (applied / received / reviewed). Keeps its own picker
// open/close state so the three sections don't fight.
export default function ReaderBookSection({
  label, relationship: _rel, bookIds, catalogBooks, unmatched, onAdd, onRemove, onDismissUnmatched,
}: Props) {
  const [adding, setAdding] = useState(false);
  const { penNames } = usePenNames();

  const booksById = new Map(catalogBooks.map(b => [b.id, b]));
  const selectedSet = new Set(bookIds);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-slate-700">{label}</span>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700"
          >
            <Plus className="w-3 h-3" /> Add book
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-2">
        {bookIds.length === 0 && !unmatched?.length && (
          <span className="text-xs text-slate-400 italic">No books in this list yet.</span>
        )}
        {bookIds.map(id => {
          const b = booksById.get(id);
          const pn = b?.pen_name_id ? penNames.find(p => p.id === b.pen_name_id) : null;
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1.5 text-xs pl-2 pr-1 py-1 bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-full"
            >
              {b?.title ?? '(deleted book)'}
              {pn && <PenNameChip name={pn.name} color={pn.color} />}
              <button
                type="button"
                onClick={() => onRemove(id)}
                className="ml-0.5 p-0.5 hover:bg-indigo-200 rounded-full"
                aria-label={`Remove ${b?.title ?? 'book'}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          );
        })}
      </div>

      {/* Unmatched legacy titles — clickable to open the picker so the
         user can link them to a Catalog book. */}
      {unmatched && unmatched.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {unmatched.map(title => (
            <span
              key={title}
              title="Title from legacy import — not yet linked to Catalog. Click to link."
              className="inline-flex items-center gap-1.5 text-xs pl-2 pr-1 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-full"
            >
              <AlertCircle className="w-3 h-3" />
              {title}
              {onDismissUnmatched && (
                <button
                  type="button"
                  onClick={() => onDismissUnmatched(title)}
                  className="ml-0.5 p-0.5 hover:bg-amber-100 rounded-full"
                  aria-label={`Dismiss ${title}`}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {adding && (
        <div className="space-y-2">
          <CatalogBookPicker
            value={null}
            onChange={(bookId) => {
              if (!selectedSet.has(bookId)) onAdd(bookId);
              setAdding(false);
            }}
            filterByPenName={false}
            placeholder="Pick a book to add…"
          />
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export type { UnmatchedTitles };

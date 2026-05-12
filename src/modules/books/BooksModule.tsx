import { Library, ArrowRight } from 'lucide-react';

const plannedFields = [
  'Title, subtitle, series name and position',
  'Connected / related books (prequels, spin-offs, box sets)',
  'Cover image upload + alt covers (paperback, hardback, audio)',
  'Status: idea, drafting, editing, pre-order, published, paused',
  'Writing progress: current chapter, word count, target word count',
  'Tropes and themes (taggable, filterable)',
  'Review excerpts (with source + star rating)',
  'Book excerpts: a tested-excerpt library tagged worked / flopped / untried',
  'ISBN registry: eBook, paperback, hardback, audio, large print',
  'Pricing, retailer links, ASINs',
  'Release date, pre-order date, manuscript-due date',
  'Notes and back-cover blurb drafts',
];

export default function BooksModule() {
  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="text-center py-12">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-2xl shadow-lg shadow-indigo-500/25 mb-6">
          <Library className="w-10 h-10 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Books</h2>
        <p className="text-slate-500 max-w-xl mx-auto mb-8">
          The single source of truth for every book — status, covers, ISBNs, marketing copy,
          tropes, themes, excerpts that worked, and where each title sits in a series.
        </p>

        <div className="bg-white rounded-2xl p-6 max-w-2xl mx-auto border border-slate-200 shadow-sm text-left">
          <h3 className="font-semibold text-slate-700 mb-4">Planned fields per book</h3>
          <ul className="text-sm text-slate-600 space-y-2">
            {plannedFields.map(field => (
              <li key={field} className="flex items-start gap-2">
                <ArrowRight className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-1" />
                <span>{field}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-slate-400 mt-6 max-w-md mx-auto">
          Scaffold only. Schema, storage for covers, and the editor UI come next.
        </p>
      </div>
    </div>
  );
}

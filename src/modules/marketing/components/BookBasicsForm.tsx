import { useEffect, useState } from 'react';
import { Plus, Heart } from 'lucide-react';
import { usePenNames } from '../../../contexts/PenNameContext';
import { penNameClasses } from '../../../components/PenNameChip';

const SUBGENRES = [
  'Dark Mafia Romance', 'Dark Vampire Romance', 'Monster Romance',
  'Paranormal Romance', 'Dark Romance', 'Fantasy Romance',
  'Contemporary Romance', 'Romantic Suspense',
];

const COMMON_TROPES = [
  'Enemies to Lovers', 'Forced Proximity', 'Fated Mates', 'Age Gap',
  'Arranged Marriage', 'Touch Her and Die', 'He Falls First', 'Slow Burn',
  'Who Did This to You', 'Morally Gray Hero', 'Possessive Hero',
  'Strong Heroine', 'Dark Past', 'Grumpy/Sunshine', 'One Bed',
  'Instalove', 'Forbidden Love', 'Second Chance', 'Revenge',
  'Beauty and the Beast', 'Power Couple', 'Mate Bond',
];

interface Props {
  bookTitle: string; setBookTitle: (v: string) => void;
  series: string; setSeries: (v: string) => void;
  penName: string; setPenName: (v: string) => void;
  subgenre: string; setSubgenre: (v: string) => void;
  heatLevel: string; setHeatLevel: (v: string) => void;
  selectedTropes: string[]; setSelectedTropes: (v: string[]) => void;
}

export default function BookBasicsForm({
  bookTitle, setBookTitle, series, setSeries, penName, setPenName,
  subgenre, setSubgenre, heatLevel, setHeatLevel,
  selectedTropes, setSelectedTropes,
}: Props) {
  const [customTrope, setCustomTrope] = useState('');
  const { penNames, selectedPenName } = usePenNames();

  // Auto-fill pen name from the header picker if the user hasn't typed
  // one yet — the picker reflects the working pen name, so it's the
  // sensible default.
  useEffect(() => {
    if (!penName && selectedPenName) setPenName(selectedPenName.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPenName?.id]);

  const matchedPen = penNames.find(pn => pn.name.toLowerCase() === penName.toLowerCase());

  function toggleTrope(trope: string) {
    setSelectedTropes(
      selectedTropes.includes(trope)
        ? selectedTropes.filter(t => t !== trope)
        : [...selectedTropes, trope]
    );
  }

  function addCustomTrope() {
    if (customTrope.trim() && !selectedTropes.includes(customTrope.trim())) {
      setSelectedTropes([...selectedTropes, customTrope.trim()]);
      setCustomTrope('');
    }
  }

  return (
    <div className="space-y-6">
      {/* Book Details */}
      <section>
        <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Book Details</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Book Title *</label>
            <input
              type="text" value={bookTitle} onChange={e => setBookTitle(e.target.value)}
              placeholder="e.g., My Brutal Beast"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-pink-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Series</label>
            <input
              type="text" value={series} onChange={e => setSeries(e.target.value)}
              placeholder="e.g., Claimed by Beasts"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-pink-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Pen Name</label>
            {penNames.length > 0 ? (
              <>
                <select
                  value={matchedPen?.name ?? ''}
                  onChange={e => setPenName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-pink-400 bg-white"
                >
                  <option value="">— Select pen name —</option>
                  {penNames.map(pn => (
                    <option key={pn.id} value={pn.name}>{pn.name}</option>
                  ))}
                </select>
                {matchedPen && (
                  <span className={`mt-1 inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full ${penNameClasses(matchedPen.color).bg} ${penNameClasses(matchedPen.color).text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${penNameClasses(matchedPen.color).dot}`} />
                    {matchedPen.name}
                  </span>
                )}
              </>
            ) : (
              <>
                <input
                  type="text" value={penName} onChange={e => setPenName(e.target.value)}
                  placeholder="e.g., Melissa Cummins"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-pink-400"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Add pen names in <a href="/settings" className="text-pink-600 hover:underline">Settings</a> to pick them here.
                </p>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Subgenre */}
      <section>
        <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Subgenre *</h4>
        <select
          value={subgenre} onChange={e => setSubgenre(e.target.value)}
          className="w-full max-w-xs px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-pink-400"
        >
          <option value="">Select subgenre...</option>
          {SUBGENRES.map(sg => <option key={sg} value={sg}>{sg}</option>)}
        </select>
      </section>

      {/* Heat Level */}
      <section>
        <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Heat Level</h4>
        <div className="flex flex-wrap gap-2">
          {['Closed Door', 'Fade to Black', 'Steamy', 'Explicit', 'Dark + Explicit'].map(level => (
            <button
              key={level} onClick={() => setHeatLevel(level)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                heatLevel === level
                  ? 'bg-pink-100 text-pink-700 border-2 border-pink-300'
                  : 'bg-slate-100 text-slate-600 border-2 border-transparent hover:bg-slate-200'
              }`}
            >
              {level}
            </button>
          ))}
        </div>
      </section>

      {/* Tropes */}
      <section>
        <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-2">
          <Heart className="w-4 h-4 text-pink-500" /> Tropes *
        </h4>
        <div className="flex flex-wrap gap-2 mb-3">
          {COMMON_TROPES.map(trope => (
            <button
              key={trope} onClick={() => toggleTrope(trope)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                selectedTropes.includes(trope)
                  ? 'bg-pink-100 text-pink-700 border border-pink-300'
                  : 'bg-slate-100 text-slate-600 border border-transparent hover:bg-slate-200'
              }`}
            >
              {trope}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text" value={customTrope} onChange={e => setCustomTrope(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addCustomTrope()}
            placeholder="Add custom trope..."
            className="flex-1 max-w-xs px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-pink-400"
          />
          <button onClick={addCustomTrope} className="px-3 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm hover:bg-slate-200">
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </section>
    </div>
  );
}

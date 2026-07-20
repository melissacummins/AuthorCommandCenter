import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';

// Palette is hardcoded so Tailwind's JIT actually picks up the class strings.
// 10 colors keeps the picker visually scannable.
export const TAG_COLORS = ['slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink'] as const;
export type TagColor = typeof TAG_COLORS[number];

const COLOR_CLASSES: Record<TagColor, { chip: string; swatch: string }> = {
  slate:  { chip: 'bg-surface-sunken text-content border-edge',   swatch: 'bg-content-muted' },
  red:    { chip: 'bg-red-100 text-red-700 border-red-200',         swatch: 'bg-red-400' },
  orange: { chip: 'bg-orange-100 text-orange-700 border-orange-200', swatch: 'bg-orange-400' },
  amber:  { chip: 'bg-amber-100 text-amber-700 border-amber-200',   swatch: 'bg-amber-400' },
  green:  { chip: 'bg-green-100 text-green-700 border-green-200',   swatch: 'bg-green-400' },
  teal:   { chip: 'bg-brand-100 text-brand-700 border-brand-200',      swatch: 'bg-brand-400' },
  blue:   { chip: 'bg-brand-100 text-brand-700 border-brand-200',      swatch: 'bg-brand-400' },
  indigo: { chip: 'bg-brand-100 text-brand-700 border-brand-200', swatch: 'bg-brand-400' },
  purple: { chip: 'bg-brand-100 text-brand-700 border-brand-200', swatch: 'bg-brand-400' },
  pink:   { chip: 'bg-brand-100 text-brand-700 border-brand-200',      swatch: 'bg-brand-400' },
};

// Deterministic fallback color for tags that haven't been customized yet —
// hash the label so the same tag always defaults to the same color.
export function defaultColorFor(label: string): TagColor {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}

export function colorFor(label: string, colorMap: Map<string, string>): TagColor {
  const stored = colorMap.get(label.toLowerCase());
  if (stored && (TAG_COLORS as readonly string[]).includes(stored)) return stored as TagColor;
  return defaultColorFor(label);
}

interface Props {
  value: string;                          // comma-separated labels
  onChange: (next: string) => void;       // committed labels (the parent saves)
  allTags: string[];                      // every known tag across the user's books (for autocomplete)
  colorMap: Map<string, string>;          // lowercased label → color
  onSetTagColor: (label: string, color: TagColor) => void; // persist color choice
}

export default function TagMultiSelect({ value, onChange, allTags, colorMap, onSetTagColor }: Props) {
  const tags = useMemo(() => value.split(',').map(t => t.trim()).filter(Boolean), [value]);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  // Click-away closes dropdown / color picker
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (containerRef.current && !containerRef.current.contains(t)) {
        setOpen(false);
      }
      if (pickerRef.current && !pickerRef.current.contains(t) && !(e.target as Element).closest?.('[data-chip]')) {
        setPickerFor(null);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function commit(next: string[]) {
    // dedupe (case-insensitive) and preserve order of first occurrence
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of next) {
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    onChange(out.join(', '));
  }

  function addTag(label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;
    commit([...tags, trimmed]);
    setInput('');
  }

  function removeTag(label: string) {
    commit(tags.filter(t => t.toLowerCase() !== label.toLowerCase()));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(input);
    } else if (e.key === 'Backspace' && input === '' && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  }

  const suggestions = useMemo(() => {
    const lower = input.trim().toLowerCase();
    const existing = new Set(tags.map(t => t.toLowerCase()));
    const pool = allTags.filter(t => !existing.has(t.toLowerCase()));
    if (!lower) return pool.slice(0, 12);
    return pool.filter(t => t.toLowerCase().includes(lower)).slice(0, 12);
  }, [input, allTags, tags]);

  const inputTrimmed = input.trim();
  const showCreate = inputTrimmed && !allTags.some(t => t.toLowerCase() === inputTrimmed.toLowerCase()) && !tags.some(t => t.toLowerCase() === inputTrimmed.toLowerCase());

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex flex-wrap items-center gap-1 min-h-[34px] px-1.5 py-1 border border-transparent hover:border-edge focus-within:border-brand-400 rounded cursor-text"
        onClick={() => setOpen(true)}
      >
        {tags.map(t => {
          const color = colorFor(t, colorMap);
          return (
            <span
              key={t}
              data-chip
              onClick={e => { e.stopPropagation(); setPickerFor(pickerFor === t ? null : t); }}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded-full border cursor-pointer ${COLOR_CLASSES[color].chip}`}
              title="Click to change color"
            >
              {t}
              <button
                onClick={e => { e.stopPropagation(); removeTag(t); }}
                className="hover:bg-slate-900/10 rounded-full"
                aria-label={`Remove ${t}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          );
        })}
        <input
          type="text"
          value={input}
          onChange={e => { setInput(e.target.value); setOpen(true); }}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          placeholder={tags.length === 0 ? 'Add tags…' : ''}
          className="flex-1 min-w-[80px] text-sm focus:outline-none bg-transparent"
        />
      </div>

      {/* Suggestions dropdown */}
      {open && (suggestions.length > 0 || showCreate) && (
        <div className="absolute left-0 right-0 mt-1 z-20 bg-surface border border-edge rounded-control shadow-lg max-h-60 overflow-y-auto">
          {suggestions.map(t => {
            const color = colorFor(t, colorMap);
            return (
              <button
                key={t}
                onClick={() => addTag(t)}
                className="flex items-center gap-2 w-full text-left px-2 py-1.5 text-sm hover:bg-surface-hover"
              >
                <span className={`inline-block px-1.5 py-0.5 text-[11px] rounded-full border ${COLOR_CLASSES[color].chip}`}>{t}</span>
              </button>
            );
          })}
          {showCreate && (
            <button
              onClick={() => addTag(inputTrimmed)}
              className="flex items-center gap-2 w-full text-left px-2 py-1.5 text-sm hover:bg-surface-hover border-t border-edge-soft"
            >
              <span className="text-content-secondary text-xs">Create</span>
              <span className={`inline-block px-1.5 py-0.5 text-[11px] rounded-full border ${COLOR_CLASSES[defaultColorFor(inputTrimmed)].chip}`}>{inputTrimmed}</span>
            </button>
          )}
        </div>
      )}

      {/* Color picker popover */}
      {pickerFor && (
        <div ref={pickerRef} className="absolute z-30 bg-surface border border-edge rounded-control shadow-lg p-2 mt-1">
          <p className="text-[10px] uppercase text-content-muted mb-1 px-1">Color for "{pickerFor}"</p>
          <div className="flex flex-wrap gap-1 max-w-[200px]">
            {TAG_COLORS.map(c => (
              <button
                key={c}
                onClick={() => { onSetTagColor(pickerFor, c); setPickerFor(null); }}
                className={`w-6 h-6 rounded-full border-2 ${colorFor(pickerFor, colorMap) === c ? 'border-slate-800' : 'border-white'} ${COLOR_CLASSES[c].swatch}`}
                title={c}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

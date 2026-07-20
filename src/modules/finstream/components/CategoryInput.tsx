import { useState } from 'react';

export default function CategoryInput({ value, onChange, categories, placeholder, className, onEnter, onEscape, autoFocus }: {
  value: string;
  onChange: (v: string) => void;
  categories: string[];
  placeholder?: string;
  className?: string;
  onEnter?: () => void;
  onEscape?: () => void;
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);

  const filtered = value
    ? categories.filter(c => c.toLowerCase().includes(value.toLowerCase()) && c !== value)
    : categories;

  const showSuggestions = focused && filtered.length > 0;

  return (
    <div className={`relative ${className || ''}`}>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={e => {
          if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); }
          if (e.key === 'Escape' && onEscape) onEscape();
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full px-3 py-2 border border-edge rounded-control text-sm focus:outline-none focus:border-cyan-400"
      />
      {showSuggestions && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-surface border border-edge rounded-control shadow-lg max-h-40 overflow-y-auto">
          {filtered.slice(0, 8).map(cat => (
            <button
              key={cat}
              type="button"
              onMouseDown={e => { e.preventDefault(); onChange(cat); setFocused(false); }}
              className="w-full text-left px-3 py-2 text-sm text-content hover:bg-cyan-50 hover:text-cyan-700"
            >
              {cat}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

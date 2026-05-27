import { useRef, type ReactNode } from 'react';
import { Bold, Italic } from 'lucide-react';

// A textarea with a small Bold / Italic toolbar. Wraps the current selection
// in markdown tokens (**bold**, *italic*) that the public pages render. Keeps
// storage as plain text so nothing downstream changes.
export default function FormattedTextarea({
  value, onChange, onBlur, rows = 3, placeholder, className,
}: {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  rows?: number;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function apply(token: string, fallback: string) {
    const ta = ref.current;
    if (!ta) return;
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const selected = value.slice(start, end) || fallback;
    const next = value.slice(0, start) + token + selected + token + value.slice(end);
    onChange(next);
    const caret = start + token.length;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(caret, caret + selected.length);
    });
  }

  return (
    <div className="rounded-lg border border-slate-300 focus-within:ring-2 focus-within:ring-indigo-300 overflow-hidden">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-slate-200 bg-slate-50">
        <ToolbarButton onClick={() => apply('**', 'bold text')} title="Bold"><Bold className="w-3.5 h-3.5" /></ToolbarButton>
        <ToolbarButton onClick={() => apply('*', 'italic text')} title="Italic"><Italic className="w-3.5 h-3.5" /></ToolbarButton>
        <span className="ml-1 text-[11px] text-slate-400">Select text, then format · Enter for a new line</span>
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        rows={rows}
        placeholder={placeholder}
        className={className ?? 'w-full px-3 py-2 text-sm bg-white resize-none focus:outline-none'}
      />
    </div>
  );
}

function ToolbarButton({ onClick, title, children }: { onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      className="p-1.5 rounded text-slate-600 hover:bg-slate-200"
    >
      {children}
    </button>
  );
}

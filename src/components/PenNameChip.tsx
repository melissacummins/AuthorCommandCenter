import type { PenNameColor } from '../lib/penNames';

// Static class lookups so Tailwind's purge keeps these styles. Adding a
// new color requires extending both this map and PEN_NAME_COLORS.
const COLORS: Record<PenNameColor, { bg: string; text: string; ring: string; dot: string }> = {
  slate:    { bg: 'bg-surface-sunken',    text: 'text-content',    ring: 'ring-edge-strong',    dot: 'bg-slate-500'    },
  rose:     { bg: 'bg-rose-100',     text: 'text-rose-700',     ring: 'ring-rose-300',     dot: 'bg-rose-500'     },
  pink:     { bg: 'bg-pink-100',     text: 'text-pink-700',     ring: 'ring-pink-300',     dot: 'bg-pink-500'     },
  fuchsia:  { bg: 'bg-fuchsia-100',  text: 'text-fuchsia-700',  ring: 'ring-fuchsia-300',  dot: 'bg-fuchsia-500'  },
  purple:   { bg: 'bg-purple-100',   text: 'text-purple-700',   ring: 'ring-purple-300',   dot: 'bg-purple-500'   },
  violet:   { bg: 'bg-violet-100',   text: 'text-violet-700',   ring: 'ring-violet-300',   dot: 'bg-violet-500'   },
  indigo:   { bg: 'bg-indigo-100',   text: 'text-indigo-700',   ring: 'ring-indigo-300',   dot: 'bg-indigo-500'   },
  blue:     { bg: 'bg-blue-100',     text: 'text-blue-700',     ring: 'ring-blue-300',     dot: 'bg-blue-500'     },
  cyan:     { bg: 'bg-cyan-100',     text: 'text-cyan-700',     ring: 'ring-cyan-300',     dot: 'bg-cyan-500'     },
  teal:     { bg: 'bg-teal-100',     text: 'text-teal-700',     ring: 'ring-teal-300',     dot: 'bg-teal-500'     },
  emerald:  { bg: 'bg-emerald-100',  text: 'text-emerald-700',  ring: 'ring-emerald-300',  dot: 'bg-emerald-500'  },
  amber:    { bg: 'bg-amber-100',    text: 'text-amber-700',    ring: 'ring-amber-300',    dot: 'bg-amber-500'    },
};

export function penNameClasses(color: PenNameColor) {
  return COLORS[color] ?? COLORS.slate;
}

interface Props {
  name: string;
  color: PenNameColor;
  size?: 'sm' | 'md';
  className?: string;
}

export default function PenNameChip({ name, color, size = 'sm', className = '' }: Props) {
  const c = penNameClasses(color);
  const sizeClass = size === 'md' ? 'text-sm px-2.5 py-1' : 'text-xs px-2 py-0.5';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${c.bg} ${c.text} ${sizeClass} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {name}
    </span>
  );
}

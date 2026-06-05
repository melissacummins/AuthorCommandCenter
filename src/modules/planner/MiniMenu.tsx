import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// A tiny click-to-open menu, portalled to <body> and positioned under its
// trigger so it never gets clipped by the planner's scroll containers. Shared
// by the list task rows (PlannerModule) and the My Day task rows (MyDayView).
export function MiniMenu({
  icon, title, children,
}: {
  icon: ReactNode;
  title: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      // Flip the menu above the trigger when there isn't room below, so it's
      // never cut off by the bottom of the window.
      const spaceBelow = window.innerHeight - r.bottom;
      const openUp = spaceBelow < 280 && r.top > spaceBelow;
      setPos({
        left: Math.max(8, r.right),
        ...(openUp ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      });
    }
    setOpen(o => !o);
  }

  return (
    <>
      <button ref={btnRef} onClick={toggle} title={title} className="shrink-0">
        {icon}
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 min-w-[8rem] max-h-[70vh] overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg py-0.5"
            style={{ top: pos.top, bottom: pos.bottom, left: pos.left, transform: 'translateX(-100%)' }}
          >
            {children(() => setOpen(false))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

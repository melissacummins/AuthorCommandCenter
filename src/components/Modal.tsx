import { X } from 'lucide-react';
import type { ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
}

export default function Modal({ open, onClose, title, children, maxWidth = 'max-w-lg' }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className={`relative bg-surface rounded-card shadow-2xl w-full ${maxWidth} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-edge">
          <h3 className="text-lg font-semibold text-content">{title}</h3>
          <button onClick={onClose} className="p-1 text-content-muted hover:text-content-secondary rounded-control hover:bg-surface-sunken">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}

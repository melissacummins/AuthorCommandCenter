import { useState, type ReactNode } from 'react';
import { Folder, FolderPlus, MoreHorizontal, Inbox, Pencil, Trash2, Check, X } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { createFolder, deleteFolder, updateFolder } from '../api';
import type { LinkFolder, ShortLink } from '../types';

interface Props {
  folders: LinkFolder[];
  links: ShortLink[];
  selectedFolderId: string | null | 'unassigned';
  onSelect: (id: string | null | 'unassigned') => void;
  onChange: (folders: LinkFolder[]) => void;
}

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#06b6d4', '#84cc16'];

export default function FoldersSidebar({ folders, links, selectedFolderId, onSelect, onChange }: Props) {
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(COLORS[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState(COLORS[0]);
  const [busy, setBusy] = useState(false);

  const totalCount = links.filter((l) => !l.parent_id && !l.archived_at).length;
  const unassignedCount = links.filter((l) => !l.parent_id && !l.archived_at && !l.folder_id).length;

  function countFor(folderId: string) {
    return links.filter((l) => !l.parent_id && !l.archived_at && l.folder_id === folderId).length;
  }

  async function handleCreate() {
    if (!user || !newName.trim()) return;
    setBusy(true);
    try {
      const folder = await createFolder(user.id, newName.trim(), newColor);
      onChange([...folders, folder]);
      setNewName('');
      setNewColor(COLORS[0]);
      setCreating(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdit() {
    if (!editingId || !editName.trim()) return;
    setBusy(true);
    try {
      const updated = await updateFolder(editingId, { name: editName.trim(), color: editColor });
      onChange(folders.map((f) => (f.id === editingId ? updated : f)));
      setEditingId(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this folder? Links inside will become unassigned (not deleted).')) return;
    setBusy(true);
    try {
      await deleteFolder(id);
      onChange(folders.filter((f) => f.id !== id));
      if (selectedFolderId === id) onSelect(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="w-full lg:w-56 shrink-0">
      <div className="space-y-1">
        <NavItem
          active={selectedFolderId === null}
          onClick={() => onSelect(null)}
          icon={<Inbox className="w-4 h-4" />}
          label="All links"
          count={totalCount}
        />
        <NavItem
          active={selectedFolderId === 'unassigned'}
          onClick={() => onSelect('unassigned')}
          icon={<Folder className="w-4 h-4 text-content-muted" />}
          label="Unassigned"
          count={unassignedCount}
        />
      </div>

      <div className="mt-5 mb-2 px-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-content-muted">Folders</span>
        <button
          onClick={() => {
            setCreating(true);
            setEditingId(null);
          }}
          className="text-content-muted hover:text-indigo-600 p-1 rounded"
          title="New folder"
        >
          <FolderPlus className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-1">
        {folders.map((f) => (
          <div key={f.id}>
            {editingId === f.id ? (
              <EditRow
                name={editName}
                color={editColor}
                onName={setEditName}
                onColor={setEditColor}
                onSave={handleSaveEdit}
                onCancel={() => setEditingId(null)}
                busy={busy}
              />
            ) : (
              <FolderRow
                folder={f}
                count={countFor(f.id)}
                active={selectedFolderId === f.id}
                onClick={() => onSelect(f.id)}
                onEdit={() => {
                  setEditingId(f.id);
                  setEditName(f.name);
                  setEditColor(f.color);
                  setCreating(false);
                }}
                onDelete={() => handleDelete(f.id)}
              />
            )}
          </div>
        ))}
        {creating && (
          <EditRow
            name={newName}
            color={newColor}
            onName={setNewName}
            onColor={setNewColor}
            onSave={handleCreate}
            onCancel={() => setCreating(false)}
            busy={busy}
            placeholder="Folder name"
          />
        )}
        {folders.length === 0 && !creating && (
          <p className="text-xs text-content-muted px-2 py-2">No folders yet. Create one to organize links.</p>
        )}
      </div>
    </aside>
  );
}

interface NavItemProps {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  count: number;
}

function NavItem({ active, onClick, icon, label, count }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-control text-sm transition-colors ${
        active ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-content-secondary hover:bg-surface-sunken'
      }`}
    >
      {icon}
      <span className="flex-1 text-left truncate">{label}</span>
      <span className="text-xs text-content-muted tabular-nums">{count}</span>
    </button>
  );
}

interface FolderRowProps {
  folder: LinkFolder;
  count: number;
  active: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function FolderRow({ folder, count, active, onClick, onEdit, onDelete }: FolderRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-control text-sm transition-colors ${
          active ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-content-secondary hover:bg-surface-sunken'
        }`}
      >
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: folder.color }} />
        <span className="flex-1 text-left truncate">{folder.name}</span>
        <span className="text-xs text-content-muted tabular-nums">{count}</span>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 text-content-muted hover:text-content rounded"
        title="Folder actions"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-7 z-40 w-32 bg-surface rounded-control border border-edge shadow-lg py-1 text-sm">
            <button onClick={() => { setMenuOpen(false); onEdit(); }} className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-content hover:bg-surface-hover">
              <Pencil className="w-3.5 h-3.5" /> Rename
            </button>
            <button onClick={() => { setMenuOpen(false); onDelete(); }} className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-red-600 hover:bg-red-50">
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

interface EditRowProps {
  name: string;
  color: string;
  onName: (v: string) => void;
  onColor: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  placeholder?: string;
}

function EditRow({ name, color, onName, onColor, onSave, onCancel, busy, placeholder }: EditRowProps) {
  return (
    <div className="px-2 py-2 rounded-control bg-surface-hover border border-edge space-y-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => onName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder={placeholder ?? 'Folder name'}
        className="w-full px-2 py-1 text-sm rounded border border-edge focus:outline-none focus:ring-2 focus:ring-indigo-300"
      />
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => onColor(c)}
              className={`w-4 h-4 rounded-full border-2 ${color === c ? 'border-slate-700' : 'border-transparent'}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div className="flex gap-1">
          <button onClick={onCancel} className="p-1 text-content-muted hover:text-content-secondary rounded">
            <X className="w-3.5 h-3.5" />
          </button>
          <button onClick={onSave} disabled={busy} className="p-1 text-emerald-600 hover:text-emerald-700 rounded disabled:opacity-50">
            <Check className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

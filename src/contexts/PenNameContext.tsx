import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { listPenNames, type PenName } from '../lib/penNames';

// Global pen name picker state. The selected id is persisted in
// localStorage so module views remember the filter across reloads.
// A null `selectedPenNameId` means "All pen names" — modules should
// treat it as an unfiltered passthrough.

interface PenNameContextValue {
  penNames: PenName[];
  selectedPenNameId: string | null;
  setSelectedPenNameId: (id: string | null) => void;
  refresh: () => Promise<void>;
  loading: boolean;
  selectedPenName: PenName | null;
}

const STORAGE_KEY = 'selected-pen-name-id';
const PenNameContext = createContext<PenNameContextValue | undefined>(undefined);

export function PenNameProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [penNames, setPenNames] = useState<PenName[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPenNameId, setSelectedPenNameIdRaw] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(STORAGE_KEY);
  });

  const refresh = useCallback(async () => {
    if (!user) {
      setPenNames([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await listPenNames(user.id);
      setPenNames(rows);
      // If the persisted selection points at a deleted pen name, clear it.
      if (selectedPenNameId && !rows.find(p => p.id === selectedPenNameId)) {
        setSelectedPenNameIdRaw(null);
        localStorage.removeItem(STORAGE_KEY);
      }
    } finally {
      setLoading(false);
    }
  }, [user, selectedPenNameId]);

  useEffect(() => { refresh(); }, [refresh]);

  function setSelectedPenNameId(id: string | null) {
    setSelectedPenNameIdRaw(id);
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  }

  const selectedPenName = selectedPenNameId ? penNames.find(p => p.id === selectedPenNameId) ?? null : null;

  return (
    <PenNameContext.Provider
      value={{ penNames, selectedPenNameId, setSelectedPenNameId, refresh, loading, selectedPenName }}
    >
      {children}
    </PenNameContext.Provider>
  );
}

export function usePenNames(): PenNameContextValue {
  const ctx = useContext(PenNameContext);
  if (!ctx) throw new Error('usePenNames must be used inside <PenNameProvider>');
  return ctx;
}

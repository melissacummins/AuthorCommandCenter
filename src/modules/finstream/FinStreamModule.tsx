import { useState } from 'react';
import { LayoutDashboard, List, Tag, CreditCard, Download } from 'lucide-react';
import Dashboard from './components/Dashboard';
import TransactionTable from './components/TransactionTable';
import CategoryRules from './components/CategoryRules';
import Subscriptions from './components/Subscriptions';
import JsonImport from './components/JsonImport';
import Modal from '../../components/Modal';

type Tab = 'dashboard' | 'transactions' | 'rules' | 'subscriptions';

export interface SharedFilters {
  search: string;
  monthFilter: string;
  typeFilter: '' | 'income' | 'expense';
  categoryFilter: string;
}

export default function FinStreamModule() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [showImport, setShowImport] = useState(false);
  const [filters, setFilters] = useState<SharedFilters>({
    search: '',
    monthFilter: '',
    typeFilter: '',
    categoryFilter: '',
  });

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex gap-1 bg-surface-sunken rounded-control p-1">
          <TabButton active={tab === 'dashboard'} onClick={() => setTab('dashboard')} icon={LayoutDashboard} label="Dashboard" />
          <TabButton active={tab === 'transactions'} onClick={() => setTab('transactions')} icon={List} label="Transactions" />
          <TabButton active={tab === 'rules'} onClick={() => setTab('rules')} icon={Tag} label="Rules" />
          <TabButton active={tab === 'subscriptions'} onClick={() => setTab('subscriptions')} icon={CreditCard} label="Subscriptions" />
        </div>
        <button
          onClick={() => setShowImport(true)}
          className="flex items-center gap-2 px-4 py-2 border border-edge text-content text-sm font-medium rounded-control hover:bg-surface-hover"
        >
          <Download className="w-4 h-4" /> Import from JSON
        </button>
      </div>

      {tab === 'dashboard' && <Dashboard />}
      {tab === 'transactions' && <TransactionTable filters={filters} onFiltersChange={setFilters} />}
      {tab === 'rules' && <CategoryRules />}
      {tab === 'subscriptions' && <Subscriptions />}

      <Modal open={showImport} onClose={() => setShowImport(false)} title="Import from JSON" maxWidth="max-w-xl">
        <JsonImport onComplete={() => setShowImport(false)} />
      </Modal>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: {
  active: boolean;
  onClick: () => void;
  icon: typeof LayoutDashboard;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-control text-sm font-medium transition-colors ${
        active ? 'bg-surface text-content shadow-sm' : 'text-content-secondary hover:text-content'
      }`}
    >
      <Icon className="w-4 h-4" /> {label}
    </button>
  );
}

import { useEffect, useState } from 'react';
import { ShieldCheck, UserPlus, Check, Loader2, Trash2, Globe, CheckCircle, Star, ChevronDown } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { GATED_MODULES, type AppMember, type MemberStatus } from '../../lib/access';
import type { CustomDomain } from '../link-shortener/types';

const ALL_MODULE_KEYS = GATED_MODULES.map(m => m.key);

// Owner-only control panel: manage who can get into the app and which
// modules each member is allowed to see.
export default function AdminSection() {
  const { isAdmin, refreshAccess } = useAuth();
  const [members, setMembers] = useState<AppMember[]>([]);
  const [domains, setDomains] = useState<CustomDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  // New members default to everything checked; the owner can uncheck the
  // areas they don't want this person to have before adding.
  const [newModules, setNewModules] = useState<string[]>(ALL_MODULE_KEYS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  if (!isAdmin) return null;

  async function load() {
    setLoading(true);
    const [membersRes, domainsRes] = await Promise.all([
      supabase.from('app_members').select('*').order('created_at', { ascending: true }),
      supabase.from('custom_domains').select('*').order('created_at', { ascending: true }),
    ]);
    setMembers((membersRes.data as AppMember[] | null) ?? []);
    setDomains((domainsRes.data as CustomDomain[] | null) ?? []);
    setLoading(false);
  }

  async function addMember() {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.from('app_members').insert({
      email,
      status: 'active',
      plan: 'member',
      modules: newModules,
      approved_at: new Date().toISOString(),
      note: 'Added by admin',
    });
    if (error) {
      setError(/duplicate|unique/i.test(error.message) ? 'That email is already on the list.' : error.message);
    } else {
      setNewEmail('');
      setNewModules(ALL_MODULE_KEYS);
    }
    await load();
    await refreshAccess();
    setBusy(false);
  }

  async function patchMember(id: string, patch: Partial<AppMember>) {
    await supabase.from('app_members').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    await load();
    await refreshAccess();
  }

  async function setMemberModules(m: AppMember, next: string[]) {
    // Optimistic local update so the checkbox feels instant.
    setMembers(prev => prev.map(x => (x.id === m.id ? { ...x, modules: next } : x)));
    await patchMember(m.id, { modules: next });
  }

  function toggleNewModule(key: string) {
    setNewModules(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  }

  async function removeMember(m: AppMember) {
    if (!confirm(`Remove ${m.email}? They'll lose access until re-added.`)) return;
    await supabase.from('app_members').delete().eq('id', m.id);
    await load();
    await refreshAccess();
  }

  async function verifyDomain(d: CustomDomain) {
    await supabase
      .from('custom_domains')
      .update({ verified: true, updated_at: new Date().toISOString() })
      .eq('id', d.id);
    await load();
  }

  async function setPrimaryDomain(d: CustomDomain) {
    await supabase.from('custom_domains').update({ is_primary: false }).eq('user_id', d.user_id);
    await supabase.from('custom_domains').update({ is_primary: true }).eq('id', d.id);
    await load();
  }

  async function deleteDomain(d: CustomDomain) {
    if (!confirm(`Remove ${d.domain}? Links served from it will stop working.`)) return;
    await supabase.from('custom_domains').delete().eq('id', d.id);
    await load();
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
      <div className="flex items-center gap-3 mb-2">
        <ShieldCheck className="w-5 h-5 text-amber-600" />
        <h2 className="text-lg font-semibold text-slate-800">Members & access</h2>
        <span className="ml-auto text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">
          Owner only
        </span>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Approve who can use the Command Center and pick which areas each person sees. Payment is
        handled in your community — add a member's email here once they've joined.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-8">
          {/* Add member */}
          <div>
            <h3 className="font-medium text-slate-800 mb-2">Add a member</h3>
            <div className="flex gap-2">
              <input
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="member@example.com"
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm"
                autoComplete="off"
              />
              <button
                onClick={addMember}
                disabled={busy || !newEmail.trim() || newModules.length === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-amber-600 text-white font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                Add
              </button>
            </div>
            <div className="mt-3">
              <p className="text-xs font-medium text-slate-600 mb-2">Areas this member can see</p>
              <ModuleChecklist values={newModules} onToggle={toggleNewModule} />
            </div>
            {error && <p className="text-rose-600 text-sm mt-2">{error}</p>}
          </div>

          {/* Member list */}
          <div>
            <h3 className="font-medium text-slate-800 mb-3">Members</h3>
            {members.length === 0 ? (
              <p className="text-sm text-slate-400">No members yet.</p>
            ) : (
              <div className="space-y-2">
                {members.map(m => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    onApprove={() => patchMember(m.id, { status: 'active', approved_at: new Date().toISOString() })}
                    onBlock={() => patchMember(m.id, { status: 'blocked' })}
                    onUnblock={() => patchMember(m.id, { status: 'active', approved_at: new Date().toISOString() })}
                    onSetModules={(next) => setMemberModules(m, next)}
                    onRemove={() => removeMember(m)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Custom domains */}
          <div>
            <h3 className="font-medium text-slate-800 mb-1 flex items-center gap-2">
              <Globe className="w-4 h-4 text-indigo-600" /> Custom domains
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              When a member connects a domain, attach it in the Vercel dashboard, confirm their DNS
              points to it, then mark it verified here to switch it on.
            </p>
            {domains.length === 0 ? (
              <p className="text-sm text-slate-400">No domains requested yet.</p>
            ) : (
              <div className="space-y-2">
                {domains.map((d) => (
                  <div key={d.id} className="flex flex-wrap items-center gap-2 border border-slate-200 rounded-xl px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate font-mono">{d.domain}</p>
                      <span className={`text-[11px] font-medium ${d.verified ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {d.verified ? 'verified' : 'pending'}{d.is_primary ? ' · primary' : ''}
                      </span>
                    </div>
                    {!d.verified && (
                      <button
                        onClick={() => verifyDomain(d)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100"
                      >
                        <CheckCircle className="w-3.5 h-3.5" /> Verify
                      </button>
                    )}
                    {d.verified && !d.is_primary && (
                      <button
                        onClick={() => setPrimaryDomain(d)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
                      >
                        <Star className="w-3.5 h-3.5" /> Make primary
                      </button>
                    )}
                    <button
                      onClick={() => deleteDomain(d)}
                      className="p-1.5 text-rose-500 border border-rose-200 rounded-lg hover:bg-rose-50"
                      title="Remove domain"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function MemberRow({
  member, onApprove, onBlock, onUnblock, onSetModules, onRemove,
}: {
  member: AppMember;
  onApprove: () => void;
  onBlock: () => void;
  onUnblock: () => void;
  onSetModules: (next: string[]) => void;
  onRemove: () => void;
}) {
  const isAdmin = member.plan === 'admin';
  const modules = Array.isArray(member.modules) ? member.modules : [];

  function toggle(key: string) {
    onSetModules(modules.includes(key) ? modules.filter(k => k !== key) : [...modules, key]);
  }

  return (
    <div className="border border-slate-200 rounded-xl px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">{member.email}</p>
          <StatusBadge status={member.status} />
          {isAdmin && (
            <span className="ml-2 inline-block text-[11px] font-medium border rounded-full px-2 py-0.5 text-amber-700 bg-amber-50 border-amber-200">
              admin
            </span>
          )}
        </div>

        {member.status === 'pending' && (
          <button
            onClick={onApprove}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100"
          >
            <Check className="w-3.5 h-3.5" /> Approve
          </button>
        )}

        {!isAdmin && (
          <>
            {member.status !== 'blocked' ? (
              <button
                onClick={onBlock}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Block
              </button>
            ) : (
              <button
                onClick={onUnblock}
                className="px-2.5 py-1.5 text-xs font-medium text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50"
              >
                Unblock
              </button>
            )}
            <button
              onClick={onRemove}
              className="p-1.5 text-rose-500 border border-rose-200 rounded-lg hover:bg-rose-50"
              title="Remove member"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {!isAdmin && (
        <details className="mt-2 group">
          <summary className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 cursor-pointer list-none select-none hover:text-slate-800">
            <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" />
            Areas ({modules.length}/{ALL_MODULE_KEYS.length})
          </summary>
          <div className="mt-2">
            <ModuleChecklist values={modules} onToggle={toggle} />
          </div>
        </details>
      )}
    </div>
  );
}

function ModuleChecklist({ values, onToggle }: { values: string[]; onToggle: (key: string) => void }) {
  const selected = new Set(values);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
      {GATED_MODULES.map(m => {
        const on = selected.has(m.key);
        return (
          <label
            key={m.key}
            className={`flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer select-none ${
              on
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <input
              type="checkbox"
              checked={on}
              onChange={() => onToggle(m.key)}
              className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
            />
            <span className="truncate">{m.label}</span>
          </label>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: MemberStatus }) {
  const styles: Record<MemberStatus, string> = {
    active: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    pending: 'text-amber-700 bg-amber-50 border-amber-200',
    blocked: 'text-rose-700 bg-rose-50 border-rose-200',
  };
  return (
    <span className={`inline-block mt-0.5 text-[11px] font-medium border rounded-full px-2 py-0.5 ${styles[status]}`}>
      {status}
    </span>
  );
}

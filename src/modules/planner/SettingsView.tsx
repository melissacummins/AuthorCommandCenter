import { useState, type ReactNode } from 'react';
import { Settings as SettingsIcon, Compass, Sparkles } from 'lucide-react';
import { plannerComplete } from './ai';
import {
  PHASES, phaseInfo, daysBetweenISO, formatMinutes,
  type PlannerSettings, type WorkingPhase,
} from './types';

// One central place for the planner's preferences: daily capacity, the two
// automations (carry-over + roll-over), and the Working Phases strategy.
export default function SettingsView({
  settings, today, onUpdate,
}: {
  settings: PlannerSettings;
  today: string;
  onUpdate: (patch: Partial<PlannerSettings>) => void;
}) {
  const baseline = settings.daily_capacity_minutes;
  const [hours, setHours] = useState((baseline / 60).toString());
  const [goal, setGoal] = useState(settings.daily_goal_count != null ? String(settings.daily_goal_count) : '');

  function commitHours() {
    const h = parseFloat(hours);
    if (!isNaN(h) && h > 0) onUpdate({ daily_capacity_minutes: Math.round(h * 60) });
    else setHours((baseline / 60).toString());
  }

  function commitGoal() {
    if (goal.trim() === '') { onUpdate({ daily_goal_count: null }); return; }
    const n = parseInt(goal, 10);
    if (!isNaN(n) && n > 0) onUpdate({ daily_goal_count: n });
    else setGoal(settings.daily_goal_count != null ? String(settings.daily_goal_count) : '');
  }

  function pickPhase(id: WorkingPhase) {
    // Entering a different phase resets the "day N" clock; re-picking the same
    // one is a no-op so the start date is preserved.
    if (id === settings.working_phase) return;
    onUpdate({ working_phase: id, phase_started_on: today });
  }

  const phase = settings.working_phase;
  const daysIn = phase && settings.phase_started_on ? Math.max(0, daysBetweenISO(settings.phase_started_on, today)) : 0;

  return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <SettingsIcon className="w-6 h-6 text-slate-500" />
        <h2 className="text-2xl font-bold text-slate-800">Settings</h2>
      </div>

      {/* Daily capacity */}
      <Section title="Daily capacity" hint="Your typical focus-time target — what My Day measures the day's plan against, and the baseline your Working Phase scales from.">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="number"
            min="0.5"
            step="0.5"
            value={hours}
            onChange={e => setHours(e.target.value)}
            onBlur={commitHours}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className="w-20 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5"
          />
          <span className="text-slate-500">hours per day</span>
        </label>
      </Section>

      {/* Daily goal */}
      <Section title="Daily goal" hint="How many to-dos you're aiming to finish in a day. My Day fills a progress bar toward it and cheers when you hit it. Leave blank to turn it off.">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="number"
            min="1"
            step="1"
            placeholder="off"
            value={goal}
            onChange={e => setGoal(e.target.value)}
            onBlur={commitGoal}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className="w-20 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5"
          />
          <span className="text-slate-500">to-dos per day</span>
        </label>
      </Section>

      {/* Automations */}
      <Section title="Automations">
        <Toggle
          label="Carry over yesterday's overage"
          hint="If yesterday ran over its target, lower today's target by that overage (rounded to the nearest hour)."
          checked={settings.carry_over_capacity}
          onChange={v => onUpdate({ carry_over_capacity: v })}
        />
        <Toggle
          label="Roll over unfinished to-dos"
          hint="Scheduled to-dos you didn't finish move forward to today instead of piling up as Overdue."
          checked={settings.auto_rollover}
          onChange={v => onUpdate({ auto_rollover: v })}
        />
        <Toggle
          label="Orbit"
          hint="A staging area for what's currently relevant. Star to-dos into Orbit from any list; they surface first in Focus and are easy to pull into your day. Adds an Orbit view to the rail."
          checked={settings.orbit_enabled}
          onChange={v => onUpdate({ orbit_enabled: v })}
        />
      </Section>

      {/* Working Phases */}
      <Section
        title={<span className="flex items-center gap-1.5"><Compass className="w-4 h-4 text-slate-400" /> Working Phase</span>}
        hint="Seasons of work, not a ladder — you move between them fluidly. Name the one you're actually in, and My Day sizes the day to match (and nudges you when your plan outruns it)."
      >
        <div className="space-y-2">
          {PHASES.map(p => {
            const active = phase === p.id;
            const proposed = p.proposed(baseline, active ? daysIn : 0);
            return (
              <button
                key={p.id}
                onClick={() => pickPhase(p.id)}
                className={`w-full text-left rounded-xl border p-3 transition-colors ${
                  active ? 'border-slate-800 bg-slate-50 ring-1 ring-slate-800' : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${p.dot} shrink-0`} />
                  <span className={`font-semibold ${p.accent}`}>{p.label}</span>
                  <span className="ml-auto text-xs font-medium text-slate-500">
                    suggests {formatMinutes(proposed)}/day
                  </span>
                </div>
                <p className="text-sm text-slate-600 mt-1">{p.tagline}</p>
                <p className="text-xs text-slate-400 mt-1"><span className="font-medium text-slate-500">When:</span> {p.appropriateWhen}</p>
                {p.watchFor && <p className="text-xs text-amber-600 mt-1"><span className="font-medium">Watch for:</span> {p.watchFor}</p>}
                {active && settings.phase_started_on && (
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    Day {daysIn + 1} in {p.label}{p.id === 'recovery' ? ' — easing up gently.' : '.'}
                  </p>
                )}
              </button>
            );
          })}
        </div>
        {phase ? (
          <button onClick={() => onUpdate({ working_phase: null, phase_started_on: null })}
            className="mt-3 text-xs font-medium text-slate-400 hover:text-slate-600">
            Turn off Working Phases
          </button>
        ) : (
          <p className="mt-2 text-xs text-slate-400">Off — My Day uses your plain daily capacity above.</p>
        )}
      </Section>

      {/* AI (preview) */}
      <Section
        title={<span className="flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-violet-400" /> AI assistant</span>}
        hint="Coming online: free-day suggestions, smart Orbit picks, and phase triage. They run through a server-side endpoint that holds your Claude key. Once ANTHROPIC_API_KEY is set in Vercel, test the connection here."
      >
        <AiTest />
      </Section>
    </div>
  );
}

function AiTest() {
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function run() {
    setState('loading'); setMessage('');
    try {
      const text = await plannerComplete({
        prompt: 'Reply with a single short, warm one-line check-in for someone planning their day.',
        maxTokens: 64,
      });
      setState('ok'); setMessage(text || 'Connected.');
    } catch (e) {
      setState('error'); setMessage((e as Error)?.message ?? 'Failed.');
    }
  }

  return (
    <div>
      <button
        onClick={run}
        disabled={state === 'loading'}
        className="text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-60 rounded-lg px-3 py-1.5"
      >
        {state === 'loading' ? 'Testing…' : 'Test connection'}
      </button>
      {message && (
        <p className={`text-xs mt-2 leading-relaxed ${state === 'error' ? 'text-rose-600' : 'text-slate-500'}`}>
          {state === 'ok' && <span className="font-medium text-emerald-600">✓ Connected — </span>}
          {message}
        </p>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-4">
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      {hint && <p className="text-xs text-slate-400 mt-1 mb-3 leading-relaxed">{hint}</p>}
      <div className={hint ? '' : 'mt-3'}>{children}</div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 py-2 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 relative w-9 h-5 rounded-full transition-colors shrink-0 ${checked ? 'bg-teal-600' : 'bg-slate-200'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </button>
      <span>
        <span className="block text-sm text-slate-700">{label}</span>
        {hint && <span className="block text-xs text-slate-400 mt-0.5 leading-relaxed">{hint}</span>}
      </span>
    </label>
  );
}

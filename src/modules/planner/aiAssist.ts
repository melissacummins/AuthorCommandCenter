// Shared planning-assist layer. Each function gathers a compact slice of the
// user's to-dos, asks Claude (via plannerComplete) for a realistic, gentle
// plan as STRICT JSON, and parses it defensively back into AiResult. The host
// components own the loading/error/result state and apply the picks.
import { plannerComplete } from './ai';
import {
  addDaysISO, formatMinutes, phaseInfo,
  type PlannerNote, type PlannerSettings, type PlannerTask,
} from './types';

// One suggested move: a task id, a short human reason, and (for day/triage) the
// date to schedule it on — null when the suggestion isn't about a date (Orbit).
export interface AiSuggestion {
  id: string;
  reason: string;
  date: string | null;
}

export interface AiResult {
  summary: string;
  suggestions: AiSuggestion[];
}

// Shared system instruction: warm, realistic, JSON-only.
const SYSTEM =
  'You are a warm, pragmatic planning assistant for an indie author. Be realistic and gentle — never overload a day. '
  + 'Respond with ONLY a JSON object, no prose, no markdown fences, matching: '
  + '{"summary": string, "suggestions": [{"id": string, "reason": string, "date": string|null}]}. '
  + 'Use only ids from the provided list. `date` is YYYY-MM-DD or null.';

// One candidate task per line, compact and id-prefixed so Claude can refer back
// to it: `- [id] "title" · est 30m · List name · due 2026-06-09 · flagged`.
function serializeTask(task: PlannerTask, notesById: Record<string, PlannerNote>): string {
  const est = task.estimate_minutes ? formatMinutes(task.estimate_minutes) : 'unknown';
  const list = task.note_id ? (notesById[task.note_id]?.title.trim() || 'Untitled list') : 'no list';
  const due = task.due_date ?? 'none';
  const flag = task.flagged ? ' · flagged' : '';
  return `- [${task.id}] "${task.title || 'Untitled'}" · est ${est} · ${list} · due ${due}${flag}`;
}

// The shared preamble every prompt opens with: today, capacity, phase.
function contextHeader(settings: PlannerSettings, today: string): string {
  const lines = [`Today is ${today}.`, `Daily capacity: ${formatMinutes(settings.daily_capacity_minutes) || 'unset'}.`];
  if (settings.working_phase) {
    const p = phaseInfo(settings.working_phase);
    lines.push(`Current Working Phase: ${p.label} — ${p.tagline}`);
  }
  return lines.join('\n');
}

// Strip fences, slice to the JSON object, parse, validate, and drop any
// suggestion whose id isn't a real candidate. Throws a friendly error on junk.
function parseResult(raw: string, candidateIds: Set<string>): AiResult {
  const stripped = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) {
    throw new Error('The AI returned an unexpected response — try again.');
  }
  let data: unknown;
  try {
    data = JSON.parse(stripped.slice(first, last + 1));
  } catch {
    throw new Error('The AI returned an unexpected response — try again.');
  }
  if (!data || typeof data !== 'object') {
    throw new Error('The AI returned an unexpected response — try again.');
  }
  const obj = data as { summary?: unknown; suggestions?: unknown };
  const summary = typeof obj.summary === 'string' ? obj.summary : '';
  const rawSuggestions = Array.isArray(obj.suggestions) ? obj.suggestions : [];
  const suggestions: AiSuggestion[] = [];
  for (const s of rawSuggestions) {
    if (!s || typeof s !== 'object') continue;
    const cand = s as { id?: unknown; reason?: unknown; date?: unknown };
    if (typeof cand.id !== 'string' || !candidateIds.has(cand.id)) continue;
    suggestions.push({
      id: cand.id,
      reason: typeof cand.reason === 'string' ? cand.reason : '',
      date: typeof cand.date === 'string' ? cand.date : null,
    });
  }
  return { summary, suggestions };
}

// Run a prompt and parse it against the candidate set in one place.
async function ask(prompt: string, candidates: PlannerTask[]): Promise<AiResult> {
  const text = await plannerComplete({ prompt, system: SYSTEM });
  return parseResult(text, new Set(candidates.map(t => t.id)));
}

// 1. Suggest my day — pick a realistic set to do TODAY within capacity & phase.
// Candidates: open tasks that are Anytime, in Orbit, or due today but not yet
// done — excluding anything already scheduled for another day.
export async function suggestDayPlan(
  tasks: PlannerTask[],
  settings: PlannerSettings,
  today: string,
  notesById: Record<string, PlannerNote> = {},
): Promise<AiResult> {
  const candidates = tasks.filter(t => {
    if (t.kind !== 'task' || t.done) return false;
    const anytime = !t.someday && t.due_date == null;
    const scheduledToday = !t.someday && t.due_date === today;
    return anytime || t.in_orbit || scheduledToday;
  });
  const prompt = [
    contextHeader(settings, today),
    '',
    'From the candidate to-dos below, choose a realistic set to do TODAY — fitting within the daily capacity and honoring the current Working Phase. Never overload the day.',
    'For each chosen to-do, set `date` to today\'s date. `summary` is one encouraging sentence.',
    '',
    'Candidates:',
    candidates.map(t => serializeTask(t, notesById)).join('\n') || '(none)',
  ].join('\n');
  return ask(prompt, candidates);
}

// 2. Phase triage — spread overdue + today + anytime tasks gently across the
// next 5 days (today..today+4), easing up especially in Recovery.
export async function suggestPhaseTriage(
  tasks: PlannerTask[],
  settings: PlannerSettings,
  today: string,
  notesById: Record<string, PlannerNote> = {},
): Promise<AiResult> {
  const candidates = tasks.filter(t => {
    if (t.kind !== 'task' || t.done) return false;
    const overdue = t.due_date != null && t.due_date < today;
    const dueToday = t.due_date === today;
    const anytime = !t.someday && t.due_date == null;
    return overdue || dueToday || anytime;
  });
  const last = addDaysISO(today, 4);
  const recovery = settings.working_phase === 'recovery';
  const prompt = [
    contextHeader(settings, today),
    '',
    `Spread these to-dos gently across the next 5 days (${today} through ${last}), respecting the daily capacity each day. Don't cram any single day.`,
    recovery
      ? 'The user is in Recovery — ease up hard: only a little per day, and it\'s fine to leave some unscheduled.'
      : 'Lean toward fewer items per day rather than more.',
    'For each to-do, set `date` to the assigned day (YYYY-MM-DD within that window). `summary` is one sentence on the approach.',
    '',
    'Candidates:',
    candidates.map(t => serializeTask(t, notesById)).join('\n') || '(none)',
  ].join('\n');
  return ask(prompt, candidates);
}

// 3. Smart Orbit picks — which 3–7 open, not-yet-orbiting tasks are most worth
// pulling into Orbit right now. `date` is always null here.
export async function suggestOrbitPicks(
  tasks: PlannerTask[],
  settings: PlannerSettings,
  today: string,
  notesById: Record<string, PlannerNote> = {},
): Promise<AiResult> {
  const candidates = tasks.filter(t => t.kind === 'task' && !t.done && !t.in_orbit);
  const prompt = [
    contextHeader(settings, today),
    '',
    'From the candidates below, pick the 3–7 to-dos most worth pulling into Orbit (currently relevant) right now — imminent due dates, momentum on something in progress, and things that pair well together.',
    'Set every `date` to null. `summary` is one sentence.',
    '',
    'Candidates:',
    candidates.map(t => serializeTask(t, notesById)).join('\n') || '(none)',
  ].join('\n');
  return ask(prompt, candidates);
}

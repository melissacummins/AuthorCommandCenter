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
  + 'Use only ids from the provided list. `date` is YYYY-MM-DD or null. '
  + 'Keep each reason to a short phrase (8 words max) and the summary to one sentence, so the JSON stays compact.';

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

// Pull valid suggestions out of a parsed array, dropping any whose id isn't a
// real candidate (guards against a hallucinated id acting on the wrong task).
function coerceSuggestions(arr: unknown, candidateIds: Set<string>): AiSuggestion[] {
  const out: AiSuggestion[] = [];
  if (!Array.isArray(arr)) return out;
  for (const s of arr) {
    if (!s || typeof s !== 'object') continue;
    const cand = s as { id?: unknown; reason?: unknown; date?: unknown };
    if (typeof cand.id !== 'string' || !candidateIds.has(cand.id)) continue;
    out.push({
      id: cand.id,
      reason: typeof cand.reason === 'string' ? cand.reason : '',
      date: typeof cand.date === 'string' ? cand.date : null,
    });
  }
  return out;
}

// Parse Claude's reply into AiResult. Tries the whole JSON object first; if that
// fails — most often because a long list hit the output-token cap and the JSON
// is truncated mid-array — it salvages whatever complete suggestion objects it
// can rather than discarding the whole reply. Only throws if nothing is usable.
function parseResult(raw: string, candidateIds: Set<string>): AiResult {
  const stripped = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');

  // Happy path: a complete JSON object.
  if (first !== -1 && last > first) {
    try {
      const data = JSON.parse(stripped.slice(first, last + 1)) as { summary?: unknown; suggestions?: unknown };
      if (data && typeof data === 'object') {
        return {
          summary: typeof data.summary === 'string' ? data.summary : '',
          suggestions: coerceSuggestions(data.suggestions, candidateIds),
        };
      }
    } catch {
      // fall through to salvage
    }
  }

  // Salvage path: grab the summary and every complete {…} suggestion object that
  // survived truncation. Our suggestion objects are flat (no nested braces).
  const summaryMatch = stripped.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const summary = summaryMatch ? summaryMatch[1] : '';
  const salvaged: unknown[] = [];
  for (const chunk of stripped.match(/\{[^{}]*\}/g) ?? []) {
    try { salvaged.push(JSON.parse(chunk)); } catch { /* skip an incomplete object */ }
  }
  const suggestions = coerceSuggestions(salvaged, candidateIds);
  if (suggestions.length === 0) {
    throw new Error('The AI returned an unexpected response — try again.');
  }
  return { summary, suggestions };
}

// Run a prompt and parse it against the candidate set in one place. Requests
// generous headroom so longer lists (esp. Catch up) don't get truncated.
async function ask(prompt: string, candidates: PlannerTask[]): Promise<AiResult> {
  const text = await plannerComplete({ prompt, system: SYSTEM, maxTokens: 4096 });
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

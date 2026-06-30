// Shared planning-assist layer. Each function gathers a compact slice of the
// user's to-dos, asks Claude (via plannerComplete) for a realistic, gentle
// plan as STRICT JSON, and parses it defensively back into AiResult. The host
// components own the loading/error/result state and apply the picks.
import { plannerComplete, type PlannerImage } from './ai';
import {
  addDaysISO, formatMinutes, phaseInfo,
  type PlannerNote, type PlannerSettings, type PlannerTask,
  type ResetTranscription, type ResetDraftItem,
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

// 4. Weekly Reset transcription — read photo(s) of a handwritten weekly reset
// and return its sections as structured JSON. Reflective sections come back as
// prose; actionable sections as item lists. Anything guessed is flagged
// `uncertain` so the user can confirm it before it becomes a to-do.
const RESET_SYSTEM =
  'You transcribe photos of a handwritten WEEKLY RESET planning page into JSON. '
  + 'Respond with ONLY a JSON object — no prose, no markdown fences — matching exactly: '
  + '{"wins": string, "not_done": string, "drained": string, "feel_more": string, '
  + '"brain_dump": [{"text": string, "uncertain": boolean}], '
  + '"priorities": [{"text": string, "estimate_minutes": number|null, "uncertain": boolean}], '
  + '"feel_good": [{"text": string, "uncertain": boolean}], '
  + '"quick": [{"text": string, "estimate_minutes": number|null, "uncertain": boolean}], '
  + '"meetings": [{"text": string, "date": string|null, "uncertain": boolean}]}. '
  + 'Match the page\'s sections by MEANING, not exact wording. Reflective sections (wins from last week; what I '
  + 'did not do; what drained my time; what I want to feel more of) are prose strings — preserve line breaks with \\n. '
  + 'Actionable sections are item lists: brain dump, priorities, quick tasks, and "what would make me feel good" '
  + '(fold any "things weighing on me" into feel_good). Meetings get a "date" as YYYY-MM-DD only if one is written '
  + '(use the current year if the year is omitted), else null. Put a duration in estimate_minutes only if written. '
  + 'Set "uncertain": true for any item or word you had to guess from unclear handwriting. Omit sections that are '
  + 'absent (empty string or empty array). Transcribe faithfully; do not invent items.';

function asStr(v: unknown): string { return typeof v === 'string' ? v : ''; }

function asItems(v: unknown): ResetDraftItem[] {
  if (!Array.isArray(v)) return [];
  const out: ResetDraftItem[] = [];
  for (const it of v) {
    if (typeof it === 'string') { if (it.trim()) out.push({ text: it.trim() }); continue; }
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const text = asStr(o.text).trim();
    if (!text) continue;
    out.push({
      text,
      estimate_minutes: typeof o.estimate_minutes === 'number' && o.estimate_minutes > 0 ? Math.round(o.estimate_minutes) : null,
      date: typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null,
      uncertain: !!o.uncertain,
    });
  }
  return out;
}

export async function transcribeWeeklyReset(images: PlannerImage[]): Promise<ResetTranscription> {
  const prompt = 'Transcribe this handwritten weekly reset into the required JSON. '
    + 'If multiple photos are attached, they are pages of the same reset — merge them.';
  const text = await plannerComplete({ prompt, system: RESET_SYSTEM, images, maxTokens: 4096 });
  const stripped = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  if (first === -1 || last <= first) throw new Error('Couldn’t read that photo — try a clearer, flatter, well-lit picture.');
  let data: Record<string, unknown>;
  try { data = JSON.parse(stripped.slice(first, last + 1)) as Record<string, unknown>; }
  catch { throw new Error('Couldn’t read that photo — try a clearer, flatter, well-lit picture.'); }
  return {
    wins: asStr(data.wins), not_done: asStr(data.not_done), drained: asStr(data.drained), feel_more: asStr(data.feel_more),
    brain_dump: asItems(data.brain_dump), priorities: asItems(data.priorities),
    feel_good: asItems(data.feel_good), quick: asItems(data.quick), meetings: asItems(data.meetings),
  };
}

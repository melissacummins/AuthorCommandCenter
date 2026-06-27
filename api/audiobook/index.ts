// Audiobook endpoint (bring-your-own-key). One Vercel function, action-routed,
// because deployments cap the number of serverless functions and we're near it
// (same reason api/media/key.ts and api/planner/ai.ts fold many routes into one
// file).
//
// It does five things on the caller's behalf, all using *their* keys so usage is
// billed to them, never to the platform:
//   • manages the user's encrypted ElevenLabs key (action=key)
//   • lists their ElevenLabs voices            (action=voices)
//   • designs a brand-new voice from a text description (action=design / design-save)
//   • clones a voice from uploaded audio        (action=clone)
//   • attributes a manuscript chunk to speakers with Claude (action=attribute)
//   • renders one segment to speech             (action=render)
//
// Routes (all require the caller's Supabase bearer token):
//   GET    /api/audiobook?action=key                 — { has_key, hint, updated_at }
//   POST   /api/audiobook?action=key    { key }      — encrypt + store the user's key
//   DELETE /api/audiobook?action=key                 — remove the user's key
//   GET    /api/audiobook?action=voices              — { voices: [{ voice_id, name, gender, … }] }
//   POST   /api/audiobook?action=design  { voice_description, text? }
//                                                    — { previews: [{ generated_voice_id, audio_base64, media_type }], text }
//   POST   /api/audiobook?action=design-save { voice_name, voice_description, generated_voice_id }
//                                                    — { voice_id, name }
//   POST   /api/audiobook?action=clone   { name, description?, samples: [{ filename, content_type, base64 }] }
//                                                    — { voice_id, name }
//   POST   /api/audiobook?action=attribute { text, mode } — { segments: [{ speaker, character_name, text }] }
//   POST   /api/audiobook?action=render  { voice_id, text, model_id?, voice_settings?, output_format? }
//                                                    — { audio_base64, content_type }
//
// Required env vars on Vercel:
//   ELEVENLABS_KEY_ENCRYPTION_SECRET - random 32+ char secret (encrypts the stored ElevenLabs key)
//   ANTHROPIC_KEY_ENCRYPTION_SECRET  - same secret the planner uses (decrypts the user's Claude key for attribution)
//   SUPABASE_URL                     - same as VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY        - server-side only, verifies the caller
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
  url?: string;
};
type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  end: () => void;
};

const ELEVEN_BASE = 'https://api.elevenlabs.io';

// ElevenLabs key — its own table + encryption secret.
const ELEVEN_KEY_TABLE = 'user_elevenlabs_keys';
const ELEVEN_KEY_SALT = 'audiobook-elevenlabs-key-v1';

// Anthropic key — reuse exactly what the planner stores so the user only enters
// their Claude key once. Salt + secret MUST match api/planner/ai.ts.
const ANTHROPIC_KEY_TABLE = 'user_anthropic_keys';
const ANTHROPIC_KEY_SALT = 'planner-anthropic-key-v1';

const ATTRIBUTION_MODEL = 'claude-sonnet-4-6';
const ATTRIBUTION_MAX_TOKENS = 8000;

function bearer(req: VercelRequest): string | null {
  const raw = req.headers['authorization'] ?? req.headers['Authorization'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !v.toLowerCase().startsWith('bearer ')) return null;
  return v.slice(7);
}

function queryParam(req: VercelRequest, name: string): string | null {
  const v = req.query?.[name];
  if (Array.isArray(v)) return v[0] ?? null;
  if (typeof v === 'string') return v;
  if (req.url) {
    try { return new URL(req.url, 'http://placeholder.local').searchParams.get(name); } catch { /* ignore */ }
  }
  return null;
}

function parseBody<T>(req: VercelRequest): T {
  try { return (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as T; }
  catch { return {} as T; }
}

function deriveKey(secret: string, salt: string): Buffer { return scryptSync(secret, salt, 32); }

function encryptKey(plain: string, secret: string, salt: string): { encrypted: string; nonce: string; authTag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { encrypted: ciphertext.toString('base64'), nonce: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
}

function decryptKey(row: { encrypted_key: string; nonce: string; auth_tag: string }, secret: string, salt: string): string | null {
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret, salt), Buffer.from(row.nonce, 'base64'));
    decipher.setAuthTag(Buffer.from(row.auth_tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(row.encrypted_key, 'base64')), decipher.final()]).toString('utf8');
  } catch { return null; }
}

async function resolveStoredKey(supabase: SupabaseClient, table: string, userId: string, secret: string, salt: string): Promise<string | null> {
  const { data } = await supabase.from(table).select('encrypted_key, nonce, auth_tag').eq('user_id', userId).maybeSingle();
  if (!data?.encrypted_key || !data.nonce || !data.auth_tag) return null;
  return decryptKey(data, secret, salt);
}

// ---- ElevenLabs helpers ----------------------------------------------------

function elevenHeaders(apiKey: string, extra: Record<string, string> = {}): Record<string, string> {
  return { 'xi-api-key': apiKey, ...extra };
}

// Maps an ElevenLabs error into a caller-friendly message. 401 means the stored
// key is bad/revoked, so we surface it as a 400 the UI can act on.
function elevenError(status: number, detail: string): { status: number; body: { error: string; detail?: string } } {
  if (status === 401) return { status: 400, body: { error: 'Your ElevenLabs key was rejected — check it in Settings → API Keys.' } };
  return { status: 502, body: { error: `ElevenLabs request failed (${status}).`, detail: detail.slice(0, 500) } };
}

// ---- Claude speaker attribution -------------------------------------------

const ATTRIBUTION_SYSTEM = [
  'You are an expert audiobook casting director performing speaker attribution on a manuscript excerpt.',
  'Split the text into an ordered list of segments. Each segment is a contiguous span of the ORIGINAL text assigned to exactly one speaker.',
  "Speakers: 'narrator' for narration, description, action, and dialogue tags (he said, she whispered);",
  "'male' for words actually spoken aloud by a male character; 'female' for words spoken aloud by a female character.",
  'Rules:',
  '- Preserve the original wording and order exactly. Concatenating every segment text in order must reproduce the input (whitespace may be normalized).',
  '- When narration and quoted dialogue alternate inside one paragraph, split them: the quoted dialogue becomes its own male/female segment while the surrounding narration and the dialogue tag stay "narrator".',
  '- Infer each speaker\'s gender from names, pronouns, and context. If a spoken line\'s speaker gender is genuinely ambiguous, label it "narrator".',
  '- Set "character_name" to the speaker\'s name when you can identify it, otherwise null.',
  'Return ONLY a JSON object of the form {"segments":[{"speaker":"narrator|male|female","character_name":string|null,"text":string}]} with no commentary and no code fences.',
].join('\n');

interface AttributedSegment { speaker: 'narrator' | 'male' | 'female'; character_name: string | null; text: string }

function coerceSegments(raw: string, fallbackText: string): AttributedSegment[] {
  // Strip code fences and isolate the outermost JSON object.
  let s = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  try {
    const parsed = JSON.parse(s) as { segments?: unknown };
    const list = Array.isArray(parsed.segments) ? parsed.segments : [];
    const out: AttributedSegment[] = [];
    for (const item of list) {
      const seg = item as Record<string, unknown>;
      const text = typeof seg.text === 'string' ? seg.text : '';
      if (!text.trim()) continue;
      const speaker = seg.speaker === 'male' || seg.speaker === 'female' ? seg.speaker : 'narrator';
      const name = typeof seg.character_name === 'string' && seg.character_name.trim() ? seg.character_name.trim() : null;
      out.push({ speaker, character_name: name, text });
    }
    if (out.length) return out;
  } catch { /* fall through */ }
  // If Claude returned something unparseable, fail soft: one narrator segment so
  // the user still gets their text back and can re-run or hand-correct.
  return [{ speaker: 'narrator', character_name: null, text: fallbackText }];
}

// ---- Claude chapter scan ---------------------------------------------------

const CHAPTERS_SYSTEM = [
  'You split a book manuscript into chapters.',
  'Return ONLY a JSON object: {"chapters":[{"title":string,"first_line":string}]}.',
  '- One entry per chapter, in reading order.',
  '- "title" is the chapter\'s title. Use the manuscript\'s own heading (e.g. "Chapter One", "Prologue") when present; otherwise infer a short, sensible title.',
  '- "first_line" is the EXACT verbatim text (copied character-for-character, ~5 to 15 words) of where that chapter begins in the manuscript — including the heading line if there is one. It must appear verbatim in the text so it can be located.',
  '- Cover the whole manuscript in order; do not skip chapters or invent text.',
  'No commentary, no code fences.',
].join('\n');

interface ChapterMarker { title: string; first_line: string }

function coerceChapterMarkers(raw: string): ChapterMarker[] {
  let s = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  try {
    const parsed = JSON.parse(s) as { chapters?: unknown };
    const list = Array.isArray(parsed.chapters) ? parsed.chapters : [];
    const out: ChapterMarker[] = [];
    for (const item of list) {
      const c = item as Record<string, unknown>;
      const firstLine = typeof c.first_line === 'string' ? c.first_line : '';
      if (!firstLine.trim()) continue;
      out.push({ title: typeof c.title === 'string' ? c.title : '', first_line: firstLine });
    }
    return out;
  } catch { return []; }
}

// ---- Handler ---------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const elevenSecret = process.env.ELEVENLABS_KEY_ENCRYPTION_SECRET;
  if (!supabaseUrl || !serviceKey || !elevenSecret) {
    res.status(500).json({ error: 'Service not configured (missing ELEVENLABS_KEY_ENCRYPTION_SECRET, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY).' });
    return;
  }
  if (elevenSecret.length < 32) { res.status(500).json({ error: 'ELEVENLABS_KEY_ENCRYPTION_SECRET must be at least 32 characters.' }); return; }

  const token = bearer(req);
  if (!token) { res.status(401).json({ error: 'Missing authorization.' }); return; }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) { res.status(401).json({ error: 'Invalid session.' }); return; }
  const userId = userData.user.id;

  const action = queryParam(req, 'action') ?? '';

  // ---- Key management (action=key) ----
  if (action === 'key') {
    if (req.method === 'GET') {
      const { data } = await supabase.from(ELEVEN_KEY_TABLE).select('key_hint, updated_at').eq('user_id', userId).maybeSingle();
      res.status(200).json({ has_key: !!data, hint: data?.key_hint ?? null, updated_at: data?.updated_at ?? null });
      return;
    }
    if (req.method === 'DELETE') {
      await supabase.from(ELEVEN_KEY_TABLE).delete().eq('user_id', userId);
      res.status(200).json({ ok: true });
      return;
    }
    if (req.method === 'POST') {
      const rawKey = (() => { const b = parseBody<{ key?: unknown }>(req); return typeof b.key === 'string' ? b.key.trim() : ''; })();
      if (rawKey.length < 20) {
        res.status(400).json({ error: 'That key looks too short — paste the full ElevenLabs API key from elevenlabs.io → Profile → API Keys.' });
        return;
      }
      const { encrypted, nonce, authTag } = encryptKey(rawKey, elevenSecret, ELEVEN_KEY_SALT);
      const hint = `…${rawKey.slice(-4)}`;
      const { error: upErr } = await supabase.from(ELEVEN_KEY_TABLE).upsert({
        user_id: userId, encrypted_key: encrypted, nonce, auth_tag: authTag, key_hint: hint, updated_at: new Date().toISOString(),
      });
      if (upErr) { res.status(500).json({ error: 'Failed to save key.', detail: upErr.message }); return; }
      res.status(200).json({ ok: true, hint });
      return;
    }
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  // ---- AI speaker attribution (action=attribute) — uses the user's Claude key ----
  if (action === 'attribute') {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
    const anthropicSecret = process.env.ANTHROPIC_KEY_ENCRYPTION_SECRET;
    if (!anthropicSecret || anthropicSecret.length < 32) {
      res.status(500).json({ error: 'AI attribution not configured (missing ANTHROPIC_KEY_ENCRYPTION_SECRET).' });
      return;
    }
    const apiKey = await resolveStoredKey(supabase, ANTHROPIC_KEY_TABLE, userId, anthropicSecret, ANTHROPIC_KEY_SALT);
    if (!apiKey) {
      res.status(412).json({ error: 'No Claude API key on file — add yours in Settings → API Keys to let AI tag who speaks each line.' });
      return;
    }
    const body = parseBody<{ text?: string; mode?: string }>(req);
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) { res.status(400).json({ error: 'Missing text to analyze.' }); return; }
    const modeNote = body.mode === 'duet'
      ? 'This is a two-voice "duet" reading. Narration will be read by one of the two voices, so still label narration as "narrator".'
      : 'This is a narrator-plus-two-voices reading.';
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: ATTRIBUTION_MODEL,
          max_tokens: ATTRIBUTION_MAX_TOKENS,
          system: ATTRIBUTION_SYSTEM,
          messages: [{ role: 'user', content: `${modeNote}\n\nManuscript excerpt:\n\n${text}` }],
        }),
      });
      if (!r.ok) {
        const detail = await r.text();
        const msg = r.status === 401
          ? 'Your Claude key was rejected — check it in Settings → API Keys.'
          : `Claude request failed (${r.status}).`;
        res.status(r.status === 401 ? 400 : 502).json({ error: msg, detail: detail.slice(0, 500) });
        return;
      }
      const data = (await r.json()) as { content?: Array<{ type: string; text?: string }> };
      const out = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim();
      res.status(200).json({ segments: coerceSegments(out, text) });
    } catch (e) {
      res.status(502).json({ error: (e as Error)?.message ?? 'Could not reach Claude.' });
    }
    return;
  }

  // ---- AI chapter scan (action=chapters) — uses the user's Claude key ----
  if (action === 'chapters') {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
    const anthropicSecret = process.env.ANTHROPIC_KEY_ENCRYPTION_SECRET;
    if (!anthropicSecret || anthropicSecret.length < 32) {
      res.status(500).json({ error: 'AI chapter scan not configured (missing ANTHROPIC_KEY_ENCRYPTION_SECRET).' });
      return;
    }
    const apiKey = await resolveStoredKey(supabase, ANTHROPIC_KEY_TABLE, userId, anthropicSecret, ANTHROPIC_KEY_SALT);
    if (!apiKey) {
      res.status(412).json({ error: 'No Claude API key on file — add yours in Settings → API Keys to scan chapters with AI.' });
      return;
    }
    const body = parseBody<{ text?: string }>(req);
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) { res.status(400).json({ error: 'Missing manuscript text.' }); return; }
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: ATTRIBUTION_MODEL,
          max_tokens: ATTRIBUTION_MAX_TOKENS,
          system: CHAPTERS_SYSTEM,
          messages: [{ role: 'user', content: `Manuscript:\n\n${text}` }],
        }),
      });
      if (!r.ok) {
        const detail = await r.text();
        const msg = r.status === 401 ? 'Your Claude key was rejected — check it in Settings → API Keys.' : `Claude request failed (${r.status}).`;
        res.status(r.status === 401 ? 400 : 502).json({ error: msg, detail: detail.slice(0, 500) });
        return;
      }
      const data = (await r.json()) as { content?: Array<{ type: string; text?: string }> };
      const out = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim();
      res.status(200).json({ chapters: coerceChapterMarkers(out) });
    } catch (e) {
      res.status(502).json({ error: (e as Error)?.message ?? 'Could not reach Claude.' });
    }
    return;
  }

  // ---- Everything below needs the user's ElevenLabs key ----
  const elevenKey = await resolveStoredKey(supabase, ELEVEN_KEY_TABLE, userId, elevenSecret, ELEVEN_KEY_SALT);
  if (!elevenKey) {
    res.status(412).json({ error: 'No ElevenLabs API key on file — add yours in Settings → API Keys to use audiobook features.' });
    return;
  }

  try {
    // ---- List the user's voices (action=voices) ----
    if (action === 'voices') {
      if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed.' }); return; }
      const r = await fetch(`${ELEVEN_BASE}/v1/voices`, { headers: elevenHeaders(elevenKey) });
      if (!r.ok) { const e = elevenError(r.status, await r.text()); res.status(e.status).json(e.body); return; }
      const data = (await r.json()) as { voices?: Array<Record<string, unknown>> };
      const voices = (data.voices ?? []).map(v => {
        const labels = (v.labels as Record<string, string> | undefined) ?? {};
        return {
          voice_id: v.voice_id as string,
          name: (v.name as string) ?? 'Unnamed',
          category: (v.category as string) ?? null,
          gender: labels.gender ?? null,
          accent: labels.accent ?? null,
          age: labels.age ?? null,
          preview_url: (v.preview_url as string) ?? null,
        };
      });
      res.status(200).json({ voices });
      return;
    }

    // ---- Design previews from a description (action=design) ----
    if (action === 'design') {
      if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
      const body = parseBody<{ voice_description?: string; text?: string }>(req);
      const description = typeof body.voice_description === 'string' ? body.voice_description.trim() : '';
      if (description.length < 20) { res.status(400).json({ error: 'Describe the voice in at least 20 characters (e.g. age, gender, accent, tone).' }); return; }
      const payload: Record<string, unknown> = { voice_description: description };
      const preview = typeof body.text === 'string' ? body.text.trim() : '';
      if (preview.length >= 100) payload.text = preview; else payload.auto_generate_text = true;
      const r = await fetch(`${ELEVEN_BASE}/v1/text-to-voice/create-previews`, {
        method: 'POST', headers: elevenHeaders(elevenKey, { 'content-type': 'application/json' }), body: JSON.stringify(payload),
      });
      if (!r.ok) { const e = elevenError(r.status, await r.text()); res.status(e.status).json(e.body); return; }
      const data = (await r.json()) as { previews?: Array<Record<string, unknown>>; text?: string };
      const previews = (data.previews ?? []).map(p => ({
        generated_voice_id: p.generated_voice_id as string,
        audio_base64: (p.audio_base_64 as string) ?? (p.audio_base64 as string) ?? '',
        media_type: (p.media_type as string) ?? 'audio/mpeg',
      }));
      res.status(200).json({ previews, text: data.text ?? preview });
      return;
    }

    // ---- Save a chosen preview as a permanent voice (action=design-save) ----
    if (action === 'design-save') {
      if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
      const body = parseBody<{ voice_name?: string; voice_description?: string; generated_voice_id?: string }>(req);
      const voiceName = typeof body.voice_name === 'string' ? body.voice_name.trim() : '';
      const description = typeof body.voice_description === 'string' ? body.voice_description.trim() : '';
      const generatedId = typeof body.generated_voice_id === 'string' ? body.generated_voice_id : '';
      if (!voiceName || !generatedId || description.length < 20) {
        res.status(400).json({ error: 'Need a name, the chosen preview, and a 20+ character description to save the voice.' });
        return;
      }
      const r = await fetch(`${ELEVEN_BASE}/v1/text-to-voice/create-voice-from-preview`, {
        method: 'POST', headers: elevenHeaders(elevenKey, { 'content-type': 'application/json' }),
        body: JSON.stringify({ voice_name: voiceName, voice_description: description, generated_voice_id: generatedId }),
      });
      if (!r.ok) { const e = elevenError(r.status, await r.text()); res.status(e.status).json(e.body); return; }
      const data = (await r.json()) as { voice_id?: string; name?: string };
      res.status(200).json({ voice_id: data.voice_id, name: data.name ?? voiceName });
      return;
    }

    // ---- Clone a voice from uploaded samples (action=clone) ----
    if (action === 'clone') {
      if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
      const body = parseBody<{ name?: string; description?: string; samples?: Array<{ filename?: string; content_type?: string; base64?: string }> }>(req);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const samples = Array.isArray(body.samples) ? body.samples : [];
      if (!name) { res.status(400).json({ error: 'Give the cloned voice a name.' }); return; }
      if (!samples.length) { res.status(400).json({ error: 'Add at least one audio sample (1–2 minutes of clean speech works best).' }); return; }
      const form = new FormData();
      form.append('name', name);
      if (typeof body.description === 'string' && body.description.trim()) form.append('description', body.description.trim());
      for (const sample of samples) {
        if (!sample?.base64) continue;
        const bytes = Buffer.from(sample.base64, 'base64');
        const blob = new Blob([bytes], { type: sample.content_type || 'audio/mpeg' });
        form.append('files', blob, sample.filename || 'sample.mp3');
      }
      const r = await fetch(`${ELEVEN_BASE}/v1/voices/add`, { method: 'POST', headers: elevenHeaders(elevenKey), body: form });
      if (!r.ok) { const e = elevenError(r.status, await r.text()); res.status(e.status).json(e.body); return; }
      const data = (await r.json()) as { voice_id?: string };
      res.status(200).json({ voice_id: data.voice_id, name });
      return;
    }

    // ---- Render one segment to speech (action=render) ----
    if (action === 'render') {
      if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
      const body = parseBody<{ voice_id?: string; text?: string; model_id?: string; voice_settings?: Record<string, unknown>; output_format?: string }>(req);
      const voiceId = typeof body.voice_id === 'string' ? body.voice_id : '';
      const text = typeof body.text === 'string' ? body.text : '';
      if (!voiceId) { res.status(400).json({ error: 'Missing voice for this segment — assign the cast first.' }); return; }
      if (!text.trim()) { res.status(400).json({ error: 'Nothing to render — segment text is empty.' }); return; }
      const modelId = typeof body.model_id === 'string' && body.model_id ? body.model_id : 'eleven_multilingual_v2';
      const outputFormat = typeof body.output_format === 'string' && body.output_format ? body.output_format : 'mp3_44100_128';
      const payload: Record<string, unknown> = { text, model_id: modelId };
      if (body.voice_settings && typeof body.voice_settings === 'object') payload.voice_settings = body.voice_settings;
      const r = await fetch(`${ELEVEN_BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`, {
        method: 'POST', headers: elevenHeaders(elevenKey, { 'content-type': 'application/json', accept: 'audio/mpeg' }), body: JSON.stringify(payload),
      });
      if (!r.ok) { const e = elevenError(r.status, await r.text()); res.status(e.status).json(e.body); return; }
      const buf = Buffer.from(await r.arrayBuffer());
      res.status(200).json({ audio_base64: buf.toString('base64'), content_type: 'audio/mpeg' });
      return;
    }

    res.status(400).json({ error: `Unknown action "${action}".` });
  } catch (e) {
    res.status(502).json({ error: (e as Error)?.message ?? 'Audiobook request failed.' });
  }
}

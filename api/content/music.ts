// Background-music generation for the Content Creator video composer.
// BYOK ElevenLabs: reuses the audiobook module's key row (user_elevenlabs_keys,
// same secret + salt — see api/audiobook/index.ts), generates a track, uploads
// it to the public media-outputs bucket, and returns the stable URL.
//
// POST /api/content/music { prompt, duration_seconds } -> { url }
//
// Tries the Eleven Music endpoint first; accounts without music access fall
// back to the sound-generation endpoint (max ~22s, loopable).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createDecipheriv, scryptSync } from 'node:crypto';

export const maxDuration = 120;

type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};
type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
};

const ELEVEN_BASE = 'https://api.elevenlabs.io';
const ELEVEN_KEY_TABLE = 'user_elevenlabs_keys';
const ELEVEN_KEY_SALT = 'audiobook-elevenlabs-key-v1';

function bearer(req: VercelRequest): string | null {
  const raw = req.headers['authorization'] ?? req.headers['Authorization'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !v.toLowerCase().startsWith('bearer ')) return null;
  return v.slice(7);
}

function decryptKey(row: { encrypted_key: string; nonce: string; auth_tag: string }, secret: string): string | null {
  try {
    const key = scryptSync(secret, ELEVEN_KEY_SALT, 32);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(row.nonce, 'base64'));
    decipher.setAuthTag(Buffer.from(row.auth_tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(row.encrypted_key, 'base64')), decipher.final()]).toString('utf8');
  } catch { return null; }
}

async function resolveKey(supabase: SupabaseClient, userId: string, secret: string): Promise<string | null> {
  const { data } = await supabase.from(ELEVEN_KEY_TABLE)
    .select('encrypted_key, nonce, auth_tag').eq('user_id', userId).maybeSingle();
  if (!data?.encrypted_key || !data.nonce || !data.auth_tag) return null;
  return decryptKey(data, secret);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const elevenSecret = process.env.ELEVENLABS_KEY_ENCRYPTION_SECRET;
  if (!supabaseUrl || !serviceKey || !elevenSecret) {
    res.status(500).json({ error: 'Service not configured.' });
    return;
  }

  const token = bearer(req);
  if (!token) { res.status(401).json({ error: 'Missing authorization.' }); return; }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) { res.status(401).json({ error: 'Invalid session.' }); return; }
  const userId = userData.user.id;

  const body = (() => {
    try { return (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as { prompt?: unknown; duration_seconds?: unknown }; }
    catch { return {}; }
  })() as { prompt?: unknown; duration_seconds?: unknown };
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 500) : '';
  const durationSeconds = Math.min(Math.max(Number(body.duration_seconds) || 20, 5), 120);
  if (!prompt) { res.status(400).json({ error: 'Missing prompt.' }); return; }

  const apiKey = await resolveKey(supabase, userId, elevenSecret);
  if (!apiKey) {
    res.status(412).json({ error: 'No ElevenLabs API key on file — add yours in Settings → API Keys.' });
    return;
  }

  let audio: ArrayBuffer | null = null;
  let sourceNote = '';

  // Preferred: Eleven Music (full tracks). Not every plan has access.
  try {
    const r = await fetch(`${ELEVEN_BASE}/v1/music`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, music_length_ms: durationSeconds * 1000 }),
    });
    if (r.ok) {
      audio = await r.arrayBuffer();
      sourceNote = 'music';
    }
  } catch { /* fall through to sound generation */ }

  // Fallback: sound generation (max ~22s, loopable ambience).
  if (!audio) {
    const r = await fetch(`${ELEVEN_BASE}/v1/sound-generation`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ text: prompt, duration_seconds: Math.min(durationSeconds, 22), prompt_influence: 0.5 }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      res.status(r.status === 401 ? 400 : 502).json({
        error: r.status === 401
          ? 'Your ElevenLabs key was rejected — check it in Settings → API Keys.'
          : 'ElevenLabs could not generate audio.',
        detail: detail.slice(0, 400),
      });
      return;
    }
    audio = await r.arrayBuffer();
    sourceNote = 'sound-generation';
  }

  const path = `${userId}/content-creator/music-${Date.now()}.mp3`;
  const { error: upErr } = await supabase.storage
    .from('media-outputs')
    .upload(path, Buffer.from(audio), { contentType: 'audio/mpeg', cacheControl: '31536000' });
  if (upErr) { res.status(500).json({ error: 'Failed to store the track.', detail: upErr.message }); return; }
  const { data: pub } = supabase.storage.from('media-outputs').getPublicUrl(path);

  res.status(200).json({ url: pub.publicUrl, source: sourceNote });
}

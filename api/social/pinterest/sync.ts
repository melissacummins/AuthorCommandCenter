// Pinterest sync: pulls recent pins for a connected account and
// upserts the latest analytics snapshot into social_posts.
//
// Auto-refreshes the access token if it's expired (or about to be).
// Pinterest tokens are 60-day continuous-refresh — calling refresh
// returns a new access_token AND a new refresh_token, both of which
// we re-encrypt and persist.
//
// We pull the last 100 pins (Pinterest's max page_size) and then
// fetch analytics per pin for the last 30 days. Pinterest's per-pin
// analytics endpoint costs 1 request per pin — 100 pins = 100
// requests, well inside the 1000/hr rate limit for a single user.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  end: () => void;
};

function authHeader(req: VercelRequest): string | null {
  const raw = req.headers['authorization'] ?? req.headers['Authorization'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !v.toLowerCase().startsWith('bearer ')) return null;
  return v.slice(7);
}

function deriveMasterKey(secret: string): Buffer {
  return scryptSync(secret, 'social-token-key-v1', 32);
}

function encrypt(plain: string, masterSecret: string): { encrypted: string; nonce: string; authTag: string } {
  const key = deriveMasterKey(masterSecret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted: ciphertext.toString('base64'),
    nonce: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

function decrypt(encrypted: string, nonce: string, authTag: string, masterSecret: string): string | null {
  try {
    const key = deriveMasterKey(masterSecret);
    const iv = Buffer.from(nonce, 'base64');
    const ciphertext = Buffer.from(encrypted, 'base64');
    const tag = Buffer.from(authTag, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    return null;
  }
}

interface SocialAccountRow {
  id: string;
  user_id: string;
  platform: string;
  external_account_id: string;
  encrypted_access_token: string;
  access_token_nonce: string;
  access_token_auth_tag: string;
  encrypted_refresh_token: string | null;
  refresh_token_nonce: string | null;
  refresh_token_auth_tag: string | null;
  access_token_expires_at: string | null;
}

interface PinterestTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
}

async function refreshAccessToken(
  supabase: SupabaseClient,
  account: SocialAccountRow,
  masterSecret: string,
  clientId: string,
  clientSecret: string,
): Promise<string | null> {
  if (!account.encrypted_refresh_token || !account.refresh_token_nonce || !account.refresh_token_auth_tag) {
    return null;
  }
  const refreshToken = decrypt(
    account.encrypted_refresh_token,
    account.refresh_token_nonce,
    account.refresh_token_auth_tag,
    masterSecret,
  );
  if (!refreshToken) return null;

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'pins:read,boards:read,user_accounts:read',
  });
  const tokenRes = await fetch('https://api.pinterest.com/v5/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const json = (await tokenRes.json().catch(() => ({}))) as PinterestTokenResponse;
  if (!tokenRes.ok || !json.access_token) return null;

  const access = encrypt(json.access_token, masterSecret);
  const refresh = json.refresh_token ? encrypt(json.refresh_token, masterSecret) : null;
  const now = new Date();
  const accessExpiresAt = json.expires_in
    ? new Date(now.getTime() + json.expires_in * 1000).toISOString()
    : null;
  const refreshExpiresAt = json.refresh_token_expires_in
    ? new Date(now.getTime() + json.refresh_token_expires_in * 1000).toISOString()
    : null;

  await supabase
    .from('social_accounts')
    .update({
      encrypted_access_token: access.encrypted,
      access_token_nonce: access.nonce,
      access_token_auth_tag: access.authTag,
      encrypted_refresh_token: refresh?.encrypted ?? account.encrypted_refresh_token,
      refresh_token_nonce: refresh?.nonce ?? account.refresh_token_nonce,
      refresh_token_auth_tag: refresh?.authTag ?? account.refresh_token_auth_tag,
      access_token_expires_at: accessExpiresAt,
      refresh_token_expires_at: refreshExpiresAt ?? undefined,
    })
    .eq('id', account.id);

  return json.access_token;
}

async function getAccessToken(
  supabase: SupabaseClient,
  account: SocialAccountRow,
  masterSecret: string,
  clientId: string,
  clientSecret: string,
): Promise<string | null> {
  const expiresAt = account.access_token_expires_at ? new Date(account.access_token_expires_at).getTime() : Infinity;
  const expiresSoon = expiresAt < Date.now() + 5 * 60 * 1000;
  if (!expiresSoon) {
    return decrypt(
      account.encrypted_access_token,
      account.access_token_nonce,
      account.access_token_auth_tag,
      masterSecret,
    );
  }
  const refreshed = await refreshAccessToken(supabase, account, masterSecret, clientId, clientSecret);
  if (refreshed) return refreshed;
  return decrypt(
    account.encrypted_access_token,
    account.access_token_nonce,
    account.access_token_auth_tag,
    masterSecret,
  );
}

interface PinterestPin {
  id: string;
  created_at?: string;
  link?: string | null;
  title?: string | null;
  description?: string | null;
  alt_text?: string | null;
  board_id?: string | null;
  board_section_id?: string | null;
  media?: {
    media_type?: 'image' | 'video' | 'multiple-images' | 'multiple-videos' | string;
    images?: Record<string, { url?: string; width?: number; height?: number }>;
  };
}

interface PinAnalyticsResponse {
  all?: {
    summary_metrics?: Record<string, number>;
    daily_metrics?: Array<{ date?: string; metrics?: Record<string, number> }>;
  };
}

function pickThumbnail(pin: PinterestPin): { mediaUrl: string | null; thumbnailUrl: string | null } {
  const images = pin.media?.images ?? {};
  // Pinterest returns named sizes like "150x150", "400x300", "600x", "1200x", "originals".
  const priority = ['600x', '1200x', 'originals', '400x300', '236x', '150x150'];
  let chosen: string | null = null;
  let thumb: string | null = null;
  for (const key of priority) {
    const img = images[key];
    if (img?.url && !chosen) chosen = img.url;
  }
  const small = images['236x']?.url ?? images['150x150']?.url ?? null;
  thumb = small ?? chosen;
  if (!chosen) {
    const first = Object.values(images).find((i) => i?.url)?.url ?? null;
    chosen = first;
    if (!thumb) thumb = first;
  }
  return { mediaUrl: chosen, thumbnailUrl: thumb };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const masterSecret = process.env.SOCIAL_TOKEN_ENCRYPTION_SECRET;
  const clientId = process.env.PINTEREST_CLIENT_ID;
  const clientSecret = process.env.PINTEREST_CLIENT_SECRET;
  if (!supabaseUrl || !serviceKey || !masterSecret || !clientId || !clientSecret) {
    res.status(500).json({ error: 'Service not configured' });
    return;
  }

  const token = authHeader(req);
  if (!token) {
    res.status(401).json({ error: 'Missing authorization' });
    return;
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }
  const userId = userData.user.id;

  let body: { account_id?: unknown };
  try {
    body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as { account_id?: unknown };
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }
  const accountId = typeof body.account_id === 'string' ? body.account_id : null;

  let query = supabase
    .from('social_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('platform', 'pinterest')
    .limit(1);
  if (accountId) query = query.eq('id', accountId);

  const { data: accountData, error: accountErr } = await query.maybeSingle();
  if (accountErr || !accountData) {
    res.status(404).json({ error: 'No Pinterest account connected for this user' });
    return;
  }
  const account = accountData as SocialAccountRow;

  const accessToken = await getAccessToken(supabase, account, masterSecret, clientId, clientSecret);
  if (!accessToken) {
    await supabase
      .from('social_accounts')
      .update({ last_sync_error: 'Could not refresh access token — reconnect Pinterest.' })
      .eq('id', account.id);
    res.status(400).json({ error: 'Reconnect required', code: 'REAUTH' });
    return;
  }

  // List recent pins.
  const pinsRes = await fetch('https://api.pinterest.com/v5/pins?page_size=100', {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  const pinsJson = (await pinsRes.json().catch(() => ({}))) as { items?: PinterestPin[]; message?: string };
  if (!pinsRes.ok) {
    const msg = pinsJson.message ?? `Pinterest pins fetch failed (${pinsRes.status})`;
    await supabase.from('social_accounts').update({ last_sync_error: msg }).eq('id', account.id);
    res.status(502).json({ error: msg });
    return;
  }

  const pins = pinsJson.items ?? [];

  const end = new Date();
  const start = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);
  const metricTypes = 'IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK,VIDEO_MRC_VIEW';

  let succeeded = 0;
  let failed = 0;

  for (const pin of pins) {
    const url = `https://api.pinterest.com/v5/pins/${encodeURIComponent(pin.id)}/analytics?start_date=${startStr}&end_date=${endStr}&metric_types=${metricTypes}`;
    const analyticsRes = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    let summary: Record<string, number> = {};
    if (analyticsRes.ok) {
      const analyticsJson = (await analyticsRes.json().catch(() => ({}))) as PinAnalyticsResponse;
      summary = analyticsJson.all?.summary_metrics ?? {};
    } else {
      // 404 from a private pin or one with no data — ignore quietly, count as failed.
      failed += 1;
    }

    const { mediaUrl, thumbnailUrl } = pickThumbnail(pin);

    const { error: upErr } = await supabase
      .from('social_posts')
      .upsert({
        user_id: userId,
        account_id: account.id,
        platform: 'pinterest',
        external_post_id: pin.id,
        posted_at: pin.created_at ?? null,
        permalink: pin.id ? `https://www.pinterest.com/pin/${pin.id}/` : null,
        caption: pin.description ?? pin.title ?? pin.alt_text ?? null,
        media_url: mediaUrl,
        thumbnail_url: thumbnailUrl,
        media_type: pin.media?.media_type ?? 'image',
        impressions: Math.round(summary.IMPRESSION ?? 0) || null,
        saves: Math.round(summary.SAVE ?? 0) || null,
        outbound_clicks: Math.round(summary.OUTBOUND_CLICK ?? 0) || null,
        video_views: Math.round(summary.VIDEO_MRC_VIEW ?? 0) || null,
        // Pinterest's "PIN_CLICK" = clicks that opened the pin closeup
        // (different from outbound clicks to the linked URL). Stash it
        // in raw_metrics so we don't lose it, but don't pretend it's
        // an engagement count.
        raw_metrics: summary,
        synced_at: new Date().toISOString(),
      }, { onConflict: 'account_id,external_post_id' });

    if (!upErr) succeeded += 1;
  }

  await supabase
    .from('social_accounts')
    .update({
      last_synced_at: new Date().toISOString(),
      last_sync_error: null,
    })
    .eq('id', account.id);

  res.status(200).json({
    ok: true,
    pins_seen: pins.length,
    pins_upserted: succeeded,
    pins_with_analytics_failures: failed,
  });
}

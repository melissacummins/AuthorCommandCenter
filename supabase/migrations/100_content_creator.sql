-- Content Creator foundation (Phase 0).
-- Adds the two missing marketing facts to books, the tables behind the new
-- Content Creator module (hooks, scans, creatives, hook playbook, banned
-- words, per-task model settings), and swaps the retired marketing /
-- ad-alchemy module keys for content-creator.

-- ============================================================
-- Books: heat level + subgenre
-- ============================================================
ALTER TABLE books ADD COLUMN IF NOT EXISTS heat_level SMALLINT
  CHECK (heat_level BETWEEN 1 AND 5);
ALTER TABLE books ADD COLUMN IF NOT EXISTS subgenre TEXT;

-- ============================================================
-- Hooks found by manuscript scans (or added by hand)
-- ============================================================
CREATE TABLE IF NOT EXISTS content_hooks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id UUID REFERENCES books(id) ON DELETE SET NULL,
  manuscript_id UUID REFERENCES manuscripts(id) ON DELETE SET NULL,
  hook_text TEXT NOT NULL,
  scene_excerpt TEXT DEFAULT '',
  rationale TEXT DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'approved', 'archived')),
  favorite BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT NOT NULL DEFAULT 'scan' CHECK (source IN ('scan', 'manual')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS content_hooks_user_book_idx
  ON content_hooks (user_id, book_id);
ALTER TABLE content_hooks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own content_hooks" ON content_hooks;
CREATE POLICY "Users manage own content_hooks" ON content_hooks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- Resumable manuscript scans
-- ============================================================
CREATE TABLE IF NOT EXISTS content_scans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  manuscript_id UUID NOT NULL REFERENCES manuscripts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'done', 'cancelled')),
  scanned_chapter_ids UUID[] NOT NULL DEFAULT '{}',
  candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_used TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS content_scans_user_manuscript_idx
  ON content_scans (user_id, manuscript_id);
ALTER TABLE content_scans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own content_scans" ON content_scans;
CREATE POLICY "Users manage own content_scans" ON content_scans
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- Creatives: slideshows, kindle screenshots, videos
-- ============================================================
CREATE TABLE IF NOT EXISTS content_creatives (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id UUID REFERENCES books(id) ON DELETE SET NULL,
  hook_id UUID REFERENCES content_hooks(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('slideshow', 'screenshot', 'video')),
  title TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS content_creatives_user_book_idx
  ON content_creatives (user_id, book_id);
ALTER TABLE content_creatives ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own content_creatives" ON content_creatives;
CREATE POLICY "Users manage own content_creatives" ON content_creatives
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- Hook playbook: curated patterns + writing rules
-- ============================================================
CREATE TABLE IF NOT EXISTS hook_playbook_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  pattern_text TEXT NOT NULL,
  example_text TEXT DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  pen_name_id UUID REFERENCES pen_names(id) ON DELETE SET NULL,
  formats TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE hook_playbook_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own hook_playbook_entries" ON hook_playbook_entries;
CREATE POLICY "Users manage own hook_playbook_entries" ON hook_playbook_entries
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS playbook_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('style', 'avatar', 'banned_word')),
  content TEXT NOT NULL,
  replacement TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE playbook_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own playbook_rules" ON playbook_rules;
CREATE POLICY "Users manage own playbook_rules" ON playbook_rules
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- Default platform-safety banned words (shared, read-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS default_banned_words (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  word TEXT UNIQUE NOT NULL,
  platform TEXT NOT NULL DEFAULT 'both' CHECK (platform IN ('meta', 'tiktok', 'both')),
  note TEXT DEFAULT ''
);
ALTER TABLE default_banned_words ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can read default_banned_words" ON default_banned_words;
CREATE POLICY "Authenticated can read default_banned_words" ON default_banned_words
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE TABLE IF NOT EXISTS user_banned_word_optouts (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  word_id UUID NOT NULL REFERENCES default_banned_words(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, word_id)
);
ALTER TABLE user_banned_word_optouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own banned word optouts" ON user_banned_word_optouts;
CREATE POLICY "Users manage own banned word optouts" ON user_banned_word_optouts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Seed: words Meta/TikTok ad review commonly flags for romance marketing.
INSERT INTO default_banned_words (word, platform, note) VALUES
  ('hunt', 'both', 'Flagged as violence/weapons adjacent'),
  ('hunted', 'both', 'Flagged as violence/weapons adjacent'),
  ('prey', 'both', 'Flagged as violence adjacent'),
  ('stalk', 'both', 'Flagged as harassment'),
  ('stalker', 'both', 'Flagged as harassment'),
  ('stalking', 'both', 'Flagged as harassment'),
  ('kill', 'both', 'Violence'),
  ('killer', 'both', 'Violence'),
  ('murder', 'both', 'Violence'),
  ('gun', 'both', 'Weapons'),
  ('knife', 'both', 'Weapons'),
  ('blood', 'both', 'Violence/gore'),
  ('kidnap', 'both', 'Violence/crime'),
  ('kidnapped', 'both', 'Violence/crime'),
  ('captive', 'both', 'Violence/crime'),
  ('hostage', 'both', 'Violence/crime'),
  ('drug', 'both', 'Substances'),
  ('drugs', 'both', 'Substances'),
  ('suicide', 'both', 'Self-harm policy'),
  ('abuse', 'both', 'Sensitive content'),
  ('assault', 'both', 'Violence'),
  ('sex', 'both', 'Adult content'),
  ('sexy', 'both', 'Adult content'),
  ('sexual', 'both', 'Adult content'),
  ('erotic', 'both', 'Adult content'),
  ('erotica', 'both', 'Adult content'),
  ('smut', 'both', 'Adult content'),
  ('smutty', 'both', 'Adult content'),
  ('nsfw', 'both', 'Adult content'),
  ('porn', 'both', 'Adult content'),
  ('nude', 'both', 'Adult content'),
  ('naked', 'both', 'Adult content'),
  ('orgasm', 'both', 'Adult content'),
  ('virgin', 'both', 'Adult content'),
  ('breeding', 'both', 'Adult content'),
  ('panties', 'both', 'Adult content'),
  ('spank', 'both', 'Adult content'),
  ('spanking', 'both', 'Adult content'),
  ('bdsm', 'both', 'Adult content'),
  ('kink', 'both', 'Adult content'),
  ('kinky', 'both', 'Adult content'),
  ('explicit', 'both', 'Adult content'),
  ('threesome', 'both', 'Adult content'),
  ('moan', 'both', 'Adult content'),
  ('thrust', 'both', 'Adult content')
ON CONFLICT (word) DO NOTHING;

-- ============================================================
-- Per-task model settings + favorites (no hard-coded models)
-- ============================================================
CREATE TABLE IF NOT EXISTS content_model_settings (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task TEXT NOT NULL CHECK (task IN
    ('extract', 'rank', 'slides', 'script', 'copy', 'image_prompt', 'synonym', 'catalog')),
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, task)
);
ALTER TABLE content_model_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own content_model_settings" ON content_model_settings;
CREATE POLICY "Users manage own content_model_settings" ON content_model_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS model_favorites (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, provider, model_id)
);
ALTER TABLE model_favorites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own model_favorites" ON model_favorites;
CREATE POLICY "Users manage own model_favorites" ON model_favorites
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Seed the default anti-purple-prose style rule for every existing member
-- who doesn't have one yet (new users get it on first Playbook visit).
INSERT INTO playbook_rules (user_id, rule_type, content)
SELECT DISTINCT m.user_id, 'style',
  'Write in plain, punchy, contemporary social-media voice. No purple prose: no ornate metaphors, no archaic vocabulary, no melodramatic narration. Short sentences. Sound like a real reader talking, not a novelist narrating.'
FROM app_members m
WHERE m.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM playbook_rules r
    WHERE r.user_id = m.user_id AND r.rule_type = 'style'
  );

-- ============================================================
-- Module key swap: marketing + ad-alchemy -> content-creator
-- ============================================================
INSERT INTO app_modules (key, label) VALUES ('content-creator', 'Content Creator')
ON CONFLICT (key) DO NOTHING;
DELETE FROM app_modules WHERE key IN ('marketing', 'ad-alchemy');

UPDATE app_members
SET modules = (
  SELECT ARRAY(
    SELECT DISTINCT m FROM unnest(
      array_append(
        array_remove(array_remove(modules, 'marketing'), 'ad-alchemy'),
        'content-creator'
      )
    ) AS m
  )
)
WHERE modules && ARRAY['marketing', 'ad-alchemy']::text[];

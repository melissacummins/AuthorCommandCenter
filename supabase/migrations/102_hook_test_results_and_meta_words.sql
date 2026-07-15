-- ============================================================
-- Content Creator: research-driven hook upgrades
--   1. content_hooks.test_result — the ad-performance feedback loop.
--      Authors mark hooks worked/failed after running them; the AI
--      preamble feeds those back as positive/negative examples so the
--      writer learns THIS author's audience over time.
--   2. Seed Meta's hard-reject words (profanity + anatomy) into
--      default_banned_words. Verified against Meta's Transparency
--      Center: these reject the ad even when masked with symbols, and
--      repeat violations restrict the whole business account — so the
--      app must warn BEFORE the ad reviewer does.
--
--   Per CLAUDE.md: idempotent for Supabase Preview Branching.
-- ============================================================

ALTER TABLE content_hooks
  ADD COLUMN IF NOT EXISTS test_result TEXT NOT NULL DEFAULT 'untested';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_hooks_test_result_check'
  ) THEN
    ALTER TABLE content_hooks
      ADD CONSTRAINT content_hooks_test_result_check
      CHECK (test_result IN ('untested', 'worked', 'failed'));
  END IF;
END $$;

-- Meta hard-rejects (profanity + anatomy). Platform 'meta': TikTok
-- organic tolerates masked versions of some of these; Meta paid ads
-- never do.
INSERT INTO default_banned_words (word, platform, note) VALUES
  ('fuck', 'meta', 'Profanity — instant Meta ad rejection, even masked'),
  ('fucking', 'meta', 'Profanity — instant Meta ad rejection, even masked'),
  ('shit', 'meta', 'Profanity — instant Meta ad rejection, even masked'),
  ('bitch', 'meta', 'Profanity — instant Meta ad rejection, even masked'),
  ('cock', 'meta', 'Anatomy — instant Meta ad rejection'),
  ('dick', 'meta', 'Anatomy — instant Meta ad rejection'),
  ('pussy', 'meta', 'Anatomy — instant Meta ad rejection'),
  ('cunt', 'meta', 'Profanity/anatomy — instant Meta ad rejection'),
  ('cum', 'meta', 'Sexual content — instant Meta ad rejection'),
  ('breast', 'meta', 'Anatomy — Meta rejects; softened synonyms also fail'),
  ('breasts', 'meta', 'Anatomy — Meta rejects; softened synonyms also fail'),
  ('nipple', 'meta', 'Anatomy — instant Meta ad rejection'),
  ('nipples', 'meta', 'Anatomy — instant Meta ad rejection'),
  ('tit', 'meta', 'Anatomy — instant Meta ad rejection'),
  ('tits', 'meta', 'Anatomy — instant Meta ad rejection'),
  ('whore', 'meta', 'Profanity — instant Meta ad rejection'),
  ('slut', 'meta', 'Profanity — instant Meta ad rejection')
ON CONFLICT (word) DO NOTHING;

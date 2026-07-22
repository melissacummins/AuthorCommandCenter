-- ============================================
-- Writing: atomic, non-destructive manuscript chapter save (RPC)
--
--   Replaces the client-side delete-all-then-reinsert in
--   src/modules/writing/api.ts::saveChapters, which was DESTRUCTIVE and
--   NON-ATOMIC: supabase-js has no multi-statement client transaction, so an
--   interrupted `delete().eq('manuscript_id', …)` + bulk re-insert could leave
--   a manuscript empty or half-written and lose chapters permanently.
--
--   save_manuscript_chapters() does the whole save inside the implicit
--   function transaction, so it is ALL-OR-NOTHING: either every change lands
--   or none does. It also snapshots the current chapters into
--   manuscript_revisions BEFORE touching anything, so the state prior to the
--   save is always recoverable.
--
--   NOTE ON FILE NUMBER: the directive asked for 108_, but 108 is already
--   taken by 108_task_activity.sql (migrations run to 110). Using 111 to
--   avoid a collision.
--
--   ---- RLS / security model -------------------------------------------------
--   This function is SECURITY INVOKER (the default), NOT SECURITY DEFINER.
--   That is deliberate and load-bearing:
--     * It runs as the calling (authenticated) user, so auth.uid() is the
--       real caller and every INSERT/UPDATE/DELETE below is still subject to
--       the existing Row Level Security policies on manuscripts,
--       manuscript_chapters, manuscript_revisions and manuscript_word_logs
--       (all: `auth.uid() = user_id`).
--     * The function therefore CANNOT touch another user's rows even if a
--       malicious client passes foreign ids — RLS rejects the write.
--     * The explicit ownership check below turns a would-be silent RLS no-op
--       into a clear error, and guarantees the manuscript itself is the
--       caller's before any work begins.
--   Because we never use SECURITY DEFINER, there is no RLS bypass anywhere in
--   this function.
--
--   Idempotent: DROP … IF EXISTS + CREATE OR REPLACE, safe to re-apply against
--   a Supabase preview branch.
-- ============================================

-- Drop any prior signature first so a re-apply that changes the shape can't
-- fail on CREATE OR REPLACE (return type / defaults are fixed once created).
DROP FUNCTION IF EXISTS save_manuscript_chapters(uuid, jsonb, date);
DROP FUNCTION IF EXISTS save_manuscript_chapters(uuid, jsonb);

CREATE OR REPLACE FUNCTION save_manuscript_chapters(
  p_manuscript_id uuid,
  p_chapters      jsonb,
  -- Optional so the documented 2-arg call still works; when omitted the daily
  -- word-log row is dated CURRENT_DATE. The client passes its LOCAL "today"
  -- (matching Catalog's todayISO helper) so the manuscript word-log row and
  -- the linked book's word-log row land on the same calendar day.
  p_day           date DEFAULT NULL
)
RETURNS SETOF manuscript_chapters
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_chapters jsonb;
  v_total    integer;
BEGIN
  -- (a) Ownership check. Under SECURITY INVOKER + RLS this SELECT can only see
  -- the caller's own manuscripts, so this doubles as existence + ownership.
  IF NOT EXISTS (
    SELECT 1 FROM manuscripts
    WHERE id = p_manuscript_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Manuscript % not found or not owned by the current user', p_manuscript_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Normalize the incoming chapters: resolve a concrete id for every element
  -- (existing chapters keep their id; brand-new chapters get a fresh uuid) and
  -- default idx to array order. Doing this ONCE up front means the same
  -- resolved ids are reused by the delete-set below and the upsert — a fresh
  -- gen_random_uuid() per statement would not be stable.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',           COALESCE(NULLIF(elem->>'id','')::uuid, gen_random_uuid()),
        'idx',          COALESCE((elem->>'idx')::int, (ord - 1)::int),
        'title',        COALESCE(elem->>'title', ''),
        'content_html', COALESCE(elem->>'content_html', ''),
        'word_count',   COALESCE((elem->>'word_count')::int, 0)
      )
      ORDER BY ord
    ),
    '[]'::jsonb
  )
  INTO v_chapters
  FROM jsonb_array_elements(COALESCE(p_chapters, '[]'::jsonb))
       WITH ORDINALITY AS t(elem, ord);

  -- (b) Snapshot the CURRENT chapters into manuscript_revisions BEFORE any
  -- change. One revision row per existing chapter, shaped exactly like
  -- createRevision()/restoreRevision() (chapter_id, user_id, content_html,
  -- word_count, label). This is the "snapshot-first" safety net: the pre-save
  -- state of every retained chapter is recoverable from version history.
  -- (Revisions belonging to chapters that get removed in step (d) cascade away
  -- with those chapters — an intentionally deleted chapter has no history to
  -- keep, and the whole operation is atomic so nothing is lost by surprise.)
  INSERT INTO manuscript_revisions (chapter_id, user_id, content_html, word_count, label)
  SELECT c.id, v_uid, c.content_html, c.word_count, 'Before save'
  FROM manuscript_chapters c
  WHERE c.manuscript_id = p_manuscript_id;

  -- (d) Delete ONLY chapters of this manuscript that are NOT in the provided
  -- set (genuinely removed chapters). Never a blanket delete-all. Runs before
  -- the upsert; new chapters aren't in the table yet, so they are unaffected.
  DELETE FROM manuscript_chapters
  WHERE manuscript_id = p_manuscript_id
    AND id NOT IN (
      SELECT (e->>'id')::uuid FROM jsonb_array_elements(v_chapters) AS e
    );

  -- (c) UPSERT the provided chapters by id: update title/content_html/
  -- word_count/idx in place for existing ids, insert new ones. user_id is
  -- always the caller. The WHERE on DO UPDATE guards against a same-user id
  -- that belongs to a DIFFERENT manuscript being pulled in here; cross-user
  -- ids are already blocked by RLS.
  INSERT INTO manuscript_chapters (id, manuscript_id, user_id, idx, title, content_html, word_count)
  SELECT
    (e->>'id')::uuid,
    p_manuscript_id,
    v_uid,
    (e->>'idx')::int,
    e->>'title',
    e->>'content_html',
    (e->>'word_count')::int
  FROM jsonb_array_elements(v_chapters) AS e
  ON CONFLICT (id) DO UPDATE SET
    idx          = EXCLUDED.idx,
    title        = EXCLUDED.title,
    content_html = EXCLUDED.content_html,
    word_count   = EXCLUDED.word_count,
    updated_at   = NOW()
  WHERE manuscript_chapters.manuscript_id = p_manuscript_id;

  -- (e) Recompute the manuscript's denormalized word_count and touch it.
  SELECT COALESCE(SUM(word_count), 0)
  INTO v_total
  FROM manuscript_chapters
  WHERE manuscript_id = p_manuscript_id;

  UPDATE manuscripts
  SET word_count = v_total,
      updated_at = NOW()
  WHERE id = p_manuscript_id;

  -- (e cont.) Upsert today's manuscript_word_logs row (the unconditional daily
  -- analytics snapshot, mirroring syncWordCount). This is a set-to-total upsert
  -- keyed on (manuscript_id, day), so re-running the same day is idempotent.
  -- The linked Catalog book rollup (books.word_count + book_word_logs) stays in
  -- the client on purpose — see saveChapters() — so word count is never
  -- double-counted between the two.
  INSERT INTO manuscript_word_logs (manuscript_id, user_id, day, word_count)
  VALUES (p_manuscript_id, v_uid, COALESCE(p_day, CURRENT_DATE), v_total)
  ON CONFLICT (manuscript_id, day) DO UPDATE SET
    word_count = EXCLUDED.word_count,
    updated_at = NOW();

  -- Return the resulting chapters in canonical idx order — same shape
  -- listChapters() returns, so the client contract is unchanged.
  RETURN QUERY
    SELECT *
    FROM manuscript_chapters
    WHERE manuscript_id = p_manuscript_id
    ORDER BY idx ASC;
END;
$$;

-- Callable by authenticated end users (RLS still fully applies inside).
GRANT EXECUTE ON FUNCTION save_manuscript_chapters(uuid, jsonb, date) TO authenticated;

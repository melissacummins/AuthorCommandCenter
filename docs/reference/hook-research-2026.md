# Show-Stopper Hooks: Verified Research → Pipeline Validation

Deep-research run: ~30 sources fetched, every claim below survived a 3-vote adversarial fact-check (votes shown). Merged with the earlier Meta-policy research. Organized the way you asked: what actually went viral (literally), platform rules, then a verdict on each step of our pipeline — identifying/gathering and formulating/varying.

---

## 1. What actually went viral — the receipts

| Case | The literal hook | Numbers | Lesson |
|---|---|---|---|
| **Lightlark** (Alex Aster, romantasy) | *"Would you read a book about an island that appears every 100 years, where six rulers have the chance to break their generational curses and save their people?"* | 1M+ views **overnight**; B&N bestseller from pre-orders **5 months before release**; previously rejected by 12+ publishers [3-0] | A **premise question** — not a scene, not a quote. She calls TikTok a "market validation tool": post the question, count the screams. |
| **Stone Maidens** (thriller, 11 years old) | A 16-second video by the author's **daughter** about her dad's 14-year perseverance | 50M views, 10.7M likes; #1 Amazon Best Sellers in ~2 weeks; ~100k copies in a month after 11 years of "very low" sales [3-0] | The winning hook wasn't book content at all — it was a **human story**, amateur-feeling, 16 seconds. Polish is not the variable. |
| **Eden O'Neill** (dark romance) | *"he made her forget."* + #bookswhereheisobsessedwithher, using the slow-reveal format (blank page → quote → cover) [3-0 / 2-1] | Featured by BookBub as the model indie format | A 4-word bare line CAN carry a video — note the **hashtags do the framing** (obsession trope named in the tag) and the reveal format does the retention. |
| **Emily Blackwood** (fantasy) | *"The TENSION AND LONGING BETWEEN THEM 😭😭"* + #enemiestoloverstrope [3-0] | BookBub-featured growth strategy | She captions **the feeling itself**, not the plot. (Our library's *Edge-of-Seat Feeling* strategy — independently validated.) |
| **A.E. Valdez** (contemporary) | Reader-insertion scenarios — "imagine you…" with the title revealed only at the end [3-0] | Drives outsized comment engagement | POV/imagine frames with a **delayed book reveal** = comment bait + retention. |
| **Tessa Bailey / Talia Hibbert** (trad romance) | Acting out **scenes** and **tropes** from their books to trending sounds, community-insider tone [3-0] | Standard practice at bestseller level | Scenes that are *performable* are a distinct asset class — a beat someone could act out is a video waiting to happen. |

## 2. Platform cheat sheet (verified)

**TikTok:** hook lands in the first 1–3 seconds or they're gone [3-0]. Ultra-short works (the 50M-view video was 16s). 3–5 hashtags including #booktok; stuffing gets suppressed (anecdotal, flagged as such) [3-0]. It's a **volume game**: 2–4 posts/day recommended, and "top-performing posts are often unplanned afterthoughts" [3-0]. Trending audio measurably lifts distribution (prior research).

**Instagram Reels — Meta's own official guidance [3-0]:** hook within the first few seconds ("the moment viewers instinctively decide"); younger audiences consume at ~3× speed. Meta names **exactly three hook types**: *value promise* (what the viewer gains), *statement of intent* (what they're about to see), and *question/invitation* (curiosity + participation). Meta explicitly says to **A/B test hook styles** rather than assume one formula.

**Facebook/Meta paid ads:** Meta's ad-delivery AI matches creative to audience, so Meta officially recommends **"creative diversification" — many variants of the same promotion** [3-0]. Policy (prior research, primary source): profanity banned even masked/symbol-obfuscated; repeat violations restrict the business account; violence words ("kill," "blood," hunt-adjacent) machine-flagged.

## 3. Step 1 — identifying & gathering moments: our scan, validated

**What the research says produces viral hooks:** dramatic scene snippets; trope-embodying scenes; tension/longing beats; performable/actable moments; reader-insertable scenarios; and — the two things *outside* any scene — the **book's premise** and the **author's own story**.

**Our extract pass already hunts** killer dialogue, wait-WHAT beats, power flips, disproportionate reactions, guarded-characters-cracking: all confirmed categories. ✅

**Three verified gaps:**
1. **Premise hooks don't exist in our pipeline.** Lightlark — the biggest documented result in the dataset — is a premise question, no scene involved. We have every ingredient in Catalog (tropes, subgenre, heat, blurb) and never write premise-level hooks.
2. **Reader-insertion potential isn't scored.** A.E. Valdez's engagement engine is "could the viewer imagine being her right here?" — worth one line in the extract brief.
3. **Over-filtering fights the volume game.** Winners are "often unplanned afterthoughts" and Meta wants many variants. Our verify pass should hard-kill only *inaccuracy* and *raw page-lifts* — borderline interest-test cases should be kept and labeled, not deleted. Testing decides, not the model.

## 4. Step 2 — formulating & varying hooks: our workshop, validated

**The workshop's core design is now officially endorsed by Meta:** one moment → many differently-framed variants → test, is literally Meta's "creative diversification" + "A/B test hook types" guidance [3-0]. Alex Aster's "shout into the void and count who shouts back" is the same loop as organic practice. ✅

**Verified additions to the strategy library:**
1. **Premise Question** (*"Would you read a book about…?"*) — the single best-documented viral frame in the research. Needs a workshop "premise mode" that works from book facts with no quote at all.
2. **Reader Promise** (Meta's "value promise" translated to fiction): promise the *feeling/fantasy* — the vibe of "this man will ruin real men for you."
3. **Bare-line + trope-hashtag combo** formalized: a self-contained short line may stand alone **when trope hashtags carry the framing** (the Eden O'Neill pattern) — refines our bare-line exception.
4. **Hashtag suggestions belong in the product:** 3–5, trope-based, #booktok included — we already know every book's tropes and suggest nothing at export time.

**Already validated as-is:** *Edge-of-Seat Feeling* (Blackwood), *Same Scene, Different Hook* (fatigue/refresh), POV/imagine frames (Valdez + prior POV metrics), question frames (Meta + Lightlark), frame diversity per set (Meta A/B guidance). ✅

## 5. Recommended changes, tiered

**Prompt/library only (small PR):**
- Add *Premise Question* and *Reader Promise* strategies to the built-in library.
- Extract brief: add reader-insertion and performability as moment qualities; note premise as a source.
- Verify pass: hard-kill only inaccuracy/page-lift; label borderline interest instead of deleting.
- Anatomy: bare-line exception refined (self-contained line OR line + trope-tag framing).
- Plus the six queued from the Night Shade audit (devotion-needs-stakes, Meta hard-reject words, platform-split mask advice, bare-line rule, bulk import, tested/failed marker).

**Small features (second PR):**
- Workshop "premise mode" — write hooks from book facts alone, no quote needed.
- Hashtag suggester on hook cards / export surfaces (tropes → 3–5 tags + #booktok).

**For you personally (no code):** the two biggest verified results — Lightlark and Stone Maidens — were a premise question and an author story. Neither comes from inside a manuscript. Worth putting your own "why I wrote this" on camera once; the data says amateur and 16 seconds is fine.

## Sources

[Alex Aster / Lightlark — TODAY interview](https://www.today.com/popculture/books/alex-aster-leveraged-tiktok-lightlark-rcna44242) · [Stone Maidens — Amazon News](https://www.aboutamazon.com/news/books-and-authors/how-a-viral-tiktok-video-made-this-book-an-amazon-best-seller-11-years-after-it-was-published) · [Meta's official Reels hook guidance — Social Media Today](https://www.socialmediatoday.com/news/meta-shares-tips-on-reels-hooks-creative-diversification-in-ads-and-threa/808182/) · [Kindlepreneur — TikTok for authors](https://kindlepreneur.com/tiktok/) · [BookBub — indie author TikTok ideas](https://insights.bookbub.com/indie-authors-tiktok-ideas-inspiration/) · [BookBub — author TikTok promo ideas](https://insights.bookbub.com/authors-tiktok-book-promo-ideas/) · [ScribeCount — TikTok for indie authors](https://scribecount.com/author-resource/social-media-marketing-for-authors/tiktok-for-indie-authors) · Prior verified: [Meta profanity policy](https://transparency.meta.com/policies/ad-standards/objectionable-content/profanity/) · [Meta violent content ad standards](https://transparency.meta.com/policies/ad-standards/objectionable-content/violent-graphic-content/)

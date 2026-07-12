---
name: ad-copy-writer
description: >
  Write Meta (Facebook/Instagram) ad copy for romance authors' books. Use this skill whenever
  the user asks to "write ad copy," "create an ad," "write copy for the ad," "what should the
  ad say," "write a headline and description," "make the description better," "add comp authors,"
  "write a hook," or any request to create or revise Facebook/Instagram ad copy for their books.
  Also triggers when the user provides a new creative (image or video) and asks what the ad text
  should be, when they say "the description is too bare," or when working on any reel script
  that will become an ad. This skill covers primary text, headlines, descriptions, and reel
  scripts — everything that goes into the Meta Ads Manager text fields.
version: 1.0.0
---

# Ad Copy Writer for Romance Authors

Write Meta ad copy (Facebook/Instagram) for romance books across all subgenres. This skill
covers the text that goes into Meta Ads Manager: primary text, headline, description, and
reel scripts.

## Prerequisites: What You Need Before Writing Copy

Before writing ad copy, you need a **Book Analysis** for this book. The Book Analysis includes
the Story Overview, reader avatar profiles, and identified hooks.

**Check for a saved Book Analysis file first.** The author may have saved one during
`/setup-books`. Look in their working directory for a Book Analysis document (.md, .docx, or
ask the author where they saved it). If found, read it and proceed to Step 1.

If no Book Analysis exists (not saved as a file AND not in the current conversation), tell
the author to run `/setup-books` first.

**HARD RULE — DO NOT SKIP STEPS.** Steps 1-5 must be completed in order. Each step requires
the author's input before moving to the next. Even if you already know the answer from
context (e.g., the author mentioned their creative earlier in conversation), confirm it with
the author at the appropriate step — do not silently skip ahead. If information was provided
earlier, say "You mentioned [X] — want to use that, or something different?" and wait for
confirmation. Skipping a step means the ad copy loses a layer of specificity that makes the
difference between generic copy and copy that converts.

## Step 1: Hooks

**Ask the author first — do NOT lead with a list of hooks.**

Check the Book Analysis for any hooks the author already identified during setup. Then ask:

"A few questions about hooks:
1. Do you already have hooks you want to use? A favorite quote, a scene readers always
   mention, dialogue that lives rent-free in your head?
2. Would you like me to come up with hook options from the manuscript?
3. Would you like me to research what's going viral on TikTok/BookTok for your tropes and
   rank hook options based on what's actually performing right now?
4. What kind of hook are you drawn to? A provocative quote from the book? A 'wait, what?'
   statement about the premise? A mini-story that unfolds like a trailer?"

**If the author has hooks from setup or their own:** Use those.

**If the author wants hook market research (Option 3):** Search TikTok/BookTok for the book's
key tropes, subgenre, and character dynamics. Look for what's currently going viral — which
hook styles are getting the most engagement, which angles readers are responding to, what
language and framing is trending. Then cross-reference the viral patterns with scenes and
moments from the author's manuscript. Present hook options ranked by how well they align with
what's performing, with notes on WHY each hook style is working right now. This is especially
valuable when the author plans to use the hook as an excerpt reel, since TikTok/BookTok
trends directly inform what will perform on Reels too.

**If the author wants you to come up with hooks (without research):** Go to the Book Analysis
(or the manuscript) and identify the strongest scenes and dynamics. Present them as hook
options using plain, descriptive framing names.

**How to present hook options:**

```
**Option 1 (No Other Choice)** — [Describe the premise element that fits this framing and
give 2-3 example hooks in reader-facing language]

**Option 2 (Unhinged Devotion)** — [Specific manuscript detail + 2-3 example hooks]

**Option 3 (Power Flip)** — [Specific manuscript detail + 2-3 example hooks]
```

> ### ⛔ CRITICAL — HOOK PRESENTATION RULE (DO NOT VIOLATE)
>
> When presenting hook options to the author, NEVER include:
> - Strategy numbers or template names from any reference guide ("Strategy #5",
>   "Spice + OMG", "Power Surrender", "Template B", etc.)
> - "Why this works" explanations citing the guide or methodology
> - View counts, performance data, or research citations
> - Phrases like "the guide notes..." or "this template outperformed..."
>
> Reference material is for YOU when constructing the hook. Strip it out before
> showing the author. The author wants to feel each angle and pick — not get a
> methodology lesson on top of their hooks.
>
> **WRONG (this is the kind of thing that breaks trust):**
> > **Option A** *(my pick — Strategy #5: Spice + OMG Reaction, with POV)*
> > "POV you call out for ✨God✨ during your first time with the gargoyle..."
> > Why this one: POV pulls scrolls (the guide notes 2nd person consistently
> > outperforms — the 105K view example was the POV variant). 🫢 = scandal energy
> > per the guide.
>
> **RIGHT (just the angle name and the example hooks):**
> > **Option 1 (Religious Irony)** — His response when she calls out "oh God" mid-scene
> > - "POV you call out for ✨God✨ during your first time with the centuries-old creature he made 🫢"
> > - "that moment when she says 'oh God' and the gargoyle who was made by one ✨corrects✨ her 👀"
>
> Pick the strategy you're using internally to construct the hook. Apply algospeak,
> emoji, framing, and template logic from the reference guides as you write. Then
> present only the framing-name and the example hooks. Nothing else.

**Additional rules:**
- Use plain names for the hook type (No Other Choice, Unhinged Devotion, Power Flip,
  Religious Irony, Secret Identity, Soft Baddie, First Time, Size Difference, Dramatic
  Reaction, etc.) — never strategy numbers or template codes
- DO describe what you're pulling from the manuscript so the author knows the angle
- Show 2-3 example ways each hook could be written so the author can feel it
- Let the author pick before writing any copy

### Hook Discipline Checklist (run BEFORE presenting any hook)

After drafting each hook example, check it against these. Rewrite if it fails any.

1. **≤12 words.** Hooks have 3-7 seconds to land. If reading the hook out loud takes
   more than 3 seconds, cut. The Video Hook Strategy Guide's TLDR Principle #5 is
   explicit on this. Strategy #18 specifically proved that the simpler version
   outperformed the more-styled version (40.9K vs lower) — when in doubt, cut, don't add.

2. **One microtrope per hook, not stacked.** Pick the strongest microtrope and let
   it carry the hook alone. "8-foot gargoyle is big ✨everywhere✨" beats "8-foot
   stone-skinned monster who waited centuries for her" because the second stacks
   four microtropes that dilute each other. Key Takeaway #9: microtropes > broad
   tropes, and that means ONE sharp microtrope, not many.

3. **Algospeak the risky words. Both layers.**
   - **Layer 1 (character substitution):** inside → !nside, begging → b3g-!ng,
     jealous → jea/ous, smut → sm*t, kill/death → unalive or ☠️, mafia → mąfia, etc.
   - **Layer 2 (word substitution):** fucking → dances with, kill → unalive,
     sex → spicy/seggs, NSFW → corn. These swap the whole word.
   - When in doubt, algospeak more, not less. Especially for organic TikTok/Reels.
   - If you see a strange word in the author's edits, ASK — don't assume it's a typo.
     Algospeak shifts faster than reference docs update.

4. **Don't spoil the payoff in the hook.** If the reel/excerpt pays off on a
   specific line, don't include that line in the hook itself. Leave the open loop
   for the reel to close. Strategy #16: incomplete sentences pull harder than
   complete ones. Bad: hook says "you were made for me" and Frame 3 also says
   "you were made for me" — the reel reveals nothing new.

5. **Voice check: read it out loud.** If it sounds like a person texting their
   friend about a book, ship it. If it sounds like flap copy with sparkle emoji
   bolted on, rewrite. Spoken BookTok > written marketing.

6. **Cut filler descriptors first.** "Centuries-old," "stone-skinned," "ancient,"
   etc. are filler unless they're the ONLY microtrope carrying the hook. If
   another microtrope is doing the work, cut these.

For finding hooks in the manuscript, look for:
- **Provocative dialogue** — Lines that create instant curiosity or tension
- **Declarative stakes** — Where the stakes become clear in one sentence
- **Vulnerability moments** — Where a tough character goes soft
- **Power flips** — Where the expected dynamic reverses
- **"Wait, what?" details** — Anything that makes a reader stop and re-read

**Manuscript mining shortcuts** (see `references/excerpt-mining-guide.md` for the full guide):
- Search for "kiss" — the scenes around kisses almost always contain the best ad material
- Search for hero's POV moments where he thinks about everything he loves about the heroine
- Search for rapid-fire banter with push-pull energy
- Search for the scene that best represents THIS book's specific genre flavor
- Also try searching: "breath," "eyes," "hands," "whisper," character names in proximity

**If using a longer excerpt (200-500 words) as the hook:**
- Open on a line that grabs attention with zero context needed
- End on a cliffhanger — NEVER at a chapter break or a moment of resolution
- Edit for Meta censors before using (see `references/excerpt-mining-guide.md` Step 3)

For each hook scene, read 20-30 lines of surrounding context to understand who's speaking,
what just happened, and the tone.

**Note on the Video Hook Strategy Guide** (`references/video-hook-strategy-guide.md`):
This guide is primarily for building VIDEO hooks — reels, TikToks, excerpt-over-background
videos. It has 23 proven hook strategies with formulas and examples. Use it when the author
asks for reel scripts or video creative hooks. The framing concepts (No Other Choice, Soft
Baddie, Power Surrender, etc.) are useful for ad copy hooks too, but the guide itself is
oriented toward video format. When using its strategies for ad copy, adapt the framing to
work as written text, not on-screen text cards.

## Step 2: Comp Author Discovery

Check the Book Analysis for any comps already identified. If the author skipped comps during
setup, skip this step — replace the Comps description with an additional Vibe Stack, Keyword
Sink, or Wildcard description when writing the ad copy.

If comps weren't covered yet, explain what they're for and make it optional:

"Comp authors are authors whose readers would love your book. We use them in one of your ad
descriptions so Facebook can target those readers. If you know your comps, great — if not, I
can help you find them, or you can skip this and I'll use that description slot for something
else instead."

**If the author knows their comps**, confirm and move on.

**If the author isn't sure**, offer to help find comps. There are three paths:

**Path A — Claude in Chrome (best results):**
"I can search Amazon for books with similar tropes and check the also-boughts directly. This
gives the best results because I can see exactly which authors show up alongside books like
yours. Do you have Claude in Chrome set up? If not, I can walk you through setting it up —
it only takes a minute."

If the author wants to set up Chrome, walk them through it. If Chrome is already connected,
search Amazon for the book's subgenre + key tropes, check also-boughts and category
bestsellers, and check Goodreads shelves.

**Path B — Blind search (without Chrome):**
"I can do a web search for books in your subgenre and trope combination to find likely comps.
The results won't be as precise as checking Amazon directly, but I can look through Goodreads
lists, review sites, and BookTok recommendations to find authors whose readers overlap with
yours."

Search for the book's subgenre + tropes, look through Goodreads shelves, review sites, and
recommendation lists.

**Path C — Manual (author does it):**
"Here's how to find your comps yourself:
1. Go to a book similar to yours on Amazon
2. Scroll to 'Customers who bought this item also bought'
3. Note which authors appear — those are your comps
4. Also check your book's Amazon categories and see who the top sellers are
5. On Goodreads, search for your tropes and see which authors appear on the same shelves
6. Ask your readers: 'If you love my book, who else do you read?'

Come back with 4-6 names and I'll write the copy around them."

If you think a specific author is a good comp, ask about them: "Your book reminds me of
[Author]'s work because of [specific quality]. Do you see that overlap?" Let the author
confirm or push back.

**Aim for 4-6 comps** per book. Each comp should have an active Facebook ad presence (meaning
their readers are already being targeted by other book advertisers, so Facebook has interest
data on them). See `references/comp-authors-by-subgenre.md` for a starter list and research
methods.

## Step 3: Social Proof

Ask for 2-3 strong reader reviews from Amazon, Goodreads, or BookBub. Pick ones that use
emotional language ("I screamed," "I couldn't put it down," "I ate this up") over generic
praise ("great book, loved it").

If the book is pre-publication and has no reviews yet, skip this section and note it for
the author to add later.

## Step 4: Creative & Workflow Preference

Ask the author which workflow they prefer:

**Option A — "I have a creative already"**
The author provides an image or video. Write copy that matches the creative's mood, scene,
and visual elements.

**If the creative is a video with a hook on it** (an excerpt reel, a text-overlay video, a
BookTok-style hook), ask the author what the hook is. The ad copy's primary text must connect
to that specific hook — the viewer sees the video first, then reads the text below it. If
the video shows a "Don't tease me with a good time" excerpt, the ad copy should play off
that scene, that energy, that dynamic. A disconnected ad copy hook kills the momentum the
video created.

All hooks, headlines, and expansions must connect to what the viewer sees in the creative.

**Option B — "Write the copy first, I'll figure out the creative"**
Write the copy based on the hooks the author chose and the avatar profiles. Then suggest what
kind of creative would pair well: "This hook would work great with [type of image/video]
because [reason]. Here are some directions:

- What kind of image/video would match the mood
- What the visual should signal to the target avatars
- What genre cues should be in the image (daggers, crowns, dark forests, city lights, etc.)

Would you like me to write a prompt you can use in an AI image generator (Midjourney, DALL-E,
Leonardo, etc.) or would you like to create something in Canva's AI tools or with Claude
Design?"

If the author wants an image prompt, write a detailed one that matches the hook's mood, the
book's genre signals, and the target avatar's aesthetic.

**Also ask:** Where will the ad link? And is this a single book or a bundle/box set? These
determine the CTA format.

## Step 5: Ad Destination & CTA

Ask two things before writing:
1. **Where will the ad link?** Shopify store, Amazon, wide distribution retailers, author website?
2. **Is this a single book or a bundle/box set?** If it's a bundle, ask which books are included.

The CTA depends on both answers. **Always confirm before writing.**

**Single book — direct purchase (Shopify, author website):**
```
Save money and support the author when you buy direct from [Author]. Scroll up and one-click now!
```

**Bundle/box set — direct purchase:**
```
Books Included in This Bundle:
[Book 1]
[Book 2]
[Book 3]
[etc.]

Save money and support the author when you buy direct from [Author]. Scroll up and one-click now!
```

**Single book or bundle — retailer links (wide distribution):**
```
Grab the ebook or paperback from your favorite retailer, or buy direct from [Author] and
support the author.
```

**Amazon-specific ads:**
```
Tap the link to start reading [Title] on Amazon in ebook or paperback!
```

Do not assume destination or format. Always ask both questions.

## Formatting Rules

These rules are based on what converts in paid book advertising on Meta. They are non-negotiable.

### Voice
- **Conversational voice.** Sound like a friend recommending a book over coffee. Not a sales pitch.
- **Use contractions.** "It is" becomes "it's." "You are" becomes "you're."
- **No marketer speak.** Change "it allows" to "it lets." Drop adjectives like "captivating,"
  "spellbinding." Never use cliche words like *unlock, unleash, elevate, tapestry, synergy.*

### No Tagline-Stacking — One Angle Per Variation

**This is the most common failure mode in ad copy revisions.** Do not stack multiple punchy
one-liners back-to-back in an expansion. Each variation should sell ONE angle, not three.

**The failure pattern looks like this:**

> They're about to breach an armed room. And she's flirting with him.
>
> She killed the man who owned her and took his empire. He's been watching her from the
> shadows. The things he says will ruin you for anybody else. THIS BOOK WRECKED ME.

Four declarative one-liners back-to-back. Each is a different selling angle (heroine power /
hero obsession / character voice / reader reaction). They cancel each other out because the
reader's brain has nowhere to land — every sentence screams "I'm important" with no connective
tissue between them. It reads as noise, not copy.

**The right pattern:**

> "Don't tease me with a good time."
>
> They're about to breach an armed room. And she's flirting with him.
>
> Dark mafia romance. The things he says will ruin you for anybody else.

Three short paragraphs. Each paragraph does ONE job. The right version picks ONE angle, pairs
it with a genre tag, and lets the trope list do the heavy lifting on additional angles.

**Test before submitting:** Read the expansion out loud. If it sounds like four bumper
stickers in a row, it's tagline-stacked. Rewrite with fewer claims and more connective
tissue, or split the claims across separate variations.

**Why this happens:** When trying to be "punchy," the easiest move is to drop connective
phrases ("and," "because," "the kind of"), which leaves stacked declarative sentences. Resist
this. Connective tissue is what makes copy read like a friend recommending a book — without
it, you've got a marketing brochure.

**Each variation gets ONE angle.** That's why there are 5 variations — one per avatar/angle.
Don't try to cram three angles into one variation; that's what the other variations are for.

### Punctuation and Sentence Structure
- **No em dashes.** Readers associate em dashes with AI-generated copy. Use full stops,
  sentence fragments, and ellipses instead.
- **Short punchy sentences.** Max 10 words on the punchy lines, ending with ellipses.
- **Avoid the "not this, not that... this other thing" construction.** It reads as AI.
- **Use ellipses** for trailing tension, pauses, and where you'd normally reach for an em dash.

### Mobile Formatting
- **Short paragraphs.** Most readers are on a phone.
- **Don't make each sentence its own paragraph either.** That's annoying. Create natural flow.
- **Good structure:** One-line hook, a two-line paragraph, a single sentence, then the emoji list.

### Meta Safety — What Gets Ads Rejected

Meta's review bots scan ad copy for policy violations. Too many rejections can restrict or
ban the author's entire ad account. These rules are critical.

**Words and phrases that trigger INSTANT rejection:**
- Anatomy words: "breast," "nipple," "tit" — remove all breast play from excerpts
- Profanity: any swear words, even censored (s***, f@ck) — censoring with special
  characters is called "obfuscation" and triggers immediate rejection AND account flagging
- The fix for profanity: edit swear words out entirely but replace with words that keep the
  character's voice intact

**Topics that trigger Special Category or rejection:**
- Government titles (Sheriff, Police Officer, Mayor, Senator) — triggers Special Category
  restrictions which severely limit targeting
- Explicit violence descriptions ("knife play," "gun to her head," "emptied a clip into
  him," "took punches," "she was beaten") — use "dark themes," "a threat in the shadows,"
  or vague references instead
- Sexual content — keep it suggestive, not explicit. Imply heat without describing acts
- Anything that could be read as promoting violence, abuse, or weapons

**Safe alternatives for dark romance copy:**
- Instead of describing violence directly, reference the EMOTIONAL impact: "when he finds
  out what her father did" not "when he finds out her father beat her"
- Instead of "he shot him" or "empties a clip," use "touch her and die energy" or reference
  the protectiveness without the specific violent act
- Instead of explicit spice, use suggestive language: "clear your schedule," "lock your
  door," "the tension breaks"
- "Dark themes" and "explicit content" in a WARNING line are generally safe
- The trope list can say things like "Touch Her and Die" because tropes are understood as
  genre signals, not literal violence

**When in doubt:** If a line describes a specific violent act or body part, rewrite it. The
ad should convey the ENERGY and EMOTION of the scene without the specific details that
trigger Meta's bots. The reader will find the details in the book.

### Above the Fold
- The first ~90 characters of primary text appear before the "See more" button. This is the
  most important line of the entire ad.
- The algorithm reads 350-500 words of your ad to determine targeting.

### Character Limits — What Actually Matters

Meta has no documented 400-character algorithm threshold. Treat length as a craft constraint,
not a hard rule. The real, verified Meta limits:

- **Primary text "See More" cutoff: ~125 chars** in Feed placements (mobile). After this,
  ~99% of viewers don't click See More. Front-load your hook in the first 125 chars — that's
  the only text most people read.
- **Headlines: 40 chars max** for mobile truncation (truncation actually starts around 27).
- **Descriptions: NOT a short 25-char field in this skill.** The Description field here is
  used as a rotating SEO block (Payload / Comps / Vibe Stack / Keyword Sink / Wildcard). Write
  the full blocks — do not trim descriptions to a character count. The old 25-char rule does
  not apply to how this skill uses the field.

**What this means for expansions:** length itself isn't the rule. The rule is "hook lands in
the first 125 chars." After that, length is determined by whether the words are doing work.
Elaborate paragraphs that don't earn their space bury the hook for the See More clickers and
add nothing for the 99% who never see them. Cut for fluff, not for length. A longer expansion
is fine when every line earns its weight through flow and emotional payoff. What matters is
"hook above the See More fold + every word does work," not a fixed character count.

### Caption / Primary-Text Opener Pattern

The opening line of the primary text determines who stops scrolling. The same creative can
swing wildly in reach based purely on the opener. Make a CLAIM about the characters or the
dynamic — don't restate what's on-screen, and don't reach for a recycled BookTok formula.

**Openers that WIN:**
- **Declarative claim about character dynamics:** "She's the one who sets the terms. She tells
  him what the rules are."
- **Short scene-setting sentences:** "He'd never been kissed before her. He didn't know what
  he was missing."
- **Direct quote + claim:** "'Chase me. Hunt me.' She said this. To a monster."
- **Punchy mood line:** "Their love language is bedtime threats and forehead kisses."

**Openers that LOSE (retired BookTok-narrator formulas — do NOT use):**
- POV restating the on-screen scene: "You're in the forest with your monster..."
- Generic character setup: "He's an ancient creature who's survived centuries..."
- Meta commentary about the scene: "The most intense part of this scene isn't..."
- "I'm completely normal about the fact that..." / "Totally normal."
- "Me realizing the [character] actually..." formula
- "Nobody told me this book was going to make me feel things..." formula
- "You'll love [BOOK] by [Author]... if you love..." template used as the OPENER — it belongs
  at the trope bridge, not the first line

**The rule:** Make a CLAIM about the characters. Don't restate what's on-screen. Don't reach
for a known formula. The reader will see the creative — the copy sells the BOOK by making a
statement about the dynamics.

### No Hook Duplication

When the creative is a video with on-screen text (excerpt reel, hook overlay, quote video),
the ad copy primary text must NOT restate that hook. The viewer sees the video first, then
reads the copy. Repeating the hook wastes the only real estate you have to explain WHY they'll
love the book.

- ❌ Caption restates on-screen text: "She told the monster to hunt her. He counted to eight."
- ✅ Caption makes a claim the video sets up: "She's the one who sets the terms. She says 'I
  trust you' before she runs."

The video sells the moment. The copy sells the book.

## The Copy Formula

Every ad follows this five-part structure.

### 1. Hook
The first line(s). Stops the scroll in under 2 seconds. Must be under ~90 characters to
appear above the "See more" fold.

**The hook must match the avatar and the creative.** A spicy excerpt works for the Spice
Reader. An emotional gut-punch works for the Healing Journey reader. A power moment works
for the Mafia Queen reader. Don't default to one type — pick the hook that would stop THIS
specific reader mid-scroll.

Hook types:

- **Book excerpt or quote** — Actual dialogue or a short excerpt from the book. This is the
  strongest hook type for romance ads. The excerpt can be spicy, emotional, intense, funny,
  tender, or terrifying — whatever matches the avatar and creative. Pull a line that makes
  the reader go "I need this book" without any other context.
- **Reframed character moment** — Not a direct excerpt but capturing a character's energy or
  a scene's tension in ad-friendly language
- **Declarative stakes** — A factual statement about the premise that makes the reader go
  "wait, what?"
- **Mini-story opening** — 2-3 lines that unfold like a trailer, each escalating

The best-performing romance ads typically lead with actual book content — a quote, an
exchange, a moment that captures the book's energy. Match the excerpt to the avatar: an
emotional confession for the pining reader, a possessive declaration for the obsessed-hero
reader, a power move for the strong-heroine reader, a spicy line for the heat reader.

### 2. Stakes Bridge
One or two sentences that contextualize the hook for cold audiences. Include genre signaling —
say "vampire king" before the hero's name, "bodyguard" before his title. Cold audiences need
to know immediately what kind of book this is.

**Use the book's specific weirdness.** Specificity sells. Don't write generic romance
summaries — find the strangest, coolest, most THIS-book detail and put it right in the ad.
"A vampire king who hasn't fed in 200 years" hits harder than "a powerful supernatural hero."
"She's a mortal librarian cataloging his war crimes" beats "an unlikely pair." Whatever makes
this book different from every other book in its subgenre — that's what goes in the stakes
bridge.

### 3. Trope Bridge + Trope List

**The trope bridge is the line that connects the expansion to the trope list.** It flows
directly INTO the trope list as one connected unit. The tropes complete the bridge sentence.
Do NOT separate the bridge from the trope list with a standalone paragraph — they must read
as one continuous thought.

**The bridge follows this formula:**
"You'll love [Title] by [Author], a [subgenre], if you love..."

Then the emoji trope list immediately follows, completing the sentence.

**Vary the bridge across the 5 variations.** Don't use the exact same phrasing every time.
Iterations include:
- "You'll love [Title] by [Author], a [subgenre], if you love..."
- "If you love [specific thing this avatar cares about], you need [Title] by [Author]. A [subgenre] with..."
- "You'll love [Title] by [Author] if you love [subgenre] with..."
- "[Title] by [Author] is a [subgenre] for readers who love..."

The bridge always names the title, author, and subgenre so cold audiences know exactly what
they're looking at. And it always leads directly into the trope list with "if you love..."
or "with..." so the tropes read as a continuation, not a separate block.

**Example (correct — bridge flows into tropes):**
```
You'll love Night Fury by Melissa Cummins, a dark paranormal vampire romance, if you love...

🌙 Fated Mates / Vampire Mate Bond
🌙 Tortured Hero Who Falls First
🌙 He Waited for Her for Six Months
```

**Example (wrong — bridge is disconnected from tropes):**
```
Night Fury by Melissa Cummins. Dark paranormal vampire romance.

🌙 Fated Mates / Vampire Mate Bond
🌙 Tortured Hero Who Falls First
```

The reason this matters: the "if you love..." framing turns the trope list into a personal
invitation rather than a feature list. The reader scans the tropes thinking "yes, yes, YES"
because they're answering the question the bridge just asked them. It's the difference between
being told about a book and being asked if this book is for them.

**Emoji-led trope list.** Pick ONE on-brand emoji and use it consistently throughout.

**Trope list formatting — STACKED, no blank lines between items.** The trope list is a
single tight visual block. Put a braille blank (⠀) BEFORE the first trope (after the
"if you love…" bridge) and AFTER the last trope (before the warning line). Do NOT put a
blank line between individual tropes — that turns the list into spaced-out paragraphs and
breaks the scan rhythm. The reader should be able to flick their eyes down the list in
one motion.

```
You'll love [Title] by [Author], a [subgenre], if you love...
⠀
🖤 Trope one
🖤 Trope two
🖤 Trope three
🖤 Trope four
🖤 Trope five
🖤 Trope six
🖤 Trope seven
⠀
⚠️ WARNING: ...
```

**Emoji guide by subgenre:**
- Dark romance / dark mafia: 🖤
- Paranormal / vampire: 🌙 or 🦇
- Monster / creature: 🖤 or 🐾
- Contemporary / steamy: ❤️‍🔥
- Romantasy / fantasy: ⚔️ or 🗡️
- Historical: 🌹
- Reverse harem / why choose: 👑

These are starting suggestions — the author can pick whatever emoji matches their brand. If
the book crosses subgenres, pick the emoji that matches the PRIMARY reading experience.

The trope list does double duty: it tells readers what to expect AND it feeds Facebook's
algorithm with targeting keywords.

### 4. Social Proof / Warning Line

Reader review with star rating. Emotional reactions over polished praise.

**Warning line rules:**
- A warning line ("⚠️ WARNING: ...") only earns its space when it warns about
  CONTENT intensity ("Impossible to put down. Clear your schedule." /
  "You will not put this down. Don't start it at bedtime."). That's a real
  warning the reader registers as a promise of intensity.
- **For PRE-ORDER ads, drop the warning line entirely** unless you have a real
  content warning. A warning that says "Pre-order now. [Date] cannot come
  fast enough" just restates the CTA in dramatic font and adds nothing. Cut.

### 5. CTA
Matches the ad destination (confirmed in Step 5 above).

**Pre-order CTAs include the "read it early" perk** when destination is wide
retailers + buy direct. Buying direct (Shopify) ships earlier than retailers
hold pre-orders, so name that value:

> Pre-order [Title] in ebook or paperback from your favorite retailer or buy
> direct from [Author] to read it early! Releases [date].

### Expansion Discipline (apply BEFORE writing the trope bridge)

Applies to the paragraphs between the hook and the "You'll love..." bridge.

> ### ⛔ GUIDELINE: Keep hook + expansion + bridge tight — usually under ~400 characters
>
> 400 is a guideline, not a hard cap. Tighter expansions land harder, scan faster
> above the fold, and let the trope list do the SEO/targeting work. A long expansion
> buries the hook — but more length is fine when every line earns its weight. The real
> rule is "hook above the See More fold + every word works" (see Character Limits above),
> not a fixed character count.

After drafting the expansion, run it through these cuts:

1. **2 paragraphs MAX between hook and bridge.** Often 1 chunky paragraph or
   2 short paragraphs (1-3 sentences each). If you wrote 3+, at least one is
   cuttable.

2. **Cut detail-stacking lists.** "Bought a thousand books. Took cooking
   lessons. Studied color theory so the bedroom paint would soothe her." →
   pick the strongest single detail or use a summary phrase ("He prepared
   for her for a year").

3. **Cut BookTok narrator openers.** "I'm not okay. I'm telling everyone."
   "I had to put my phone down." Get to substance. Use one of these MAX
   only if the entire variation is BookTok-voiced.

4. **Cut wrap-up / subtext sentences.** "And the size difference becomes
   the whole point of the scene." "Made for him in every way." "He was
   right." These restate what the previous sentence said. Cut.

5. **Cut secondary character name-drops** (cold traffic doesn't know them).

6. **Cut hook tails when they don't add tension.** "There's no way that's
   going to fit inside of me" → "There's no way that's going to fit."
   Shorter usually hits harder.

7. **Use the SAME standard bridge across ALL variations.** "You'll love
   [Title] by [Author], a [subgenre], if you love..." Do not write fancy
   custom bridges per variation. Consistency is the bridge's job.

8. **Don't repeat the hook's framing in the expansion.** The hook is doing
   one job (religious irony, size kink, possessive declaration, etc.). The
   expansion's job is to EXPAND THE SCENE'S ENERGY, not echo the hook.
   - Hook is religious-irony ("You don't beg God. You beg me.") → expansion
     shows HIM (worship/possessive/devoted), NOT more deity commentary
   - Hook is size kink ("won't fit") → expansion shows him preparing/devoted,
     NOT more size jokes
   - Hook is possessive ("Mine.") → expansion shows what he's done for her,
     NOT more "mine" energy
   The hook is the angle of attack. The expansion is the payoff.

9. **Expansions are bound by creative scope, same as headlines.** Don't
   reference scene details that aren't in the actual video. If a planning-CSV
   line was cut from the final video (e.g., a tail or anatomy detail),
   the expansion CANNOT reference it. Treat expansions like headlines: only
   reference what's IN the creative the viewer just watched. Ask the author
   what's actually in the final video when uncertain.

## Output Format: Paste-Ready Ad Copy

The final deliverable should be **paste-ready** — the author copies and pastes directly into
Meta Ads Manager with zero assembly required. Deliver the output in chat unless the author
asks to save it as a file.

### Meta Line Break Formatting

**Critical:** Meta Ads Manager collapses regular blank lines when you paste. Paragraphs that
looked separated in Google Docs or your text editor will smash together into a wall of text
in the ad preview. This ruins the mobile formatting that makes ads readable.

**The fix:** Place an invisible braille blank character (⠀ — Unicode U+2800) on every blank
line between paragraphs. It looks invisible but Meta reads it as content, so the spacing holds.

**When saving ad copy as a file: ALWAYS USE .docx. NOT .md, .txt, or markdown.**

Use `python-docx` (installed by default) to build the file. Insert the braille blank
character (⠀) on every blank line between paragraphs as its own paragraph (a paragraph
containing only "⠀"). Set US Letter (8.5x11), 1" margins, Arial 11pt body. Use heading
styles for navigation. Add explicit "PASTE EVERYTHING BELOW INTO PRIMARY TEXT ↓" and
"↑ PASTE STOPS HERE ↑" markers around each ad block so the author knows exactly what
to select.

**Why .docx and not .md:** Markdown viewers visually collapse blank lines that contain
only the braille char, so the document LOOKS broken even though the chars are technically
there. .docx renders the braille chars as visual blank lines AND preserves them on copy
into Meta. The chars survive paste, the spacing holds, the author trusts the file.

**When delivering ad copy in chat:** Warn the author about the Meta line break issue and
offer to save the copy as a .docx file with the invisible characters pre-inserted. Say
something like: "Heads up — Meta Ads Manager collapses blank lines when you paste. Want
me to save this as a .docx with invisible spacing characters already built in? That way
you just copy and paste straight into Ads Manager and the paragraphs stay separated."

### Primary Text: 5 Variations

Write 5 variations of the primary text. Each variation targets a **different reader avatar**
from the avatar profiles.

**How hooks work across variations depends on the creative:**

**If the creative is a VIDEO with a specific hook/excerpt on it:** All five variations must
hook from the SAME SCENE as the video. The viewer just watched that excerpt — the ad text
below it must connect to what they saw. The hook doesn't have to be the exact same quote
every time, but it MUST come from that scene or the surrounding dialogue/action. For example,
if the video excerpt is "Don't tease me with a good time," variations could open with:
- The full exchange: "If you get hurt, I will punish you." "Don't tease me with a good time."
- A shorter pull: "Don't tease me with a good time."
- Another line from the same scene: "I'll punish you later."
- A description of the moment: They're flirting. In the middle of a raid. With guns drawn.

What you CANNOT do: make up a quote that isn't in the book, or pull a quote from a
completely different scene that has nothing to do with the video. The hook must match what
the viewer just watched.

What changes across variations is the EXPANSION — each one takes that same scene's energy
and spins it toward a different avatar's desires.

**If the creative is an IMAGE or the author chose "copy first":** Each variation must have
a DIFFERENT hook. Do NOT copy the same hook line across all five. The hook is the first
thing the reader sees — if all five ads open identically, there's no point in five variations.
Each hook should target its specific avatar, use a different excerpt/quote/angle from the
manuscript, and be under ~90 characters for above-the-fold.

If the author chose multiple hooks during the hooks step, distribute them across variations.
If the author chose one hook and the creative is not a video, use it for ONE variation and
write different hooks for the other four.

**The trope list and CTA are STATIC across all variations.** The expansion and social proof
can vary. This lets the author test different angles while keeping the core trope targeting
consistent.

For each variation, provide a COMPLETE, self-contained ad block:

```
---
**VARIATION [N]: [Avatar Name] — [Framework]**
Target: [One-line description of who this variation speaks to]
---

[Hook — the first line, under 90 characters for above-the-fold]

[Expansion — 2-4 sentences that build on the hook, contextualize for cold audiences,
and bridge to the trope list]

[emoji] [Trope 1]
[emoji] [Trope 2]
[emoji] [Trope 3]
[emoji] [Trope 4]
[emoji] [Trope 5]
[emoji] [Trope 6]
[emoji] [Trope 7]

[Social proof — warning + reader quote + star rating]

[CTA — matches the ad destination]

---
PASTE THIS ENTIRE BLOCK AS YOUR PRIMARY TEXT IN ADS MANAGER
---
```

Each variation is COMPLETE. The author copies the block between the paste markers and drops
it straight into the Primary Text field. No assembly, no mixing and matching parts.

### Frameworks for the 5 Variations

Use the frameworks that fit the creative, book, and avatars. Pick 5 different ones:

- **Main Character: Hero's POV** — Deep POV showing his obsession, devotion, or internal conflict
- **Main Character: Heroine's POV** — First-person from her perspective
- **BookTok Friend: Unhinged Recommendation** — "This book WRECKED me" energy
- **BookTok Friend: Tension and Dynamic** — Push-pull, banter, tenderness vs. intensity
- **Primal/Kink-Curious Reader** — Safe entry point, consent-forward, she initiates
- **Author Invite** — The author's voice, why they wrote these characters
- **Avatar-Specific** — Tailored to a specific avatar's desires

### Headlines: 5, Consolidated Pool

A single pool of 5 headlines. Facebook mixes and matches automatically, so each must work
with any variation. Include one of each purpose:

1. **Genre signal** — Title + subgenre (~20-25 chars)
2. **Heroine power** — What SHE does, grounded in a specific scene or ability from the Book Analysis
3. **Hero devotion** — What HE feels or does for her, grounded in a specific scene from the Book Analysis
4. **Scene-specific tension** — A moment from the creative's scene that creates tension or emotional pull
5. **Trope signal** — A SINGLE trope stated as a hook. Pick ONE trope from the trope list and make it vivid. Do NOT stack multiple tropes or repeat a trope already covered by another headline. The Book Analysis trope list has many options — use a different one than the obvious choice.

**Optional 6th headline — Platform signal:** If the book is in Kindle Unlimited, add
"Kindle Unlimited [Genre] Pick" (e.g., "Kindle Unlimited Romance Pick"). This acts as an
implied endorsement and consistently performs well. For other platforms: "On Kickstarter Now,"
"Read Free in KU," etc. Only use this if the author confirms the platform.

**All headlines must be under 40 characters** to avoid truncation on mobile. Shorter is better.

**Creative-scope rule:** When a creative has been provided (image or video), ALL 5
headlines must connect to the scene or moment that actually appears IN the creative — not
to nearby scenes in the manuscript, not to a moment that happens paragraphs later, not to
the book's climax. The viewer sees the creative first. A headline that references a moment
outside the creative's scope breaks the connection even if it sounds related. The genre
signal headline (Title + subgenre) is the only exception since it's a label by design.

Before writing headlines, identify the exact boundaries of the creative's scene. If the
excerpt covers the hero sketching the heroine, headlines about what happens when she wakes
up are OUT OF SCOPE — even if the awakening happens in the same chapter.

**The #1 headline rule: CURIOSITY.** Every headline (2-5) must make the reader ask a
question they need answered. If someone can read the headline, shrug, and keep scrolling,
it fails. The question doesn't need to be explicit — it can be implied through asymmetry
("he knew her before she knew him"), scale ("700 years"), or tension ("find out").

Test each headline: "What question does this create?" If you can't name one, rewrite it.

**The #2 headline rule: SHOW, don't TELL.** Headlines 2-5 must put the reader inside a
specific moment, conflict, or trope — not summarize the book in generic terms. Pull from
the Book Analysis: the actual scenes, character dynamics, powers, and specific moments that
make THIS book different from every other book in the subgenre.

Bad: "Two rival families. One complicated romance." (generic, could be any book)
Bad: "A romance full of drama and danger." (meaningless, zero specificity)
Bad: "Can they overcome their differences?" (reads like a Hallmark tagline)
Bad: "Fated Mates. Mate Bond. HEA." (trope stacking — three labels, zero feeling)
Bad: "She Was Unconscious. He Was Sketching." (states two facts, creates zero questions —
  no emotional pull, no intrigue, no reason to stop scrolling)
Bad: "She Woke Up. He Couldn't Breathe." (sounds scene-specific but the awakening is
  paragraphs away from the sketch excerpt — breaks creative scope)

Good: "She saved the mafia heir she was raised to hate." (specific trope + conflict)
Good: "One bullet. One bed. One enemy she can't stop wanting." (punchy, trope-loaded)
Good: "He once vowed to kill every O'Malley. Now he's kissing one." (stakes + tension)
Good: "Touch Her and Die. He Means It." (single trope, made vivid and specific)
Good: "700 Years. She's His First Muse." (scale + specificity = instant curiosity)
Good: "He Drew Her Before She Knew His Name." (asymmetry creates the question: how?)

Every headline should make the reader feel something specific about THIS book. If the
headline could apply to any romance novel, rewrite it.

**Paste format:**
```
HEADLINES (paste these into the Headline field — Facebook will rotate them):
1. [Headline]
2. [Headline]
3. [Headline]
4. [Headline]
5. [Headline]

PAIRING GUIDANCE (for your reference — Facebook handles rotation automatically):
- Variation 1 ([avatar]) pairs best with Headlines X, Y
- Variation 2 ([avatar]) pairs best with Headlines X, Z
[etc.]
```

### Descriptions: 5, Consolidated Pool

A pool of 5 descriptions. Meta allows multiple descriptions and rotates them automatically,
just like headlines. Each description feeds the algorithm a different signal type.

Write one of each:

1. **The Payload** — 2-3 sentence mini-synopsis as a hook. Core premise, primary tropes, genre
   signal, series/standalone info, HEA guarantee.

2. **The Comps** — Comp authors with specific descriptors of WHY each comp matches. "Rina Kent's
   dark mafia worlds" not just "Rina Kent."

3. **The Vibe Stack** — Cross-genre comparisons using the confirmed comp authors, their
   series, or pop culture references (TV shows, movies). "If you love X, Y, and Z... this
   is your next obsession." ONLY use comps and series that the author has already approved
   in the Book Analysis or during Step 2. Do NOT introduce new authors or series that weren't
   discussed and confirmed. If you want to reference a series name (e.g., Black Dagger
   Brotherhood, Immortals After Dark, Dark-Hunters), it must belong to one of the confirmed
   comp authors.

4. **The Keyword Sink** — Massive comma-separated list of every relevant keyword, trope, and
   search term. Pull from the avatar profiles' "Tropes she searches for" lists.

5. **The Wildcard** — A fifth description that combines elements or takes a different angle.
   Could be a punchy one-liner, a reader quote framed as a description, or a hook + trope
   combo. Match it to the book's strongest selling point.

**Paste format:**
```
DESCRIPTIONS (paste these into the Description field — Meta will rotate them):
1. [Payload]
2. [Comps]
3. [Vibe Stack]
4. [Keyword Sink]
5. [Wildcard]
```

## Critique Pass

After writing all 5 variations, 5 headlines, and 5 descriptions, do a critique pass before
presenting to the author. Review each piece and ask:

**For each variation's hook (above-the-fold line):**
- Would someone who's never heard of this book stop scrolling for this line?
- Does this hook match the avatar it's targeting? (A spicy line for the spice reader, an
  emotional line for the healing reader, a power moment for the strong-heroine reader)
- Is it under ~90 characters?
- Is it different from every other variation's hook?
- Does it connect to the creative (if one was provided)? If the creative is a video with
  a specific hook/excerpt, does the ad copy play off that same scene and energy?

**For each expansion:**
- Does it build on the hook's energy or change direction awkwardly?
- Does it give a cold audience enough genre signaling to know what kind of book this is?
- Is it concise? Can any sentences be cut without losing impact?

**For headlines:**
- Under 40 characters?
- Would each one make sense paired with ANY of the five variations?
- **Curiosity test:** For each headline, name the question it creates. If you can't name
  one, the headline is flat — rewrite it. (e.g., "He Drew Her Before She Knew His Name"
  creates "how is that possible? why didn't she know?")
- **Show-don't-tell:** Do headlines 2-5 reference a specific scene, action, or moment —
  not a generic label or trope list?
- **Creative-scope check:** If a creative was provided, is the moment in each headline
  actually IN the creative — not in a nearby scene that's paragraphs away in the manuscript?
  (Only the genre signal headline is exempt)
- Is the trope signal headline using a SINGLE, distinct trope — not stacking synonyms or
  repeating a trope already covered by another headline?
- Could each headline ONLY be about THIS book? If you could swap in another title and it
  still works, it's too generic — rewrite it using details from the Book Analysis

**For descriptions:**
- Does each one serve a distinct purpose (payload, comps, vibe stack, keywords, wildcard)?
- Do the Comps and Vibe Stack descriptions ONLY reference authors and series the author
  confirmed? Check against the Book Analysis comp list. If any name wasn't approved, remove it.

**Meta Safety check (run this on EVERY piece of copy):**
- Any profanity or censored profanity? Remove and replace with character-voice alternatives
- Any anatomy words (breast, nipple, tit)? Remove entirely
- Any specific violence descriptions (shot him, emptied a clip, took punches, was beaten)?
  Rewrite to convey the emotion without the specific act
- Any government titles? Remove or generalize
- Could any line be read as promoting violence, abuse, or sexual content by a bot that
  has zero context? If yes, rewrite it

If anything doesn't pass, rewrite it before presenting. The author should receive polished,
scroll-stopping, Meta-safe copy — not a first draft that gets their ad rejected.

## Reel Scripts

When the author provides video footage or asks for a reel script, start with the hook strategy
before structuring the script.

**Step 1: Pick the hook strategy.** Open `references/video-hook-strategy-guide.md` and use
the Quick Reference table to match the scene type to the best hook strategies. Read the full
strategy entry for the formula and examples. Present 2-3 hook strategy options to the author
and let them pick.

**Step 2: Structure the script.** Once the hook is chosen, build the time-coded script:

| Time | On Screen Text |
|------|---------------|
| 0:00-1.5s | [Hook — from the chosen strategy, declarative, stops the scroll] |
| 1.5-3s | [Second beat — deepens the mystery] |
| 3-4.5s | [Escalation — stakes get higher] |
| 4.5-6s | [Twist or beat drop moment] |
| 6-8s | [Tension peak] |
| 8-9.5s | [Resolution tease] |
| 9.5-12s | Book cover + Title |

**Key principles:**
- Total length: 10-12 seconds (short enough for full watch-throughs, which the algorithm rewards)
- First frame creates immediate curiosity — declarative statements beat conditional ones
- Each card escalates — build like a thriller trailer
- End with the book cover and a simple CTA

**Step 3: Generate variations.** Use the Hook Variation System from the guide (add "that moment,"
flip sentence structure, switch POV, add emoji emphasis) to create 3-4 alternate hook lines
from the same scene. Present them to the author so they can test which performs best.

For TikTok/BookTok-specific considerations, also reference `references/tiktok-hook-research.md`
for excerpt-over-background video format, background selection, text highlighting, and sound.

## The Andromeda Framework

Meta's ad algorithm rewards creative diversity at the account level:

- **New creatives go INTO existing ad sets** — don't create separate testing campaigns
- **Different creative types matter** — Canva graphics, cover art, AI images, video, live photos.
  Aim for 3+ types active at any time.
- **Copy should vary between creatives** — different hooks, different angles, different trope
  emphasis

## Paid vs. Organic Copy

This skill writes **paid ad copy only** — full uncensored language, retailer names, direct CTAs.
Organic social adaptation (algospeak, softer CTAs) is a separate step.

## Reference Files

- `references/video-hook-strategy-guide.md` — **Start here for reel scripts.** 23 proven video
  hook strategies with worked examples, variation systems, advanced templates, and a scene-type
  quick reference table
- `references/copy-examples.md` — Example ad copy across subgenres showing the formula in action
- `references/tiktok-hook-research.md` — TikTok/BookTok hook formulas, excerpt-over-background
  video format guide, and Andromeda algorithm considerations
- `references/comp-authors-by-subgenre.md` — How to find comp authors through Amazon, Goodreads,
  BookTok, and category research, plus starter lists by subgenre
- `references/excerpt-mining-guide.md` — How to find, structure, and censor romance excerpts
  for Meta ads. Manuscript search techniques, ideal length (200-500 words), cliffhanger
  endings, and step-by-step censor editing for profanity, anatomy, and violence

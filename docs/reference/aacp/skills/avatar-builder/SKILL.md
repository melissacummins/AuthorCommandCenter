---
name: avatar-builder
description: >
  Build reader avatar/persona marketing profiles from a book manuscript. Use this skill whenever
  the user asks to "build avatars," "create reader profiles," "do the avatar work," "who would
  read this book," "what reader types does this book appeal to," "build personas," "make the
  avatar profiles," or any request to identify and profile the distinct reader types who would
  love a specific book. Also triggers when the user says "do the avatar work for [book]," "we
  need avatars before we write copy," "start with the avatars," or references reader personas
  in the context of ad targeting. This skill should run BEFORE writing ad copy for any book
  that doesn't already have avatar profiles. Each book gets its own avatar set — profiles are
  never updated or merged across series books because each book attracts readers for different
  reasons.
version: 1.0.0
---

# Avatar Builder — Reader Persona Marketing Profiles

Build detailed reader avatar profiles from a book manuscript. These profiles power every
downstream marketing task: ad copy, headlines, social posts, email hooks. Without them,
ad copy defaults to generic genre filler instead of connecting to what's actually in the book.

## How This Fits the Workflow

Avatar building is part of the `/setup-books` Book Analysis. When the author runs `/setup-books`,
the full manuscript is read ONCE and the output includes both the Story Overview AND the avatar
profiles. This avoids re-reading the manuscript multiple times.

If the author asks to "build avatars" as a standalone request (separate from setup), check
whether a Book Analysis already exists:
- **If yes:** Read it and build avatars from the Story Overview + a focused re-read of the
  emotional beats and key scenes identified there. No need to re-read the entire manuscript.
- **If no:** Ask the author for the manuscript and do a full read-through. Build the Story
  Overview and avatars together, then save as a Book Analysis.

## Why This Matters

The difference between "A dark monster romance with a possessive hero" and "She told the
monster to chase her" is the difference between a generic ad and one that stops the scroll.
Avatar profiles are what make that specificity possible. They're built FROM the manuscript,
not from trope databases or ad frameworks, so the hooks naturally connect to real scenes,
real dialogue, and real emotional dynamics.

## Step 1: Read the Manuscript (or the Book Analysis)

If doing a full read-through, actively track:
- **Character details**: Physical descriptions, personality traits, backstory, speech patterns,
  specific habits and preferences (not "she likes food" but "she makes salted caramel
  cheesecake at 6 AM")
- **Relationship dynamics**: Who initiates what, power dynamics, how trust builds, turning
  points, who falls first
- **Tropes in action**: Find where they live in the manuscript. "Fated mates" means nothing
  without knowing the specific scene. "Touch her and die" means nothing without the specific
  moment he snapped.
- **Emotional beats**: Moments that would make a reader gasp, scream, cry, or throw their phone
- **Spice/kink elements**: What's on the page, how it's framed, who initiates, what makes it
  distinctive
- **Worldbuilding hooks**: Anything unique about the setting, creature lore, magic system
- **Representation**: Character identities, body types, cultural details — anything a reader
  might specifically seek out
- **Themes**: Healing from trauma, finding identity, choosing yourself, redemption, found family

## Step 2: Identify the Avatars

Ask: "Who are the distinct reader types who would love this book, and why?"

Each avatar should be a recognizable reader type with a specific reason for picking up THIS
book. The key word is "specific."

**How to find avatars:**

- **Start from the manuscript, not from a list of tropes.** If the hero has never been kissed
  despite being centuries old, that's a "virgin hero reader." If the heroine has stretch marks
  that get worshipped, that's a "body-positive romance reader." Let the book tell you who its
  readers are.

- **Look for what's distinctive.** Every romance has "enemies to lovers." That's not an avatar.
  But if the heroine kills the man she was sold to and takes his empire? That's a specific
  dynamic that attracts a specific reader.

- **Think about emotional needs, not just genre preferences.** A "healing/trauma recovery
  reader" isn't looking for a genre. She's looking for emotional catharsis. Avatars defined
  by emotional need produce better hooks.

- **Don't force it or limit yourself.** Some books will have 8 avatars. Some will have 15.
  Create as many as feel genuine. If you're stretching, stop. If you keep finding new reader
  types, keep going.

- **Each avatar must be grounded in specific scenes.** If you can't point to at least 2-3
  scenes that would hook this reader, the avatar isn't real. Cut it.

## Step 3: Write the Profiles

For each avatar:

```markdown
### [Number]. The [Avatar Name]
**Who she is:** One to two sentences describing this reader type and what she's looking for.
Be specific about what she's tired of or what she craves. Describe a real person, not a
marketing segment.

**What draws her in:**
- [Specific detail from the manuscript — character actions, dialogue, dynamics]
- [Another specific detail]
- [What makes THIS book's version of the trope special]
- [3-6 bullets total, each grounded in manuscript specifics]

**Best scenes for this avatar:**
- [Specific scene with chapter reference if possible]
- [Another scene — these are the scenes you'd build an ad around for this reader]
- [2-4 scenes that would hook this specific reader type]

**Tropes she searches for:** [comma-separated list of search terms this reader would actually
type into Amazon, TikTok, or Goodreads — lowercase, reader language not industry jargon]
```

**Voice notes:**
- "Who she is" should sound like describing a friend. "She's tired of romances where the
  heroine has to be a size 2 to be desired" not "This segment seeks body-inclusive representation."
- "What draws her in" bullets should be vivid. Pull actual dialogue, actual character actions.
  "He memorizes her coffee order" beats "He's attentive."
- "Tropes she searches for" uses the words readers actually use. "curvy heroine" not
  "body-diverse protagonist."

## Step 4: Write the Master Lists

After all individual profiles, add:

### Tropes Master List
Comprehensive comma-separated list of every trope and search keyword. Pulls from all avatars
plus any tropes that don't fit neatly into one. Used for SEO blocks, keyword sinks, ad
descriptions, and algorithm targeting.

### Themes Master List
Bulleted list of deeper emotional themes. Phrased as emotional truths, not genre labels:
"The duality of a creature built for violence choosing tenderness" not "violence vs. tenderness."

## Output

Present the avatar profiles in chat. If the author wants to save them as a file, ask where.

## Reference Example

See `references/example-avatar-profiles.md` for a complete example showing the level of
specificity, manuscript grounding, and reader-language voice to aim for.

## Important Rules

- **Each book gets its own avatars.** Never update based on a sequel. Book 2 gets its own
  because it attracts readers for different reasons.
- **Don't invent what's not in the manuscript.** Every detail must be traceable to the text.
- **Specificity is everything.** If an avatar's bullets could apply to any book in the genre,
  they're too generic. Rewrite with manuscript details.
- **Reader language, not industry language.** "Instalove" not "immediate romantic attachment."

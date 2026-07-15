// The built-in hook strategy library — the 23 tested BookTok/Bookstagram
// strategies from Author Ad Copy Pro (docs/reference/aacp/skills/
// ad-copy-writer/references/video-hook-strategy-guide.md), shipped with the
// app so every account gets them on every scan with zero setup. The user's
// own playbook entries EXTEND this library; they never need to re-import it.
// Update this file when the source guide changes — it ships with releases.

export interface BuiltinStrategy {
  title: string;
  pattern: string;
  example: string; // '' when the guide gives guidance without a verbatim example
}

export const BUILTIN_STRATEGIES: BuiltinStrategy[] = [
  { title: 'Trope Switch-Up', pattern: 'Introduce one trope, then escalate with a second using "WORSE" or "BETTER" — the switch creates a double-hit of intrigue.', example: "college student x professor? WORSE. he's also her best friend's dad" },
  { title: 'The Vulnerable Moment', pattern: 'The scene where a tough/guarded character finally cracks — the armor-down contrast is the scroll-stopper; "finally" implies buildup.', example: 'that moment when the tattooed biker finally says he wants him' },
  { title: 'Edge-of-Seat Feeling', pattern: "Name the specific feeling the reader has during a high-tension scene — the emotional experience, not the plot mechanics.", example: "that feeling when he knows he's still too far away to reach her in time" },
  { title: 'Plan vs. What Actually Happened', pattern: "Set up what the character intended, then reveal how it derailed spectacularly.", example: 'that moment when she sneaks in to kill her FUTURE HUSBAND but he made her beg instead' },
  { title: 'Spice Highlight + OMG Reaction', pattern: 'Bold dialogue framed as POV with gossip energy, not just heat. Use platform-safe wording.', example: "POV you're trying to take it slow but then she asks for just the tip" },
  { title: 'Spice Action with Context', pattern: "Add the specific detail that makes THIS spicy scene different: first time, species difference, power imbalance.", example: "when it's the human's first experience and the VAMPIRE won't let her run away" },
  { title: 'Unexpected/Dramatic Reaction', pattern: "The love interest's disproportionate, possessive, or primal reaction IS the hook.", example: "when her VAMPIRE stalker smells another man's scent on her and LOSES it" },
  { title: 'Spicy High Tension (Taboo Edge)', pattern: 'A moment both sexually charged AND socially transgressive — intimacy colliding with something forbidden.', example: '' },
  { title: 'Same Scene, Different Hook', pattern: "If a strong scene's hook underperforms, don't abandon the scene — reframe it: different leading detail, framing word, or reaction element.", example: '' },
  { title: 'Non-Video Hook Adapted', pattern: "If a line makes you react when you READ it, it makes viewers react on screen — lift lines that already work.", example: '' },
  { title: 'The First Time', pattern: '"First time" framing creates built-in emotional stakes; the simpler version usually wins.', example: "when it's the tattooed biker's first time" },
  { title: 'Spicy Kink Highlight', pattern: 'One specific intimate detail bold enough to stop a scroll, framed as "that moment when" for shared-experience feeling.', example: '' },
  { title: 'No Other Choice', pattern: 'The character is forced toward the one person they least want — POV framing makes it universal.', example: "POV you don't know who else to call so you call the one person you hate" },
  { title: 'Touch Her and Die', pattern: "The protective/possessive declaration moment — short, visceral, absolute.", example: 'when the ruthless mafia boss found her again after 6 years already making it clear' },
  { title: 'Love Declaration + Open Loop', pattern: 'End with "but then he says..." — the unfinished thought forces the viewer to need the payoff.', example: "when she thought she's marrying a ruthless mafia boss but then he says..." },
  { title: 'Possessive MMC Highlight', pattern: 'Jealousy or possessiveness manifesting somewhere unexpected — hot AND unhinged.', example: '' },
  { title: 'Trope Highlight (Question)', pattern: "Frame the book's central trope as a direct question to the viewer. Simple beats styled.", example: 'what do you do when the mafia king thinks you stole from him and forces you into marriage?' },
  { title: 'Supposed To vs. Instead', pattern: 'What the character was SUPPOSED to be doing vs. the distraction — everyday life colliding with tension.', example: '' },
  { title: 'Spice Highlight (Non-Graphic)', pattern: 'Suggestive beats explicit — restraint creates MORE curiosity. Emoji can stand in for the explicit element.', example: '' },
  { title: 'Unexpected Bedroom Dynamic', pattern: 'The expected dominant/submissive dynamic flips.', example: "when he's always been the one in control, until she makes HIM beg" },
  { title: 'Character Introduction (Trend Format)', pattern: 'Fill a trending intro format with actual character details.', example: "he's a 10 but he's dead and guilty of 3 murders and seeking a second chance" },
  { title: 'Text Exchange Highlight', pattern: "A text exchange where one character's reply reveals more than intended.", example: 'when she jokes about having other guys over and his text is not casual' },
  { title: 'Curiosity Gap', pattern: '[Subject] + [unexpected action that raises a question] — the viewer cannot scroll away without closing the gap.', example: 'She told the monster to chase her.' },
  // Added from verified 2026 research (docs/reference/hook-research-2026.md):
  { title: 'Premise Question', pattern: 'Pitch the whole premise as ONE direct question to the viewer — "would you read a book about…?" — compressing high-concept stakes and the central trope into a single sentence. Works from book facts alone; no scene needed. The best-documented viral book hook (1M+ views overnight) used this shape.', example: 'would you read a book about an island that appears every 100 years, where six rulers can break their curses and save their people?' },
  { title: 'Reader Promise', pattern: "Promise the FEELING or fantasy the book delivers to the reader (Meta's 'value promise' hook type) — what it will do to them, not what happens in it.", example: 'warning: this vampire will ruin every other book boyfriend for you' },
];

export function builtinPlaybookBlock(): string {
  return `HOOK STRATEGY LIBRARY (built-in, from tested BookTok performance data) — match moments to these strategies:\n${BUILTIN_STRATEGIES
    .map(s => `- ${s.title}: ${s.pattern}${s.example ? ` (e.g. "${s.example}")` : ''}`)
    .join('\n')}`;
}

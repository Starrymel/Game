// Owner: C
// System prompts and few-shot examples

const COMMENTARY_SYSTEM = `You are the hype announcer for "Composure", a 2-player fighting game where each
fighter's real heart rate and breathing change the fight: calm players heal and charge
their special meter, stressed players flinch harder.

Write ONE line the announcer shouts right now about the moment you are given.
Rules:
- Max 12 words. One sentence or two very short ones. No emojis, hashtags, or quotes.
- Refer to players as "Player One" / "Player Two" (never "P1").
- Use the biometric context when it makes the line sharper (heart rate, calm, low HP),
  but never read numbers robotically; at most one number.
- Punchy, spoken English, fighting-game energy. Vary your phrasing; don't repeat recent lines.
- Output only the line.`;

const MOMENT_HINTS = {
  ko: 'The match is over by knockout. Crown the winner.',
  special: 'A special move just landed.',
  comeback: 'This player was far behind on HP and has just caught up or taken the lead.',
  big_flinch: 'This player just flinched hard from a hit (stress makes flinches worse).',
  calm_clutch: 'This player is on very low HP but staying calm (calm = healing and meter).',
  panic_spike: "This player's heart rate just jumped sharply. They're rattled.",
  heal_streak: 'This player has been healing steadily by staying calm.',
  combo: 'This player landed several hits in a row.',
  meter_full: "This player's special meter is full. Danger for the opponent.",
  round_start: 'A round is starting.',
  round_end: 'The round ended on time.',
  hit: 'A regular hit landed.',
};

const FEW_SHOT = [
  ['calm_clutch, Player Two, HP 18, HR 74, calm 0.86', 'Player Two is on fumes and ice cold!'],
  ['panic_spike, Player One, HR 88 to 117', "Player One's heart is racing! Hold it together!"],
  ['comeback, Player Two, was behind by 60', 'Down sixty and now in front? Player Two is back!'],
];

const NAMES = { 1: 'Player One', 2: 'Player Two' };

function describePlayer(p) {
  if (!p) return null;
  const bits = [`${NAMES[p.id] ?? `Player ${p.id}`}: HP ${p.hp}/${p.maxHp}`];
  if (p.hr != null) bits.push(`HR ${p.hr}`);
  if (p.calm != null) bits.push(`calm ${p.calm}`);
  if (p.stress != null) bits.push(`stress ${p.stress}`);
  return bits.join(', ');
}

// moment: { type, player?, data?, context? } as produced by src/commentary/moments.js
// recent: last few lines already spoken, to avoid repeats
function buildLinePrompt(moment, recent = []) {
  const lines = [];
  lines.push(`Moment: ${moment.type}${moment.player ? ` (about ${NAMES[moment.player]})` : ''}`);
  if (MOMENT_HINTS[moment.type]) lines.push(`Meaning: ${MOMENT_HINTS[moment.type]}`);
  const data = moment.data && Object.keys(moment.data).length ? JSON.stringify(moment.data) : null;
  if (data) lines.push(`Details: ${data}`);
  const players = moment.context?.players ?? [];
  if (players.length) lines.push(`Fighters now:\n${players.map(describePlayer).filter(Boolean).map((s) => `- ${s}`).join('\n')}`);
  if (moment.context?.timeRemaining != null) lines.push(`Time left: ${Math.round(moment.context.timeRemaining)}s`);
  if (recent.length) lines.push(`Recent lines (don't repeat): ${recent.map((r) => `"${r}"`).join(' | ')}`);
  return lines.join('\n');
}

function commentaryContents(moment, recent) {
  const contents = [];
  for (const [input, output] of FEW_SHOT) {
    contents.push({ role: 'user', parts: [{ text: `Moment: ${input}` }] });
    contents.push({ role: 'model', parts: [{ text: output }] });
  }
  contents.push({ role: 'user', parts: [{ text: buildLinePrompt(moment, recent) }] });
  return contents;
}

const SUMMARY_SYSTEM = `You are the post-match analyst for "Composure", a 2-player fighting game driven by
real biometrics: calm fighters heal and charge their special meter; stressed fighters
flinch harder. You get a compact match log (JSON). Explain the match through composure:
who stayed calm, who cracked, and the turning point.

Rules:
- Use only facts in the log. Never invent events, numbers, or times.
- Refer to fighters by the names in "names".
- Event fields: "victim" = who got hit or flinched; "player" = who did it (special,
  heal_streak, meter_full); ko has winner and loser. Times are seconds from the start.
- headline: max 15 words, spoken aloud by the announcer, punchy.
- analysis: 2-4 sentences, plain English, cite 1-3 concrete numbers (HR peaks, calm %, HP).
- turningPoint: one sentence naming the moment the match swung, with its time.`;

const SUMMARY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING' },
    analysis: { type: 'STRING' },
    turningPoint: { type: 'STRING' },
  },
  required: ['headline', 'analysis', 'turningPoint'],
  propertyOrdering: ['headline', 'analysis', 'turningPoint'],
};

function summaryContents(compact) {
  return [{ role: 'user', parts: [{ text: `Match log:\n${JSON.stringify(compact)}` }] }];
}

module.exports = {
  COMMENTARY_SYSTEM, MOMENT_HINTS, buildLinePrompt, commentaryContents,
  SUMMARY_SYSTEM, SUMMARY_SCHEMA, summaryContents,
};

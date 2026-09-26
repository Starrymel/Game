// Owner: C
// Pre-written lines used when the API is slow or fails
//
// Templates: {p} = the moment's player, {o} = their opponent. Keep every line
// short (<= ~15 words) and speakable. These are also the lines worth pre-generating
// as audio, since they're what plays when everything else is slow.

export const PLAYER_NAMES = { 1: 'Player One', 2: 'Player Two' };

export const FALLBACK_LINES = {
  round_start: [
    'Fighters ready. Keep your hearts steady. Fight!',
    'Round {round}! Breathe in, and fight!',
    'Stay calm, stay dangerous. Fight!',
  ],
  round_end: [
    'That is the round!',
    'Time! Catch your breath, fighters.',
  ],
  ko: [
    'K.O.! {p} takes it!',
    'Lights out! {p} wins!',
    'And {o} goes down! {p} is victorious!',
    'Game over! Nerves of steel from {p}!',
  ],
  special: [
    '{p} unleashes the special!',
    'Special move! {o} felt that one!',
    'Here it comes, the big one from {p}!',
  ],
  comeback: [
    'What a comeback from {p}!',
    '{p} was left for dead, and now they lead!',
    'The tables have turned! {p} is back!',
  ],
  big_flinch: [
    '{p} is rattled!',
    'Ooh, {p} felt that one!',
    'Big flinch from {p}!',
    '{p} is shaken up!',
  ],
  calm_clutch: [
    '{p} is low, but ice cold!',
    'Look at that composure from {p}!',
    'On the ropes and totally calm. Clutch, {p}!',
  ],
  panic_spike: [
    "{p}'s heart rate is spiking!",
    'Uh oh, {p} is starting to panic!',
    'The pressure is getting to {p}!',
  ],
  heal_streak: [
    '{p} breathes and recovers!',
    'Calm mind, healing body. {p} is recovering!',
    '{p} is patching up!',
  ],
  combo: [
    'Combo from {p}!',
    '{p} is stringing them together!',
    'Relentless pressure from {p}!',
  ],
  meter_full: [
    '{p} has the special ready!',
    'Meter full! Watch out, {o}!',
  ],
  hit: [
    'Clean hit from {p}!',
    '{p} lands one!',
    'Nice shot, {p}!',
    '{o} takes a hit!',
  ],
};

export function fillTemplate(template, moment) {
  const p = moment.player;
  const vars = {
    p: PLAYER_NAMES[p] ?? 'The fighter',
    o: PLAYER_NAMES[p === 1 ? 2 : 1] ?? 'the opponent',
    round: moment.data?.round ?? moment.context?.round ?? 1,
  };
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

// Returns a fallback line for the moment, avoiding the most recent pick per type.
export function createFallbackPicker(rng = Math.random) {
  const last = {};
  return function pickFallbackLine(moment) {
    const pool = FALLBACK_LINES[moment.type] ?? FALLBACK_LINES.hit;
    let i = Math.floor(rng() * pool.length);
    if (pool.length > 1 && i === last[moment.type]) i = (i + 1) % pool.length;
    last[moment.type] = i;
    return fillTemplate(pool[i], moment);
  };
}

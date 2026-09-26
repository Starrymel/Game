// Owner: C
// Subscribes to bus events + state_snapshot

import { createMomentDetector } from './moments.js';

export const WATCHED_EVENTS = [
  'round_start', 'round_end', 'ko', 'special', 'meter_full',
  'flinch', 'hit', 'heal_tick', 'state_snapshot',
];

// Wires the moment detector to a bus. onMoment(moment) is called for every detected
// moment. Returns a stop() function that unsubscribes everything.
export function startCommentaryListener({ bus, onMoment, detectorOptions } = {}) {
  const detector = createMomentDetector(detectorOptions);
  const unsubs = WATCHED_EVENTS.map((type) =>
    bus.on(type, (payload) => {
      for (const m of detector.handle(type, payload)) onMoment(m);
    }),
  );
  return {
    detector,
    stop() {
      unsubs.forEach((off) => off());
    },
  };
}

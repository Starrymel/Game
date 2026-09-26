# Person B handoff

Implementation: src/mechanics.config.js exports the single mutable mechanicsConfig object and overrides all five Mechanics hooks. src/mechanics.js remains the neutral fallback.

## Integration for A

src/game.js reads getBiometrics(id) and calls updateBiofeedback(fighter, sample, dtSeconds, t) once for BOTH fighters before physics/hits. This prevents first-player update order from changing damage. Do not call the smoothing update inside individual hooks. The former cached biometric event subscription is no longer needed because it could mask a source switch.

Hooks return deltas; only A's engine mutates HP/meter. Healing and meter deltas are limited to remaining capacity. The existing engine emits flinch {player,magnitude,t} (0..1) and heal_tick {player,amount,t} (actual applied HP). B's effects subscribe to those events; no duplicate events are emitted.

main.js initializes the debug panel; render.js draws world effects before the fixed HUD. input.js ignores form controls and clears held input on focus/blur. No shared contract changes.

Debug overrides apply inside B's update, never replace A's getBiometrics function. HUD clearly says DEBUG; overridden snapshots retain source:'mock' to honor the contract's two-source enum. Sensor biometric_sample events still represent A's source, so D should use snapshots for gameplay-effective values during debug demos.

## Formulas and starting balance

- Average the last 8 distinct samples (~0.8 seconds at 10 Hz). Clamp HR to 40–200, breath to 4–40, calm/stress to 0–1. Invalid or >3-second-old samples use neutral damage/flinch, no healing, and a closed meter gate.
- Breath control = proximity to 10 breaths/min (10-breath tolerance) times steadiness (standard deviation across the window, 4-breath tolerance), each clamped 0–1.
- Regen = min(1.4, 1 × (1 + 0.4 × calm × breath control)) HP/sec when calm >=0.6, alive, and 1.4 seconds since the last hit.
- Effective stress = max(average stress, clamp((current HR − average HR)/25, 0, 1)).
- Damage = base × (0.92 + 0.16 × effective stress).
- Flinch = base duration × (0.8 + 0.4 × effective stress). For a 250ms base, 200–300ms.
- Meter opens at average HR 60–110 and stays open until below 57 or above 113, avoiding boundary flicker. Gain = base gain × (1 + 0.5 × breath control); passive base is 3/sec. A full meter remains usable while gated.
- dt is capped at 0.1 seconds. Dead players never regenerate.

Tune heal.delayMs first if retreating dominates, then heal.max. Tune flinch.max down if hits feel too sticky. Broaden meter.hrMin/hrMax for players whose comfortable baseline lies outside the default band. Keep damage within roughly ±8% during the first human playtest. These are game/demo parameters, not medical targets.

## Judge demo

Serve the repository over HTTP, open index.html, and click “10-second comparison demo.” This explicitly sets both players to 60 HP and 0 meter, P1 to calm and P2 to stress. Within ten seconds P1 reaches 74 HP and 45 meter while P2 stays at 60/0. Green glow, particles, CALM +40% HEAL, and GATED labels explain why. Move together and use F/K to compare hit flash/shake and flinch. Release overrides to resume A's selected source. Formula sliders apply immediately; values reset on reload.

## Verification

Run: node tools/test-mechanics.mjs

Covers ten-second engine simulation, applied event totals, real hit/flinch events, HP/meter caps, duplicate sample smoothing, HR spikes, gate hysteresis, invalid/stale samples, and same-tick post-hit regen suppression.

Browser visual verification and a two-person feel/balance playtest remain pending: the development environment exposed no connected browser. The deterministic simulation is not a substitute for a human match.

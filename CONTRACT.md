# Composure — shared contract (v1)

Everything below is stable API. If you need a change, shout in the group chat before
editing this file — B, C, D all build against these shapes.

## 1. Biometric sample

Emitted on the event bus as `biometric_sample`, and also readable synchronously via
`getBiometrics(player)`.

```js
{
  player: 1 | 2,
  t: 1699999999999,      // Date.now()
  hr: 78,                // beats per minute, roughly 50-180
  breath: 14,            // breaths per minute, roughly 8-30
  stress: 0.32,          // normalized 0..1, smoothed
  calm: 0.68,            // normalized 0..1, smoothed (not strictly 1-stress, can diverge)
  source: 'mock' | 'presage'
}
```

Mock generator updates this ~10x/sec. Ranges/noise are tuned to look plausible, not
medically accurate. Hotkeys force states for demoing (see below).

## 2. Event bus

Global singleton: `import { bus } from './src/eventBus.js'`. Standard `on(type, fn)` /
`off(type, fn)` / `emit(type, payload)`.

Events:

| type | payload |
|---|---|
| `hit` | `{ attacker, defender, damage, kind, t }` — kind: `'light' | 'special'` |
| `flinch` | `{ player, magnitude, t }` — magnitude 0..1, how hard to sell it |
| `heal_tick` | `{ player, amount, t }` — amount already applied to HP |
| `meter_gain` | `{ player, amount, t }` |
| `meter_full` | `{ player, t }` |
| `special` | `{ player, t }` — special move fired |
| `ko` | `{ winner, loser, t }` |
| `round_start` | `{ round, t }` |
| `round_end` | `{ round, winner, t }` |
| `biometric_sample` | see above |
| `state_snapshot` | see below, fired every 250ms |

## 3. State snapshot (every 250ms)

```js
{
  t: 1699999999999,
  round: 1,
  timeRemaining: 74.3,       // seconds
  players: [
    {
      id: 1,
      hp: 82, maxHp: 100,
      meter: 40, maxMeter: 100,
      x: 220, y: 0, facing: 1,        // facing: 1 right, -1 left
      state: 'idle',                  // idle|walk|jump|attack|block|flinch|ko
      biometrics: { hr, breath, stress, calm, source }
    },
    { id: 2, ... }
  ]
}
```

## 4. Overridable mechanics hooks — `src/mechanics.js`

B owns the bodies of these. A calls them at the right moments and never hardcodes the
formulas. Default implementations are deliberately boring/neutral so the engine works
standalone before B plugs in.

```js
Mechanics.calcDamage(baseDamage, attacker, defender) -> number
Mechanics.calcFlinchMultiplier(defender) -> number       // scales hitstun duration
Mechanics.healTick(player, dtSeconds) -> hpDelta         // called every physics tick
Mechanics.meterGain(player, eventType, baseAmount) -> number
Mechanics.meterGateOpen(player) -> boolean               // can meter charge at all right now
```

`player` passed to these hooks is the live player state object from the engine
(has `.hp`, `.meter`, `.biometrics`, etc). Mutate biometrics-derived UI state on it if you
want, don't mutate hp/meter directly — return deltas, engine applies them.

## 5. Biometrics source switch

`src/biometrics.js` exports `getBiometrics(player)` — this is what everyone should call,
never reach into mock/presage modules directly. Switching source (mock vs presage) is a
runtime toggle (`window.__setBiometricsSource('presage')`), transparent to callers.

## 6. Controls

P1: `A/D` move, `W` jump, `S` block (hold), `F` light attack, `G` special (needs full meter)
P2: `←/→` move, `↑` jump, `↓` block (hold), `K` light attack, `L` special (needs full meter)

Debug hotkeys (mock biometrics): `1`/`2` force P1/P2 "stressed", `Q`/`P` force P1/P2 "calm",
`0` release forced state back to sine+noise.

## 7. Presage status

No browser SDK exists — platforms are iOS/Android/C++/Node.js/Electron only. The REST API
is upload-and-poll (not live), and breathing confidence needs a 30s window, HRV needs 60s.
Treat real biometrics as a slow "vibe" signal (heal rate, meter gating band), not a per-hit
reactive one — mock data stays the primary driver of the demo even after Presage is wired up.

**The bridge is built** — see `bridge/` (Node service running `@smartspectra/node-sdk`,
WebSocket in: raw webcam frames, WebSocket out: `{player, hr, breath, stress, calm, source}`
matching the biometric-sample shape in #1) and `src/presage-capture.js` (browser webcam →
bridge). Setup and usage: `bridge/README.md`. Not yet tested against a real API key/camera —
budget time before the demo to verify the full pipeline, not just that it compiles.

`src/biometrics.js` smooths whatever arrives (mock or Presage) into a continuous per-tick
value via `advanceBiometricsSmoothing()`, so `getBiometrics()` always updates every physics
frame regardless of how often the real sensor actually reports.

## 8. Two-laptop play

See `netplay/README.md` for setup. Short version: one laptop is the authoritative "host"
(the only place `stepMatch()` ever runs), the other is a "guest" that only sends its local
player's input and renders whatever state the host broadcasts. Deliberately not
peer-to-peer/lockstep — two independent simulations would silently diverge, since
`Mechanics` hooks read live biometric values that aren't identical across two machines
(different local RNG for mock, different local clocks for the smoothing lerp). Host-only
simulation means there's nothing to desync.

`src/net.js` owns the WebSocket connection and role state; `netplay/server.js` is a dumb
message relay (pairs one host + one guest, forwards raw frames, never parses payloads).
Not part of the 250ms `state_snapshot` contract above — netplay uses its own
higher-frequency `buildNetState()`/`matchFromNetState()` pair in `src/game.js` so C/D's
contract usage is unaffected.

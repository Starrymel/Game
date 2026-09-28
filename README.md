# Headiator

A two-player fighting game controlled by your face — and healed by your real heartbeat.

**Play it: [headiator.club](https://headiator.club)**

No controller, no mouse. You smile and raise your eyebrows to pick your fighter and move
through menus, punch and fire lasers with your face (or the keyboard), and your actual
heart rate and breathing (read live from your webcam, no wearable) change how fast you
heal and how hard hits land. An AI announcer calls the fight live, and after every round
Gemini looks at what actually happened — punches landed, lasers dodged, swords survived,
prizes caught — and writes a short recap about it.

## Features

- **Face-gesture control** — MediaPipe face tracking, entirely in the browser. Smile to
  claim Player 1 / confirm "play again"; raise your eyebrows for Player 2 / "exit." No
  clicking required to get into a match or leave one, and your face throws real attacks too.
- **Real biofeedback, not a gimmick stat** — your heart rate and breathing (via Presage/
  SmartSpectra, from your webcam) feed a "composed" state that changes your heal rate and
  how much damage/flinch you take. Calmer play heals faster and hits land softer.
- **Live AI announcer** — ElevenLabs voice reacts to hits, specials, and round outcomes as
  they happen.
- **AI-written match recap** — every punch, laser, sword dodge, block, and prize catch is
  logged during the match (`server/lib/matchStats.js`); Gemini picks the single most
  striking story from that real data and writes it up, rather than reading off a stat
  sheet. Shown as a drawn-card recap (no charts) that opens automatically after each round.
- **Two-laptop online play** — one laptop hosts the authoritative simulation, the other
  connects as a guest over a WebSocket relay; each player's camera drives their own vitals.
- **One-service deploy** — the whole thing (game, dashboard, API, WebSocket relay, and the
  Presage vitals pipeline) runs as a single Render web service. No separate backend to spin
  up for a hosted match — a local helper (`bridge/`) exists only for offline development.

## Tech stack

| Layer | Tech |
|---|---|
| Game client | Vanilla JS (ES modules), Canvas 2D, MediaPipe Face Landmarker |
| Realtime / netplay | WebSocket (`ws`), host-authoritative simulation |
| Vitals | SmartSpectra / Presage Node SDK, run server-side (deployed) or via a local bridge (dev) |
| Backend | Node.js, Express |
| Database | PostgreSQL / TimescaleDB (Tiger Data) — match & event logging, with a disk-spool fallback if the DB is unreachable |
| AI commentary & recap | Google Gemini |
| Voice | ElevenLabs |
| Hosting | Render (single web service), custom domain via Porkbun DNS |

## Controls

| | Player 1 | Player 2 |
|---|---|---|
| Move | `A` / `D` | `←` / `→` |
| Jump | `W` | `↑` |
| Block (hold) | `S` | `↓` |
| Punch | `F` | `K` |
| Laser (ranged) | `H` | `J` |
| Special (needs full meter) | `G` | `L` |

### Face / head gesture controls

Face controls run automatically alongside the keyboard — no setup needed to play. By
default:

| Gesture | Does |
|---|---|
| Smile | Punch (only lands when the opponent is close) |
| Raise both eyebrows | Laser shot (ranged attack) |

Outside of combat, the same two gestures drive every menu: **smile** claims Player 1 in
the lobby and confirms "play again" at round end; **raise your eyebrows** claims Player 2
and picks "exit." The start screen has a third gesture just for itself: **open your
mouth** picks "Play solo," a one-laptop match against a bot-controlled Player 2 (it
moves, attacks, and blocks -- see `src/bot.js` to tune it). Buttons are always shown too,
for whenever a camera isn't available.

Other expressions — a wink, a single raised eyebrow, a smirk, a long blink, opening your
mouth — can each be remapped to punch / laser / special / block / jump instead, from the
in-game face-tuning panel (`?facelab=1`). Not required to play; useful for accessibility
or personal preference.

## Points, health & meter — what the numbers mean

There's no separate point score — a round is won by KO, or by whoever has more HP left
when time runs out. What you see on screen:

- **HP (0–100)** — standard health bar per player. Hit 0 and you're KO'd.
- **Meter** — builds toward your Special attack, which needs a full bar to fire (and
  empties it when it does). It only charges while your heart rate sits in a "working"
  zone (about 60–110 BPM by default); landing hits, taking hits, and time passing all add
  to it, and steadier breathing charges it faster.
- **"CALM +X% HEAL / Y HP/s"** — your calmness controls regen. Below a calm threshold you
  don't heal at all; above it, the calmer and more steadily you're breathing, the faster
  you heal, up to a +40% bonus over the base rate. Healing also pauses for about 1.4
  seconds after you take a hit.
- **"COMPOSED / STRESS / HR SPIKE" + "FLINCH \_\_x / DMG \_\_x"** — how long you're
  stunned when hit (flinch) and how much damage you take both scale with how stressed you
  are, or with a sudden heart-rate spike against your recent average. Staying composed
  multiplies both down (as low as 0.8x flinch, 0.92x damage); stress multiplies them up
  (as high as 1.2x flinch, 1.08x damage).

In short: staying calm and breathing steadily makes you heal faster, charge your special
sooner, and take/sell hits better — panicking does the opposite.

## Running locally

```bash
npm install
cp .env.example .env    # fill in the keys below
npm test                # optional: run the test suite
npm start               # serves the game + API + relay on http://localhost:3000
```

Open `http://localhost:3000` for the classic single-laptop, one-keyboard, two-player mode.
For two-laptop play, see `netplay/README.md`. For local Presage vitals without deploying,
see `bridge/README.md` (not needed on the deployed site — Presage runs inside the main
server there).

### Environment variables (`.env`)

| Variable | Purpose |
|---|---|
| `PORT` | Local server port (default 3000) |
| `DATABASE_URL` | Postgres/TimescaleDB connection string (Tiger Data) |
| `GEMINI_API_KEY` | Live commentary + post-match recap summaries |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` | Announcer voice |
| `PRESAGE_API_KEY` | Real heart-rate/breathing readings (get one at physiology.presagetech.com) |

Everything is optional in the sense that the game runs with mock biometrics and template
text if a key is missing — nothing crashes without an API key, it just falls back.

## Project structure

| Area | Owns |
|---|---|
| `src/` engine, biometrics, `CONTRACT.md` | A |
| `src/mechanics*.js`, `src/ui/` | B |
| `src/commentary/`, `server/ai/`, `server/routes/ai.js`, `tools/`, `fixtures/`, `assets/` | C |
| `src/logging/`, `server/index.js`, `server/lib/`, `server/routes/log.js` + `matches.js`, `dashboard/`, `db/`, `deploy/`, `scripts/` | D |

`CONTRACT.md` is the shared API between these areas (event bus shape, biometric sample
format, mechanics hooks) — read it before changing a shape another area depends on.

Built at a hackathon by Mary Araujo, Daphne Lin, Melissa Liu, and Ahansal Niamatollah.

## Known limitations

- Presage's real API is upload-and-poll, not truly live, so biometrics are treated as a
  slow "vibe" signal (heal rate, damage multiplier) rather than a per-hit reactive one —
  see `CONTRACT.md` §7.
- The in-server Presage path (used on the deployed site) is unit-tested but should be
  verified against two real laptops/cameras before relying on it live.
- AI recap summaries fall back to a template if the Gemini API key is rate-limited or
  missing — the game stays fully playable either way.

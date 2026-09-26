// Presage bridge: browser sends webcam frames over WebSocket (binary, see
// HEADER_BYTES framing below), this process runs those frames through the
// SmartSpectra Node SDK (real vitals extraction happens here, on-device),
// and broadcasts decoded {player, hr, breath, stress, calm} back over the
// same WebSocket. src/biometrics-presage.js on the browser side already
// expects exactly this JSON shape at ws://localhost:8787/biometrics.
//
// Setup: cd bridge && npm install && npm start. PRESAGE_API_KEY is read from
// bridge/.env, or else from the project's main .env (one file for the whole team).
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  SmartSpectraSDK, decodeMetrics, breathingMetrics, cardioMetrics,
  FrameTransform, PixelFormat,
} from '@smartspectra/node-sdk';

// Env: real environment first, then bridge/.env, then the repo's main .env. dotenv
// never overrides a value that's already set, so earlier sources win.
const BRIDGE_DIR = path.dirname(fileURLToPath(import.meta.url));
const keyFromEnv = !!process.env.PRESAGE_API_KEY;
const envFiles = [path.join(BRIDGE_DIR, '.env'), path.join(BRIDGE_DIR, '..', '.env')];
let keySource = keyFromEnv ? 'environment' : null;
for (const file of envFiles) {
  if (!fs.existsSync(file)) continue;
  dotenv.config({ path: file, quiet: true });
  if (!keySource && process.env.PRESAGE_API_KEY) keySource = path.relative(process.cwd(), file) || file;
}

const PORT = Number(process.env.PRESAGE_BRIDGE_PORT) || 8787;
// Every modern browser blocks a plain ws:// connection from an https:// page
// as mixed content -- even to localhost (confirmed: open Chromium issue
// #40386732, Firefox bug 1376309, reproduces in Safari too). A deployed
// HTTPS game page (e.g. on Render) needs the local bridge to speak wss://
// instead, on a separate port so the plain ws:// path (same-Wifi play from
// an http:// page, unaffected by this) keeps working unchanged.
const WSS_PORT = Number(process.env.PRESAGE_BRIDGE_WSS_PORT) || 8790;
const API_KEY = process.env.PRESAGE_API_KEY;

if (!API_KEY) {
  console.warn(
    '[presage-bridge] PRESAGE_API_KEY not set — SDK sessions will fail auth. '
    + 'Get one at https://physiology.presagetech.com/auth/login and put it in the main .env (or bridge/.env)',
  );
} else {
  console.log(`[presage-bridge] PRESAGE_API_KEY loaded from ${keySource} (${API_KEY.slice(0, 4)}…)`);
}

// Binary frame layout sent by src/presage-capture.js, all little-endian:
//   uint32 player | uint32 width | uint32 height | float64 timestampUs | RGBA pixel bytes
const HEADER_BYTES = 20;

// Self-signed cert for the wss:// listener, generated once per machine and
// cached on disk (gitignored -- see bridge/.gitignore). The browser will
// show a certificate warning the first time; that's expected for any local
// HTTPS dev server. Visit https://localhost:<WSS_PORT> directly once and
// accept it (Safari: "visit this website"; Chrome: Advanced -> Proceed),
// then the game page's wss:// connection to the same origin will work.
const CERT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'certs');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');

function ensureSelfSignedCert() {
  if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) return;
  fs.mkdirSync(CERT_DIR, { recursive: true });
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825',
      '-keyout', KEY_PATH, '-out', CERT_PATH, '-subj', '/CN=localhost',
    ], { stdio: 'pipe' });
    console.log(`[presage-bridge] generated a self-signed cert at ${CERT_DIR}`);
  } catch (err) {
    console.warn(
      '[presage-bridge] could not generate a self-signed cert (is openssl installed?) '
      + '-- the wss:// listener for hosted-HTTPS play will not start:', err.message,
    );
  }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Baevsky Stress Index has no official 0..1 scale; ~50-150 is a typical
// resting range and it climbs steeply under load. This is a rough,
// demo-tunable normalization — retune against real readings before the demo.
function baevskyToStress(baevsky) {
  return clamp(Math.log10(Math.max(baevsky, 1) / 100) / 1.5 + 0.3, 0, 1);
}

const sessions = new Map(); // player -> { sdk, restingHr, frameCount }

function destroySession(player) {
  const session = sessions.get(player);
  if (!session) return;
  try {
    session.sdk?.destroy();
  } catch (_) { /* already gone, nothing to clean up */ }
  sessions.delete(player);
  console.log(`[presage-bridge] player ${player}: session destroyed`);
}

function getOrCreateSession(player, broadcast) {
  let session = sessions.get(player);
  if (session) return session;

  // Cache the session object before any SDK call so a failed start() below
  // doesn't retry (and re-throw) on every subsequent frame for this player.
  session = { sdk: null, restingHr: null, failed: false, frameCount: 0 };
  sessions.set(player, session);

  try {
    const sdk = new SmartSpectraSDK({
      apiKey: API_KEY,
      requestedMetrics: [...breathingMetrics, ...cardioMetrics],
    });
    sdk.useCustomInput(FrameTransform.kNone);
    sdk.start(); // throws synchronously on auth/setup failure, not just an 'error' event

    sdk.on('metrics', (buf) => {
      const metrics = decodeMetrics(buf);
      if (Buffer.isBuffer(metrics)) return; // undecoded buffer, nothing usable yet

      const hr = metrics.cardio?.pulseRate?.at(-1)?.value;
      const breath = metrics.breathing?.rate?.at(-1)?.value;
      const baevsky = metrics.cardio?.hrv?.at(-1)?.baevsky;
      if (hr != null && !session.gotFirstHr) {
        session.gotFirstHr = true;
        console.log(`[presage-bridge] player ${player}: first real HR reading (${hr.toFixed(1)} bpm)`);
      }
      if (breath != null && !session.gotFirstBreath) {
        session.gotFirstBreath = true;
        console.log(`[presage-bridge] player ${player}: first real breathing reading (${breath.toFixed(1)}/min)`);
      }
      if (hr == null && breath == null) return;

      const now = Date.now();
      if (now - (session.lastLoggedAt || 0) >= 2000) {
        session.lastLoggedAt = now;
        console.log(`[presage-bridge] player ${player}: hr=${hr?.toFixed(1)} breath=${breath?.toFixed(1)}`);
      }

      if (hr != null) {
        session.restingHr = session.restingHr == null ? hr : session.restingHr * 0.98 + hr * 0.02;
      }

      const stress = baevsky != null
        ? baevskyToStress(baevsky)
        : (hr != null && session.restingHr ? clamp((hr - session.restingHr) / 40, 0, 1) : 0.3);

      broadcast({
        player,
        t: Date.now(),
        hr: hr ?? 75,
        breath: breath ?? 14,
        stress,
        calm: clamp(1 - stress, 0, 1),
        source: 'presage',
      });
    });

    sdk.on('validationStatus', (code, ts, hint) => {
      if (code !== session.lastValidationCode) {
        session.lastValidationCode = code;
        console.log(`[presage-bridge] player ${player}: validation changed -> code=${code} hint=${hint}`);
        // Tell the game too, so its camera panel can show "No face found" etc.
        broadcast({ type: 'status', player, code, hint });
      }
    });

    sdk.on('error', (code, message, retryable) => {
      console.error(`[presage-bridge] player ${player} SDK error:`, code, message, 'retryable=', retryable);
      if (retryable) {
        // reset() is the SDK's documented way to rebuild the pipeline after
        // a recoverable error -- if even that throws, fall through and
        // destroy the session below rather than leave it half-broken.
        try {
          sdk.reset();
          return;
        } catch (resetErr) {
          console.error(`[presage-bridge] player ${player} reset() also failed:`, resetErr.message);
        }
      }
      // Non-retryable (e.g. kTimestampGap after any real-world pause --
      // reload, or us restarting things between tests) or reset failed:
      // the SDK is telling us this session is unsalvageable. Destroy it so
      // the next frame starts a completely fresh session instead of feeding
      // more frames into a session that will just keep erroring.
      destroySession(player);
    });

    session.sdk = sdk;
  } catch (err) {
    session.failed = true;
    console.error(`[presage-bridge] player ${player} failed to start SmartSpectra session (check PRESAGE_API_KEY):`, err.message);
    broadcast({ type: 'status', player, error: `SmartSpectra session failed: ${err.message}` });
  }

  return session;
}

// Both listeners share the same sessions/broadcast -- a player's frames
// might come in over either one depending on which page loaded the panel.
const allServers = []; // WebSocketServer instances currently broadcasting

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const server of allServers) {
    server.clients.forEach((client) => {
      if (client.readyState === client.OPEN) client.send(msg);
    });
  }
}

function handleConnection(ws) {
  console.log('[presage-bridge] browser connected');
  const seenPlayers = new Set(); // which players this specific connection has sent frames for

  ws.on('message', (data, isBinary) => {
    if (!isBinary || data.length <= HEADER_BYTES) return;

    const player = data.readUInt32LE(0);
    const width = data.readUInt32LE(4);
    const height = data.readUInt32LE(8);
    const timestampUs = data.readDoubleLE(12);
    const pixels = data.subarray(HEADER_BYTES);

    seenPlayers.add(player);
    const session = getOrCreateSession(player, broadcast);
    if (session.failed || !session.sdk) return; // session unusable, drop the frame

    const n = ++session.frameCount;
    let accepted = false;
    try {
      accepted = session.sdk.sendFrame(pixels, width, height, width * 4, PixelFormat.kRGBA, timestampUs);
    } catch (err) {
      // sendFrame() can throw synchronously (e.g. "not in a valid state"
      // after an internal error) instead of just emitting 'error' -- without
      // this catch, one bad frame kills the whole bridge process.
      session.failed = true;
      console.error(`[presage-bridge] player ${player} sendFrame() threw, dropping this session:`, err.message);
      return;
    }
    if (n === 1) {
      console.log(`[presage-bridge] player ${player}: first frame received (${width}x${height}), sendFrame accepted=${accepted}`);
    } else if (n % 40 === 0) {
      console.log(`[presage-bridge] player ${player}: ${n} frames received so far, sendFrame accepted=${accepted}`);
    }
  });

  ws.on('close', () => {
    console.log('[presage-bridge] browser disconnected');
    // A reload/close means "start fresh" for whatever players this
    // connection was streaming -- a stale session fed frames after a
    // real-world gap is exactly what triggers kTimestampGap.
    for (const player of seenPlayers) destroySession(player);
  });
}

const wss = new WebSocketServer({ port: PORT, path: '/biometrics' });
wss.on('connection', handleConnection);
allServers.push(wss);
console.log(`[presage-bridge] listening on ws://localhost:${PORT}/biometrics`);

ensureSelfSignedCert();
if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
  const httpsServer = https.createServer({ key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) });
  const wssSecure = new WebSocketServer({ server: httpsServer, path: '/biometrics' });
  wssSecure.on('connection', handleConnection);
  allServers.push(wssSecure);
  httpsServer.listen(WSS_PORT, () => {
    console.log(`[presage-bridge] listening on wss://localhost:${WSS_PORT}/biometrics (self-signed -- `
      + `visit https://localhost:${WSS_PORT} once and accept the certificate warning before using it from the game)`);
  });
}

process.on('SIGINT', () => {
  for (const { sdk } of sessions.values()) sdk.destroy();
  process.exit(0);
});

// Defense in depth: we've now hit two different native SDK call sites
// (start(), sendFrame()) that throw synchronously instead of emitting a
// recoverable event, despite the docs implying the latter. Both are wrapped
// above, but if a future native call throws somewhere we haven't guarded,
// keep the whole bridge alive (log and continue) rather than let one bad
// frame from one player kill biometrics for both mid-demo.
process.on('uncaughtException', (err) => {
  console.error('[presage-bridge] uncaught exception, bridge staying alive:', err.message);
});

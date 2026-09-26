// Presage bridge: browser sends webcam frames over WebSocket (binary, see
// HEADER_BYTES framing below), this process runs those frames through the
// SmartSpectra Node SDK (real vitals extraction happens here, on-device),
// and broadcasts decoded {player, hr, breath, stress, calm} back over the
// same WebSocket. src/biometrics-presage.js on the browser side already
// expects exactly this JSON shape at ws://localhost:8787/biometrics.
//
// Setup: cd bridge && npm install && cp .env.example .env (fill in
// PRESAGE_API_KEY) && npm start
import 'dotenv/config';
import { WebSocketServer } from 'ws';
import {
  SmartSpectraSDK, decodeMetrics, breathingMetrics, cardioMetrics,
  FrameTransform, PixelFormat,
} from '@smartspectra/node-sdk';

const PORT = Number(process.env.PRESAGE_BRIDGE_PORT) || 8787;
const API_KEY = process.env.PRESAGE_API_KEY;

if (!API_KEY) {
  console.warn(
    '[presage-bridge] PRESAGE_API_KEY not set — SDK sessions will fail auth. '
    + 'Get one at https://physiology.presagetech.com/auth/login and put it in bridge/.env',
  );
}

// Binary frame layout sent by src/presage-capture.js, all little-endian:
//   uint32 player | uint32 width | uint32 height | float64 timestampUs | RGBA pixel bytes
const HEADER_BYTES = 20;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Baevsky Stress Index has no official 0..1 scale; ~50-150 is a typical
// resting range and it climbs steeply under load. This is a rough,
// demo-tunable normalization — retune against real readings before the demo.
function baevskyToStress(baevsky) {
  return clamp(Math.log10(Math.max(baevsky, 1) / 100) / 1.5 + 0.3, 0, 1);
}

const sessions = new Map(); // player -> { sdk, restingHr }

function getOrCreateSession(player, broadcast) {
  let session = sessions.get(player);
  if (session) return session;

  // Cache the session object before any SDK call so a failed start() below
  // doesn't retry (and re-throw) on every subsequent frame for this player.
  session = { sdk: null, restingHr: null, failed: false };
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
      if (hr == null && breath == null) return;

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

    sdk.on('error', (code, message, retryable) => {
      console.error(`[presage-bridge] player ${player} SDK error:`, code, message, 'retryable=', retryable);
    });

    session.sdk = sdk;
  } catch (err) {
    session.failed = true;
    console.error(`[presage-bridge] player ${player} failed to start SmartSpectra session (check PRESAGE_API_KEY):`, err.message);
  }

  return session;
}

const wss = new WebSocketServer({ port: PORT, path: '/biometrics' });
console.log(`[presage-bridge] listening on ws://localhost:${PORT}/biometrics`);

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) client.send(msg);
  });
}

wss.on('connection', (ws) => {
  ws.on('message', (data, isBinary) => {
    if (!isBinary || data.length <= HEADER_BYTES) return;

    const player = data.readUInt32LE(0);
    const width = data.readUInt32LE(4);
    const height = data.readUInt32LE(8);
    const timestampUs = data.readDoubleLE(12);
    const pixels = data.subarray(HEADER_BYTES);

    const session = getOrCreateSession(player, broadcast);
    if (session.failed || !session.sdk) return; // session unusable, drop the frame
    session.sdk.sendFrame(pixels, width, height, width * 4, PixelFormat.kRGBA, timestampUs);
  });
});

process.on('SIGINT', () => {
  for (const { sdk } of sessions.values()) sdk.destroy();
  process.exit(0);
});

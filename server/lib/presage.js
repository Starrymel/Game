// Owner: A/D. Presage vitals, running inside the main server so a deployed site (Render) needs
// no per-player local bridge process (bridge/ still exists, untouched, for local dev/testing).
//
// One independent SmartSpectra SDK session per WebSocket connection that actually sends camera
// frames -- never shared, never global -- so two players' frames/vitals can never cross. A given
// browser page opens TWO connections per player though (see src/presage-capture.js, which only
// sends frames and never reads responses, and src/biometrics-presage.js, which only listens for
// vitals and never sends frames), and vitals must reach the listening one. To do that without ever
// broadcasting one player's heart rate to unrelated strangers elsewhere on a shared public server,
// connections carry a `?session=<id>` query param (a random id generated once per page load) and
// vitals are only ever relayed to OTHER sockets sharing that exact same session id.
const { WebSocketServer } = require('ws');
const { routeUpgrades } = require('./wsRouter');

const HEADER_BYTES = 20; // uint32 player | uint32 width | uint32 height | float64 timestampUs (all little-endian)
const MAX_WIDTH = 640, MAX_HEIGHT = 480; // generous upper bound; the browser normally sends 320x240
const MAX_FRAME_BYTES = MAX_WIDTH * MAX_HEIGHT * 4 + HEADER_BYTES;
const MIN_FRAME_INTERVAL_MS = 1000 / 31; // free-plan frame-rate cap: a little above the SDK's 30fps target
const HEARTBEAT_MS = 20000;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Baevsky Stress Index has no official 0..1 scale; ~50-150 is a typical resting range and it climbs
// steeply under load. Rough, demo-tunable normalization (ported as-is from bridge/server.js).
function baevskyToStress(baevsky) {
  return clamp(Math.log10(Math.max(baevsky, 1) / 100) / 1.5 + 0.3, 0, 1);
}

// Pure: given one metrics reading and the running resting-HR average, derive stress/calm and the
// updated resting HR. No SDK/IO involved, so this is directly unit-testable.
function deriveVitals({ hr, breath, baevsky, restingHr }) {
  const nextRestingHr = hr != null ? (restingHr == null ? hr : restingHr * 0.98 + hr * 0.02) : restingHr;
  const stress = baevsky != null
    ? baevskyToStress(baevsky)
    : (hr != null && nextRestingHr ? clamp((hr - nextRestingHr) / 40, 0, 1) : 0.3);
  return { stress, calm: clamp(1 - stress, 0, 1), restingHr: nextRestingHr };
}

// Parses+validates the binary frame header (must match src/presage-capture.js's layout exactly).
// Returns null for anything malformed or outside sane bounds, so a bad/oversized frame is just
// dropped rather than fed to the SDK or allowed to crash the server.
function parseFrame(data) {
  if (!Buffer.isBuffer(data) || data.length <= HEADER_BYTES) return null;
  const player = data.readUInt32LE(0);
  const width = data.readUInt32LE(4);
  const height = data.readUInt32LE(8);
  const timestampUs = data.readDoubleLE(12);
  if (player !== 1 && player !== 2) return null;
  if (!(width > 0) || !(height > 0) || width > MAX_WIDTH || height > MAX_HEIGHT) return null;
  const pixels = data.subarray(HEADER_BYTES);
  if (pixels.length !== width * height * 4) return null;
  return { player, width, height, timestampUs, pixels };
}

// Required lazily (not at module load) so this file -- and everything that only needs the pure
// helpers above -- can be imported and unit-tested with a fake sdkFactory/metricsModule, without
// ever touching the real native SDK or making a real network call.
function realMetricsModule() {
  return require('@smartspectra/node-sdk');
}

function defaultSdkFactory({ apiKey, requestedMetrics }) {
  const { SmartSpectraSDK, FrameTransform } = realMetricsModule();
  const sdk = new SmartSpectraSDK({ apiKey, requestedMetrics });
  sdk.useCustomInput(FrameTransform.kNone);
  return sdk;
}

function randomId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function attachPresage(server, {
  path = '/presage',
  apiKey = process.env.PRESAGE_API_KEY,
  log = () => {},
  heartbeatMs = HEARTBEAT_MS,
  minFrameIntervalMs = MIN_FRAME_INTERVAL_MS,
  sdkFactory = defaultSdkFactory,
  metricsModule = null, // test-only override; falls back to the real SDK module when null
} = {}) {
  const metrics = () => metricsModule || realMetricsModule();

  if (!apiKey) log('[presage] PRESAGE_API_KEY not set -- sessions will report a status error and the game falls back to mock vitals');
  else log(`[presage] PRESAGE_API_KEY loaded (${apiKey.slice(0, 4)}...)`);

  // noServer: true + a shared dispatcher (see wsRouter.js) -- ws's own `{ server, path }` convenience
  // mode does not coexist safely with a second such instance on the same server (e.g. relay.js's).
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  routeUpgrades(server).set(path, wss);
  const sessionGroups = new Map(); // session id -> Set<ws> (every connection sharing one page load)

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://placeholder');
    const sid = url.searchParams.get('session') || randomId(); // no session param: isolated, never grouped with anyone
    let group = sessionGroups.get(sid);
    if (!group) { group = new Set(); sessionGroups.set(sid, group); }
    group.add(ws);

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    let sdk = null, failed = false, restingHr = null, lastFrameAt = 0, lastValidationCode = null, player = null;

    const sendToGroup = (obj) => {
      const msg = JSON.stringify(obj);
      for (const client of group) if (client.readyState === client.OPEN) client.send(msg);
    };

    function destroySession() {
      if (sdk) { try { sdk.destroy(); } catch (_) { /* already gone */ } }
      sdk = null;
    }

    function ensureSdk() {
      if (sdk || failed) return sdk;
      if (!apiKey) {
        failed = true;
        sendToGroup({ type: 'status', player, error: 'Presage is not configured on this server (no API key)' });
        return null;
      }
      const { breathingMetrics, cardioMetrics } = metrics();
      try {
        sdk = sdkFactory({ apiKey, requestedMetrics: [...breathingMetrics, ...cardioMetrics] });
        sdk.start(); // throws synchronously on auth/setup failure, not just an 'error' event
      } catch (err) {
        failed = true; sdk = null;
        log(`[presage] player ${player}: session failed to start: ${err.message}`);
        sendToGroup({ type: 'status', player, error: `SmartSpectra session failed: ${err.message}` });
        return null;
      }
      sdk.on('metrics', (buf) => {
        const decoded = metrics().decodeMetrics(buf);
        if (Buffer.isBuffer(decoded)) return; // undecoded buffer, nothing usable yet
        const hr = decoded.cardio?.pulseRate?.at(-1)?.value;
        const breath = decoded.breathing?.rate?.at(-1)?.value;
        const baevsky = decoded.cardio?.hrv?.at(-1)?.baevsky;
        if (hr == null && breath == null) return;
        const derived = deriveVitals({ hr, breath, baevsky, restingHr });
        restingHr = derived.restingHr;
        sendToGroup({
          player, t: Date.now(), hr: hr ?? 75, breath: breath ?? 14,
          stress: derived.stress, calm: derived.calm, source: 'presage',
        });
      });
      sdk.on('validationStatus', (code, ts, hint) => {
        if (code === lastValidationCode) return;
        lastValidationCode = code;
        sendToGroup({ type: 'status', player, code, hint });
      });
      sdk.on('error', (code, message, retryable) => {
        log(`[presage] player ${player}: SDK error ${code} ${message} retryable=${retryable}`);
        if (retryable) {
          try { sdk.reset(); return; } catch (resetErr) { log(`[presage] player ${player}: reset() also failed: ${resetErr.message}`); }
        }
        destroySession(); failed = false; // the next frame starts a completely fresh session
      });
      return sdk;
    }

    ws.on('message', (data, isBinary) => {
      if (!isBinary) return; // control/subscribe messages aren't part of this protocol; ignore anything else
      const now = Date.now();
      if (now - lastFrameAt < minFrameIntervalMs) return; // free-plan frame-rate cap: drop, never queue
      const frame = parseFrame(data);
      if (!frame) return; // malformed or oversized: dropped, not an error
      lastFrameAt = now;
      player = frame.player;
      const s = ensureSdk();
      if (!s) return;
      try {
        const { PixelFormat } = metrics();
        s.sendFrame(frame.pixels, frame.width, frame.height, frame.width * 4, PixelFormat.kRGBA, frame.timestampUs);
      } catch (err) {
        // sendFrame() can throw synchronously instead of just emitting a recoverable 'error' event.
        log(`[presage] player ${player}: sendFrame() threw, dropping this session: ${err.message}`);
        destroySession(); failed = true;
      }
    });

    function cleanup() {
      destroySession();
      group.delete(ws);
      if (group.size === 0) sessionGroups.delete(sid);
    }
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });

  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch (_) { /* closing */ }
    }
  }, heartbeatMs);
  beat.unref?.();
  wss.on('close', () => clearInterval(beat));

  return { wss, sessionGroups };
}

module.exports = { attachPresage, baevskyToStress, deriveVitals, parseFrame, HEADER_BYTES, MAX_WIDTH, MAX_HEIGHT };

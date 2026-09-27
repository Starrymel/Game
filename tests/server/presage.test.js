// Owner: A/D. Presage running inside the main server: session isolation, frame/size limits,
// and graceful failure -- all tested against a fake SDK, never the real network/native module.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const WebSocket = require('ws');
const { attachPresage, baevskyToStress, deriveVitals, parseFrame, HEADER_BYTES } = require('../../server/lib/presage');

// A fake SmartSpectra session: no native module, no network. Tests grab the returned instance
// to fire 'metrics'/'validationStatus'/'error' events and to assert on start/sendFrame/destroy calls.
class FakeSdk extends EventEmitter {
  constructor({ startThrows, sendFrameThrows } = {}) {
    super();
    this.startThrows = startThrows || null;
    this.sendFrameThrows = sendFrameThrows || null;
    this.startCalls = 0; this.sendFrameCalls = 0; this.destroyCalls = 0; this.resetCalls = 0;
  }
  start() { this.startCalls++; if (this.startThrows) throw this.startThrows; }
  sendFrame() { this.sendFrameCalls++; if (this.sendFrameThrows) throw this.sendFrameThrows; }
  destroy() { this.destroyCalls++; }
  reset() { this.resetCalls++; }
}

const fakeMetricsModule = {
  breathingMetrics: ['breathing'], cardioMetrics: ['cardio'],
  PixelFormat: { kRGBA: 'RGBA' },
  decodeMetrics: (x) => x, // tests pass already-"decoded" objects straight through
};

function makeFrame({ player = 1, width = 4, height = 4, timestampUs = 1000, fill = 200 } = {}) {
  const pixels = Buffer.alloc(width * height * 4, fill);
  const buf = Buffer.alloc(HEADER_BYTES + pixels.length);
  buf.writeUInt32LE(player, 0);
  buf.writeUInt32LE(width, 4);
  buf.writeUInt32LE(height, 8);
  buf.writeDoubleLE(timestampUs, 12);
  pixels.copy(buf, HEADER_BYTES);
  return buf;
}

async function start({ apiKey = 'test-key', sdks = [], ...opts } = {}) {
  const server = http.createServer();
  const made = [];
  const sdkFactory = () => { const s = new FakeSdk(sdks[made.length] || {}); made.push(s); return s; };
  const presage = attachPresage(server, { apiKey, sdkFactory, metricsModule: fakeMetricsModule, heartbeatMs: 60000, ...opts });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const open = (query = '') => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/presage${query ? `?${query}` : ''}`);
    ws.received = [];
    ws.binaryType = 'nodebuffer';
    ws.on('message', (data) => { try { ws.received.push(JSON.parse(data.toString())); } catch (_) { /* ignore */ } });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
  const stop = () => new Promise((r) => { presage.wss.clients.forEach((c) => c.terminate()); server.close(r); });
  return { presage, made, open, stop };
}
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));

test('pure: baevskyToStress and deriveVitals', () => {
  assert.ok(baevskyToStress(50) < baevskyToStress(150)); // higher Baevsky index -> more stress
  assert.equal(baevskyToStress(100), 0.3);
  const a = deriveVitals({ hr: 80, breath: 14, baevsky: null, restingHr: null });
  assert.equal(a.restingHr, 80);                          // first reading seeds the resting average
  assert.ok(a.calm + a.stress > 0.99 && a.calm + a.stress < 1.01);
  const b = deriveVitals({ hr: 120, breath: 14, baevsky: null, restingHr: 80 });
  assert.ok(b.stress > 0.3, 'a racing heart above resting HR raises stress');
});

test('pure: parseFrame rejects malformed/oversized/mismatched frames, accepts a good one', () => {
  assert.equal(parseFrame(Buffer.alloc(5)), null);                              // too short for even a header
  assert.equal(parseFrame(makeFrame({ player: 3 })), null);                     // not a real player number
  assert.equal(parseFrame(makeFrame({ width: 10000, height: 10000 })), null);   // rejected: over the size cap
  const good = makeFrame({ player: 2, width: 4, height: 4 });
  const parsed = parseFrame(good);
  assert.deepEqual([parsed.player, parsed.width, parsed.height], [2, 4, 4]);
  assert.equal(parsed.pixels.length, 4 * 4 * 4);
});

test('two simultaneous players never mix frames or vitals', async () => {
  const { made, open, stop } = await start();
  const p1 = await open('session=alpha'), p2 = await open('session=bravo');
  p1.send(makeFrame({ player: 1 }), { binary: true });
  p2.send(makeFrame({ player: 2 }), { binary: true });
  await wait();
  assert.equal(made.length, 2, 'each connection gets its own independent SDK session');
  made[0].emit('metrics', { cardio: { pulseRate: [{ value: 61 }] } });
  made[1].emit('metrics', { cardio: { pulseRate: [{ value: 130 }] } });
  await wait();
  assert.equal(p1.received.length, 1);
  assert.equal(p1.received[0].player, 1);
  assert.equal(p1.received[0].hr, 61);
  assert.equal(p2.received.length, 1);
  assert.equal(p2.received[0].player, 2);
  assert.equal(p2.received[0].hr, 130);
  await stop();
});

test('a session groups a sender-only and a receiver-only connection for the same player', async () => {
  const { made, open, stop } = await start();
  const sender = await open('session=tab1');   // mirrors src/presage-capture.js: sends frames, never reads
  const receiver = await open('session=tab1'); // mirrors src/biometrics-presage.js: only listens
  sender.send(makeFrame({ player: 1 }), { binary: true });
  await wait();
  made[0].emit('metrics', { cardio: { pulseRate: [{ value: 72 }] } });
  await wait();
  assert.equal(receiver.received[0].hr, 72);
  assert.equal(sender.received.length, 1, 'the sender is in the same group too (harmless, matches the real client which ignores it)');
  await stop();
});

test('a connection with no session param is isolated (never grouped with anyone else)', async () => {
  const { made, open, stop } = await start();
  const lonely = await open();               // no ?session= at all
  const other = await open('session=x');
  lonely.send(makeFrame({ player: 1 }), { binary: true });
  await wait();
  made[0].emit('metrics', { cardio: { pulseRate: [{ value: 99 }] } });
  await wait();
  assert.equal(lonely.received.length, 1);
  assert.equal(other.received.length, 0);
  await stop();
});

test('disconnect destroys that connection\'s SmartSpectra session, not anyone else\'s', async () => {
  const { made, open, stop } = await start();
  const a = await open('session=a'), b = await open('session=b');
  a.send(makeFrame({ player: 1 }), { binary: true });
  b.send(makeFrame({ player: 2 }), { binary: true });
  await wait();
  assert.equal(made.length, 2);
  a.close();
  await wait();
  assert.equal(made[0].destroyCalls, 1);
  assert.equal(made[1].destroyCalls, 0);
  await stop();
});

test('missing API key: no crash, a clear status error, still usable if a key is added per-connection later', async () => {
  const { open, stop } = await start({ apiKey: '' });
  const ws = await open('session=nokey');
  ws.send(makeFrame({ player: 1 }), { binary: true });
  await wait();
  assert.equal(ws.received.length, 1);
  assert.equal(ws.received[0].type, 'status');
  assert.match(ws.received[0].error, /no API key/);
  await stop();
});

test('a non-retryable SDK error destroys the session; the next frame starts a fresh one', async () => {
  const { made, open, stop } = await start();
  const ws = await open('session=err');
  ws.send(makeFrame({ player: 1 }), { binary: true });
  await wait();
  made[0].emit('error', 'kTimestampGap', 'gap', false);
  await wait();
  assert.equal(made[0].destroyCalls, 1);
  ws.send(makeFrame({ player: 1 }), { binary: true });
  await wait();
  assert.equal(made.length, 2, 'a fresh session was created for the next frame');
  await stop();
});

test('a retryable SDK error resets instead of destroying', async () => {
  const { made, open, stop } = await start();
  const ws = await open('session=retry');
  ws.send(makeFrame({ player: 1 }), { binary: true });
  await wait();
  made[0].emit('error', 'kProcessingFailed', 'oops', true);
  await wait();
  assert.equal(made[0].resetCalls, 1);
  assert.equal(made[0].destroyCalls, 0);
  await stop();
});

test('sendFrame() throwing synchronously does not crash the server or other sessions', async () => {
  const { made, open, stop } = await start({ sdks: [{ sendFrameThrows: new Error('boom') }] });
  const ws = await open('session=throws');
  ws.send(makeFrame({ player: 1 }), { binary: true });
  await wait();
  assert.equal(made[0].destroyCalls, 1);
  const other = await open('session=fine');
  other.send(makeFrame({ player: 2 }), { binary: true });
  await wait();
  assert.equal(made.length, 2, 'the server is still alive and can start another session');
  await stop();
});

test('frame rate is capped: frames sent faster than the interval are dropped, not queued', async () => {
  const { made, open, stop } = await start({ minFrameIntervalMs: 10000 }); // effectively "only the first one"
  const ws = await open('session=fast');
  ws.send(makeFrame({ player: 1 }), { binary: true });
  ws.send(makeFrame({ player: 1 }), { binary: true });
  ws.send(makeFrame({ player: 1 }), { binary: true });
  await wait();
  assert.equal(made.length, 1);
  assert.equal(made[0].sendFrameCalls, 1);
  await stop();
});

test('an oversized message is rejected at the socket level (maxPayload), not silently accepted', async () => {
  const { open, stop } = await start();
  const ws = await open('session=big');
  const huge = Buffer.alloc(HEADER_BYTES + 700 * 480 * 4 + 100); // over MAX_WIDTH*MAX_HEIGHT*4
  let closed = false;
  ws.on('close', () => { closed = true; });
  ws.on('error', () => {}); // the client also sees a connection error; expected
  ws.send(huge, { binary: true });
  await wait(150);
  assert.equal(closed, true);
  await stop();
});

test('a connection that stops answering heartbeats is dropped', async () => {
  const server = http.createServer();
  const presage = attachPresage(server, { apiKey: 'k', metricsModule: fakeMetricsModule, heartbeatMs: 60 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ghost = new WebSocket(`ws://127.0.0.1:${port}/presage?session=ghost`, { autoPong: false });
  ghost.on('error', () => {});
  await new Promise((r) => ghost.on('open', r));
  assert.equal(presage.wss.clients.size, 1);
  await wait(400);
  assert.equal(presage.wss.clients.size, 0);
  await new Promise((r) => server.close(r));
});

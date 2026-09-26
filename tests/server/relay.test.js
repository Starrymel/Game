// Owner: D. The relay that pairs a host and a guest, inside the main server.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');
const { attachRelay, cleanRoom } = require('../../server/lib/relay');

async function start() {
  const server = http.createServer();
  const relay = attachRelay(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const open = (query) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/netplay?${query}`);
    ws.received = [];
    ws.closeInfo = null;
    ws.on('message', (data, isBinary) => ws.received.push({ text: data.toString(), isBinary }));
    ws.on('close', (code) => { ws.closeInfo = code; });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
  const stop = () => new Promise((r) => { relay.wss.clients.forEach((c) => c.terminate()); server.close(r); });
  return { relay, open, stop };
}
const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));

test('forwards messages both ways, and text stays text', async () => {
  const { open, stop } = await start();
  const host = await open('role=host'), guest = await open('role=guest');
  guest.send('{"type":"input"}');
  host.send('{"type":"state"}');
  host.send(Buffer.from([1, 2, 3]), { binary: true });
  await wait();
  assert.deepEqual(host.received, [{ text: '{"type":"input"}', isBinary: false }]);
  assert.equal(guest.received[0].text, '{"type":"state"}');
  assert.equal(guest.received[0].isBinary, false);      // the browser JSON.parse()s this, so it must not become binary
  assert.equal(guest.received[1].isBinary, true);
  await stop();
});

test('rooms are isolated from each other', async () => {
  const { open, stop } = await start();
  const hostA = await open('role=host&room=a'), guestA = await open('role=guest&room=a');
  const hostB = await open('role=host&room=b'), guestB = await open('role=guest&room=b');
  guestA.send('from-a'); guestB.send('from-b');
  await wait();
  assert.deepEqual(hostA.received.map((m) => m.text), ['from-a']);
  assert.deepEqual(hostB.received.map((m) => m.text), ['from-b']);
  await stop();
});

test('no room name means the shared default room', async () => {
  const { open, stop } = await start();
  const host = await open('role=host'), guest = await open('role=guest&room=default');
  guest.send('hello');
  await wait();
  assert.equal(host.received[0].text, 'hello');
  await stop();
});

test('a connection without a valid role is refused', async () => {
  const { open, stop } = await start();
  const bad = await open('role=spectator');
  await wait();
  assert.equal(bad.closeInfo, 1008);
  await stop();
});

test('a second host replaces the first one', async () => {
  const { open, stop } = await start();
  const first = await open('role=host'), second = await open('role=host');
  await wait();
  assert.equal(first.closeInfo, 4000);
  const guest = await open('role=guest');
  guest.send('to-host');
  await wait();
  assert.equal(second.received[0].text, 'to-host');
  await stop();
});

test('an empty room is removed, so rooms cannot pile up', async () => {
  const { open, relay, stop } = await start();
  const host = await open('role=host&room=temp');
  assert.equal(relay.rooms.has('temp'), true);
  host.close();
  await wait(150);
  assert.equal(relay.rooms.has('temp'), false);
  await stop();
});

test('room names are cleaned', () => {
  assert.equal(cleanRoom('My Room!!'), 'MyRoom');
  assert.equal(cleanRoom(''), 'default');
  assert.equal(cleanRoom(null), 'default');
  assert.equal(cleanRoom('x'.repeat(100)).length, 40);
});

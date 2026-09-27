// Owner: D. The relay that pairs a host and a guest, inside the main server.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');
const { attachRelay, cleanRoom } = require('../../server/lib/relay');

async function start() {
  const server = http.createServer();
  const relay = attachRelay(server, { heartbeatMs: 60000 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const open = (query) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/netplay?${query}`);
    ws.received = [];      // game messages only
    ws.peers = [];         // the relay's own {"type":"peer"} presence messages
    ws.closeInfo = null;
    ws.on('message', (data, isBinary) => {
      const text = data.toString();
      if (!isBinary && text.startsWith('{"type":"peer"')) ws.peers.push(JSON.parse(text).present);
      else ws.received.push({ text, isBinary });
    });
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

test('a seat that is already taken is refused; the person already there is not kicked out', async () => {
  const { open, stop } = await start();
  const first = await open('role=host&room=t'), second = await open('role=host&room=t');
  await wait();
  assert.equal(second.closeInfo, 4001);           // the newcomer is told "role taken"
  assert.equal(first.closeInfo, null);            // the first one is still connected
  const guest = await open('role=guest&room=t');
  guest.send('to-host');
  await wait();
  assert.equal(first.received[0].text, 'to-host');
  await stop();
});

test('after the first person leaves, the seat is free again (reload / rejoin)', async () => {
  const { open, stop } = await start();
  const first = await open('role=host&room=r');
  first.close();
  await wait(150);
  const again = await open('role=host&room=r');
  await wait();
  assert.equal(again.closeInfo, null);
  await stop();
});

test('presence: each seat is told when the other is filled or emptied, and once on connect', async () => {
  const { open, stop } = await start();
  const host = await open('role=host&room=p');
  await wait();
  assert.deepEqual(host.peers, [false]);                  // alone in the room
  const guest = await open('role=guest&room=p');
  await wait();
  assert.deepEqual(guest.peers, [true]);                  // host was already there
  assert.deepEqual(host.peers, [false, true]);            // host learns the guest arrived
  guest.close();
  await wait(150);
  assert.deepEqual(host.peers, [false, true, false]);     // and that the guest left
  await stop();
});

test('room status for the lobby', async () => {
  const { open, relay, stop } = await start();
  assert.deepEqual(relay.status('nobody'), { host: false, guest: false });
  const host = await open('role=host&room=lobby1');
  await wait();
  assert.deepEqual(relay.status('lobby1'), { host: true, guest: false });
  const guest = await open('role=guest&room=lobby1');
  await wait();
  assert.deepEqual(relay.status('lobby1'), { host: true, guest: true });
  assert.deepEqual(relay.status('lobby-other'), { host: false, guest: false });   // rooms are looked up by exact name only
  host.close(); guest.close();
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

test('a connection that stops answering heartbeats is dropped, freeing its seat', async () => {
  const server = http.createServer();
  const relay = attachRelay(server, { heartbeatMs: 60 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ghost = new WebSocket(`ws://127.0.0.1:${port}/netplay?role=host&room=ghost`, { autoPong: false }); // a laptop whose Wi-Fi died
  await new Promise((r) => ghost.on('open', r));
  ghost.on('error', () => {});
  assert.equal(relay.status('ghost').host, true);
  await wait(400);
  assert.equal(relay.status('ghost').host, false);        // seat is free again
  const again = new WebSocket(`ws://127.0.0.1:${port}/netplay?role=host&room=ghost`);
  let closed = null; again.on('close', (c) => { closed = c; }); again.on('error', () => {});
  await new Promise((r) => again.on('open', r));
  await wait(100);
  assert.equal(closed, null);                              // and someone new can sit there
  relay.wss.clients.forEach((c) => c.terminate()); await new Promise((r) => server.close(r));
});

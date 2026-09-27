// Regression test: ws's own `{ server, path }` convenience mode does NOT coexist safely with a
// second such instance on the same http.Server -- whichever one attaches first unconditionally
// aborts (400) any upgrade request that doesn't match ITS OWN path, even one a later-registered
// instance would have handled. Caught only by booting a real server with two real endpoints, not
// by either endpoint's own mocked unit tests. See server/lib/wsRouter.js for the fix.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');
const { attachRelay } = require('../../server/lib/relay');
const { attachPresage } = require('../../server/lib/presage');

test('two independently-attached endpoints on the same server both accept connections', async () => {
  const server = http.createServer();
  attachRelay(server, { heartbeatMs: 60000 });
  attachPresage(server, { apiKey: 'k', metricsModule: { breathingMetrics: [], cardioMetrics: [], decodeMetrics: (x) => x, PixelFormat: { kRGBA: 'RGBA' } }, heartbeatMs: 60000 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const opens = (path) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });

  const netplay = await opens('/netplay?role=host');
  const presage = await opens('/presage?session=x');
  assert.equal(netplay.readyState, WebSocket.OPEN);
  assert.equal(presage.readyState, WebSocket.OPEN);

  netplay.close(); presage.close();
  await new Promise((r) => server.close(r));
});

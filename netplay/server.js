// Dumb relay for two-laptop play: pairs exactly one 'host' connection and one
// 'guest' connection and forwards raw messages between them, untouched. All
// game logic (who simulates, who predicts, input/state message shapes) lives
// in src/net.js on the browser side -- this process doesn't parse payloads at
// all, so message formats can evolve without ever touching this file.
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.NETPLAY_PORT) || 8788;
const slots = { host: null, guest: null };

const other = (role) => (role === 'host' ? 'guest' : 'host');

const wss = new WebSocketServer({ port: PORT, path: '/netplay' });
console.log(`[netplay] relay listening on ws://0.0.0.0:${PORT}/netplay`);

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://placeholder');
  const role = url.searchParams.get('role');

  if (role !== 'host' && role !== 'guest') {
    ws.close(1008, 'connect with ?role=host or ?role=guest');
    return;
  }

  if (slots[role]) {
    slots[role].close(4000, 'replaced by a new connection');
  }
  slots[role] = ws;
  console.log(`[netplay] ${role} connected`);

  ws.on('message', (data, isBinary) => {
    const peer = slots[other(role)];
    // Forward text as text: re-sending a Buffer defaults to a binary frame, which browsers then
    // deliver as a Blob that JSON.parse() can't read (broke two-laptop play in real browsers).
    if (peer && peer.readyState === peer.OPEN) peer.send(data, { binary: isBinary });
  });

  ws.on('close', () => {
    if (slots[role] === ws) {
      slots[role] = null;
      console.log(`[netplay] ${role} disconnected`);
    }
  });
});

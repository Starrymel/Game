// Owner: D. Two-laptop relay running inside the main server: same port, path /netplay.
// (Render and similar hosts expose ONE public port, so the separate netplay/server.js can't be used there.
//  netplay/server.js still works for same-Wi-Fi play; the messages are identical.)
//
// Pairs at most one "host" and one "guest" per room and forwards their messages untouched.
// Connect with  wss://<site>/netplay?role=host|guest[&room=<name>].  No room = the "default" room.
const { WebSocketServer } = require('ws');

const MAX_ROOMS = 50;             // stops a stranger opening thousands of rooms on a public site
const MAX_PAYLOAD = 512 * 1024;   // per message; a full game state is a few KB
const other = (role) => (role === 'host' ? 'guest' : 'host');
const cleanRoom = (raw) => (String(raw || 'default').replace(/[^\w-]/g, '').slice(0, 40) || 'default');

function attachRelay(server, { path = '/netplay', log = () => {} } = {}) {
  const wss = new WebSocketServer({ server, path, maxPayload: MAX_PAYLOAD });
  const rooms = new Map();        // name -> { host, guest }

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://placeholder');
    const role = url.searchParams.get('role');
    const name = cleanRoom(url.searchParams.get('room'));

    if (role !== 'host' && role !== 'guest') return ws.close(1008, 'connect with ?role=host or ?role=guest');
    if (!rooms.has(name) && rooms.size >= MAX_ROOMS) return ws.close(1013, 'too many rooms');

    const room = rooms.get(name) || { host: null, guest: null };
    rooms.set(name, room);
    if (room[role]) room[role].close(4000, 'replaced by a new connection');
    room[role] = ws;
    log(`[relay] ${role} joined room "${name}"`);

    ws.on('message', (data, isBinary) => {
      const peer = room[other(role)];
      // Keep text as text: the browser does JSON.parse(evt.data), which a binary frame would break.
      if (peer && peer.readyState === peer.OPEN) peer.send(data, { binary: isBinary });
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      if (room[role] === ws) room[role] = null;
      if (!room.host && !room.guest && rooms.get(name) === room) rooms.delete(name);
      log(`[relay] ${role} left room "${name}"`);
    });
  });

  return { wss, rooms };
}

module.exports = { attachRelay, cleanRoom };

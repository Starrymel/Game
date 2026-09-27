// Owner: D. Two-laptop relay running inside the main server: same port, path /netplay.
// (Render and similar hosts expose ONE public port, so the separate netplay/server.js can't be used there.
//  netplay/server.js still works for same-Wi-Fi play; the game messages are identical.)
//
// Pairs at most one "host" (Player 1) and one "guest" (Player 2) per room and forwards their messages untouched.
// Connect with  wss://<site>/netplay?role=host|guest[&room=<name>].  No room = the "default" room.
//
// Extra, sent by the relay itself (the game ignores message types it doesn't know):
//   {"type":"peer","present":true|false}   the other seat is now filled / empty (also sent once on connect)
// A seat that is already held by a live connection is refused with close code 4001 ("role taken"), so a
// second person can never silently kick the first one out. Dead connections are dropped by a heartbeat.
const { WebSocketServer } = require('ws');
const { routeUpgrades } = require('./wsRouter');

const MAX_ROOMS = 50;             // stops a stranger opening thousands of rooms on a public site
const MAX_PAYLOAD = 512 * 1024;   // per message; a full game state is a few KB
const HEARTBEAT_MS = 20000;
const other = (role) => (role === 'host' ? 'guest' : 'host');
const cleanRoom = (raw) => (String(raw || 'default').replace(/[^\w-]/g, '').slice(0, 40) || 'default');
const isOpen = (ws) => !!ws && ws.readyState === ws.OPEN;
const sendJson = (ws, obj) => { if (isOpen(ws)) ws.send(JSON.stringify(obj)); };

function attachRelay(server, { path = '/netplay', log = () => {}, heartbeatMs = HEARTBEAT_MS } = {}) {
  // noServer: true + a shared dispatcher (see wsRouter.js) -- ws's own `{ server, path }` convenience
  // mode does not coexist safely with a second such instance on the same server (e.g. presage.js's).
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  routeUpgrades(server).set(path, wss);
  const rooms = new Map();        // name -> { host, guest }

  // Who is in a room right now (for the lobby's "Player 1 is taken" display). Only exact names are looked up.
  const status = (rawName) => {
    const room = rooms.get(cleanRoom(rawName));
    return { host: isOpen(room?.host), guest: isOpen(room?.guest) };
  };

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://placeholder');
    const role = url.searchParams.get('role');
    const name = cleanRoom(url.searchParams.get('room'));

    if (role !== 'host' && role !== 'guest') return ws.close(1008, 'connect with ?role=host or ?role=guest');
    if (!rooms.has(name) && rooms.size >= MAX_ROOMS) return ws.close(1013, 'too many rooms');

    const room = rooms.get(name) || { host: null, guest: null };
    if (isOpen(room[role])) return ws.close(4001, 'role taken');   // someone is already sitting there
    rooms.set(name, room);
    room[role] = ws;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    log(`[relay] ${role} joined room "${name}"`);

    // Tell both seats about each other.
    sendJson(ws, { type: 'peer', present: isOpen(room[other(role)]) });
    sendJson(room[other(role)], { type: 'peer', present: true });

    ws.on('message', (data, isBinary) => {
      const peer = room[other(role)];
      // Keep text as text: the browser does JSON.parse(evt.data), which a binary frame would break.
      if (isOpen(peer)) peer.send(data, { binary: isBinary });
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      if (room[role] === ws) {
        room[role] = null;
        sendJson(room[other(role)], { type: 'peer', present: false });
      }
      if (!room.host && !room.guest && rooms.get(name) === room) rooms.delete(name);
      log(`[relay] ${role} left room "${name}"`);
    });
  });

  // Heartbeat: a laptop that vanished (lid closed, Wi-Fi gone) would otherwise keep its seat for minutes.
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch (_) { /* closing */ }
    }
  }, heartbeatMs);
  beat.unref?.();
  wss.on('close', () => clearInterval(beat));

  return { wss, rooms, status };
}

module.exports = { attachRelay, cleanRoom };

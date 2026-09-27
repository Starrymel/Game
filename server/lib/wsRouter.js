// Attaches (once per http.Server) a single 'upgrade' listener that dispatches by exact pathname
// to whichever WebSocketServer is registered for it. Needed because ws's own convenience
// `{ server, path }` mode does NOT coexist with a second such instance on the same server: each
// instance's internal handler unconditionally aborts (400) any request whose path doesn't match
// ITS OWN path -- even one that a different, later-registered instance would have handled -- so
// two independently-`{server,path}`-attached WebSocketServers corrupt each other's handshakes.
// The fix (ws's own documented pattern for multiple endpoints on one server): every WebSocketServer
// here is built with `{ noServer: true }`, and this is the only thing that ever calls
// server.on('upgrade', ...).
function routeUpgrades(server) {
  if (server.__wsRoutes) return server.__wsRoutes;
  const routes = new Map(); // pathname -> WebSocketServer ({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    let pathname;
    try { pathname = new URL(req.url, 'http://placeholder').pathname; } catch (_) { pathname = null; }
    const wss = pathname && routes.get(pathname);
    if (!wss) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  server.__wsRoutes = routes;
  return routes;
}

module.exports = { routeUpgrades };

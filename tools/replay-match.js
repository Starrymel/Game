// Owner: C
// Replays fixtures/fake-match.json onto the bus
//
// Browser-safe ES module. Fixture format: { meta, events: [{ at, type, payload }] },
// `at` = ms from match start, sorted ascending.
//
//   replayMatchSync(bus, fixture)            // emit everything immediately (tests)
//   replayMatch(bus, fixture, { speed: 1 })  // real-time-ish, returns { stop, done }
//   node tools/replay-match.js               // print detected commentary moments

export function replayMatchSync(bus, fixture) {
  for (const e of fixture.events) bus.emit(e.type, e.payload);
}

// Replays in (scaled) real time. With restamp: true, payload.t is rewritten to
// Date.now() at emit so latency/staleness checks downstream see live timestamps.
export function replayMatch(bus, fixture, { speed = 1, restamp = true } = {}) {
  let stopped = false;
  let timer = null;
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const start = Date.now();
  let i = 0;

  function tick() {
    if (stopped) return;
    const elapsed = (Date.now() - start) * speed;
    while (i < fixture.events.length && fixture.events[i].at <= elapsed) {
      const e = fixture.events[i++];
      const payload = restamp ? { ...e.payload, t: Date.now() } : e.payload;
      bus.emit(e.type, payload);
    }
    if (i >= fixture.events.length) return resolveDone();
    timer = setTimeout(tick, Math.max(0, (fixture.events[i].at - elapsed) / speed));
  }
  tick();

  return {
    done,
    stop() {
      stopped = true;
      clearTimeout(timer);
      resolveDone();
    },
  };
}

async function cli() {
  const { readFileSync } = await import('node:fs');
  const { bus } = await import('../src/eventBus.js');
  const { startCommentaryListener } = await import('../src/commentary/listener.js');
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/fake-match.json', import.meta.url)));
  const t0 = fixture.meta.t0;
  startCommentaryListener({
    bus,
    onMoment: (m) => {
      if (m.type === 'hit') return;
      const who = m.player ? ` P${m.player}` : '';
      console.log(`${((m.t - t0) / 1000).toFixed(2).padStart(6)}s  ${m.type.padEnd(12)}${who}  ${JSON.stringify(m.data)}`);
    },
  });
  replayMatchSync(bus, fixture);
}

if (globalThis.process?.argv?.[1] && new URL(import.meta.url).pathname === process.argv[1]) cli();

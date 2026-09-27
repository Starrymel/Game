// "Hold the match": while a player is on the calibration pages the game stands still (fighters, swords, prizes, clock).
// Online, each laptop tells the other, so the host waits for the guest's calibration too.
let local = false, peer = false;
const listeners = new Set();
export const isHeld = () => local || peer;
export const isLocalHold = () => local;
export function setLocalHold(on) { on = !!on; if (on === local) return; local = on; listeners.forEach((f) => f(local)); }
export function setPeerHold(on) { peer = !!on; }
export const onLocalHoldChange = (f) => { listeners.add(f); return () => listeners.delete(f); };

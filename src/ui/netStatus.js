// Online play feedback: a banner for "connecting / waiting for the other player / connection lost / seat taken",
// and a small chip that says who you are and lets you leave. Views only: state comes from net.js.
import { bus } from '../eventBus.js';
import { getNetInfo } from '../net.js';
import { waitingText, lobbySearch, DEFAULT_ROOM } from '../lobbyConfig.js';

const CSS = `
#net-banner{position:fixed;top:56px;left:50%;transform:translateX(-50%);z-index:70;max-width:92vw;text-align:center;background:#161a24;border:1px solid #4a7bff;color:#f4f5f8;border-radius:12px;padding:10px 18px;font:15px ui-monospace,Menlo,Consolas,monospace}
#net-banner.warn{border-color:#ffd166;color:#ffe9b0}
#net-banner[hidden]{display:none}
#net-banner button{margin-left:12px;font:inherit;color:#f4f5f8;background:#232838;border:1px solid #3a4058;border-radius:8px;padding:4px 12px;cursor:pointer}
#net-chip{position:fixed;right:12px;bottom:12px;z-index:40;display:flex;gap:8px;align-items:center;background:#161a24;border:1px solid #2c3040;border-radius:999px;padding:6px 12px;font:13px ui-monospace,Menlo,Consolas,monospace;color:#b6b9c6}
#net-chip button{font:inherit;color:#f4f5f8;background:#232838;border:1px solid #3a4058;border-radius:999px;padding:3px 10px;cursor:pointer}
`;

const roomNote = (room) => (room && String(room).toUpperCase() !== DEFAULT_ROOM ? ` in room ${room}` : '');

// The message for the current connection state ('' = nothing to say: the match is on).
export function bannerFor(info) {
  if (info.state === 'rejected') {
    return info.rejectedCode === 4001
      ? { text: `Player ${info.role === 'host' ? 1 : 2} is already taken${roomNote(info.room)}.`, warn: true, action: 'lobby' }
      : { text: 'The server could not take you in right now (too many rooms?). Try again in a moment.', warn: true, action: 'lobby' };
  }
  if (info.state === 'closed') return { text: 'Connection lost - trying to reconnect...', warn: true };
  if (info.state === 'connecting' || info.state === 'idle') return { text: `Connecting${roomNote(info.room) ? ` (room ${info.room})` : ''}...`, warn: false };
  const wait = info.peerKnown ? waitingText(info) : '';
  return wait ? { text: wait, warn: false } : null;
}

export function initNetStatus() {
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  const banner = document.createElement('div'); banner.id = 'net-banner'; banner.hidden = true; banner.setAttribute('role', 'status');
  const chip = document.createElement('div'); chip.id = 'net-chip';
  document.body.append(banner, chip);
  const toLobby = () => { location.search = lobbySearch(location.search); };

  function paint() {
    const info = getNetInfo();
    const b = bannerFor(info);
    banner.hidden = !b;
    if (b) {
      banner.classList.toggle('warn', !!b.warn);
      banner.textContent = b.text;
      if (b.action === 'lobby') {
        const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = 'Back to start'; btn.onclick = toLobby;
        banner.append(btn);
      }
    }
    chip.innerHTML = `<span>Online: Player ${info.role === 'host' ? 1 : 2}${roomNote(info.room).replace(' in room ', ' &middot; room ')}</span><button type="button" id="net-leave">Leave</button>`;
    chip.querySelector('#net-leave').onclick = toLobby;
  }
  bus.on('net_status', paint);
  bus.on('net_peer', paint);
  paint();
}

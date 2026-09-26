// Browser side of the Presage bridge: grabs a player's webcam, downsamples
// frames onto a hidden canvas, and streams raw RGBA over WebSocket to
// bridge/server.js. Not auto-started (needs camera permission + a running
// bridge + a real API key) — call startPresageCapture() explicitly, e.g.
// from a debug panel button or the console.
//
// Binary frame layout, little-endian:
//   uint32 player | uint32 width | uint32 height | float64 timestampUs | RGBA bytes
const HEADER_BYTES = 20;

export async function listCameraDevices() {
  // Browsers hide device labels/IDs from enumerateDevices() until the page
  // has been granted camera permission at least once -- request it first
  // (grabbing whatever the default camera is, then releasing it immediately)
  // so the real list is usable on the very first call.
  let probe = null;
  try {
    probe = await navigator.mediaDevices.getUserMedia({ video: true });
  } catch (e) {
    console.warn('[presage-capture] camera permission needed to list real device labels', e);
  } finally {
    probe?.getTracks().forEach((t) => t.stop());
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'videoinput');
}

export async function startPresageCapture(player, {
  deviceId, wsUrl = 'ws://localhost:8787/biometrics', fps = 30, width = 320, height = 240,
} = {}) {
  // frameRate is a request, not a guarantee -- but without it many cameras
  // default well below the >=25fps SmartSpectra requires (see bridge logs:
  // ValidationCode.kFrameRateTooLow if this isn't actually met).
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { frameRate: { ideal: fps, min: 25 }, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
  });

  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  await video.play();

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const socket = new WebSocket(wsUrl);
  socket.binaryType = 'arraybuffer';

  function sendFrame() {
    ctx.drawImage(video, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height); // RGBA Uint8ClampedArray

    const buf = new ArrayBuffer(HEADER_BYTES + data.length);
    const view = new DataView(buf);
    view.setUint32(0, player, true);
    view.setUint32(4, width, true);
    view.setUint32(8, height, true);
    view.setFloat64(12, (performance.timeOrigin + performance.now()) * 1000, true); // ms -> us
    new Uint8Array(buf, HEADER_BYTES).set(data);

    if (socket.readyState === WebSocket.OPEN) socket.send(buf);
  }

  // requestVideoFrameCallback fires once per actually-decoded video frame --
  // unlike setInterval, it can't drift under main-thread jank and can't send
  // the same stale frame twice (which would waste SmartSpectra's >=25fps
  // requirement on zero new signal). Falls back to setInterval on browsers
  // without it (Safari has supported it since 15.4).
  let stopped = false;
  let rvfcHandle = null;
  let timer = null;

  socket.onopen = () => {
    if (typeof video.requestVideoFrameCallback === 'function') {
      const onFrame = () => {
        if (stopped) return;
        sendFrame();
        rvfcHandle = video.requestVideoFrameCallback(onFrame);
      };
      rvfcHandle = video.requestVideoFrameCallback(onFrame);
    } else {
      timer = setInterval(sendFrame, 1000 / fps);
    }
  };
  socket.onerror = (e) => console.warn(`[presage-capture] player ${player} socket error`, e);

  return function stopPresageCapture() {
    stopped = true;
    if (rvfcHandle) video.cancelVideoFrameCallback(rvfcHandle);
    clearInterval(timer);
    socket.close();
    stream.getTracks().forEach((t) => t.stop());
  };
}

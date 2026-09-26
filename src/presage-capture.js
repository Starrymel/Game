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
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'videoinput');
}

export async function startPresageCapture(player, {
  deviceId, wsUrl = 'ws://localhost:8787/biometrics', fps = 8, width = 320, height = 240,
} = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: deviceId ? { deviceId: { exact: deviceId } } : true,
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

  let timer = null;
  socket.onopen = () => {
    timer = setInterval(() => {
      ctx.drawImage(video, 0, 0, width, height);
      const { data } = ctx.getImageData(0, 0, width, height); // RGBA Uint8ClampedArray

      const buf = new ArrayBuffer(HEADER_BYTES + data.length);
      const view = new DataView(buf);
      view.setUint32(0, player, true);
      view.setUint32(4, width, true);
      view.setUint32(8, height, true);
      view.setFloat64(12, performance.timeOrigin + performance.now(), true);
      new Uint8Array(buf, HEADER_BYTES).set(data);

      if (socket.readyState === WebSocket.OPEN) socket.send(buf);
    }, 1000 / fps);
  };
  socket.onerror = (e) => console.warn(`[presage-capture] player ${player} socket error`, e);

  return function stopPresageCapture() {
    clearInterval(timer);
    socket.close();
    stream.getTracks().forEach((t) => t.stop());
  };
}

// MediaPipe Face Landmarker in the browser: no bridge, no API key. Loads the library and model at
// runtime from public CDNs (needs internet). Emits bus 'face_values' (raw scores, ~every frame) and
// 'gesture' ({player, name, t}) events.
import { bus } from '../eventBus.js';
import { createGestureDetector, scoreMap } from './gestures.js';
import { headSample } from './headPose.js';
import { lumaMean } from './warnings.js';

const VERSION = '0.10.21';
export const MP_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`;
export const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
export const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

let running = null;

export async function startFaceTracking({ player, deviceId, opts, onStatus = () => {} } = {}) {
  if (running) stopFaceTracking();
  onStatus('Loading MediaPipe…');
  const { FilesetResolver, FaceLandmarker } = await import(/* @vite-ignore */ MP_BUNDLE);
  const fileset = await FilesetResolver.forVisionTasks(MP_WASM);
  onStatus('Loading face model…');
  let landmarker;
  try {
    landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MP_MODEL, delegate: 'GPU' },
      runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true,
    });
  } catch (e) { // GPU delegate unavailable -> CPU
    landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MP_MODEL, delegate: 'CPU' },
      runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true,
    });
  }
  onStatus('Starting camera…');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), width: 640, height: 480 }, audio: false,
  });
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.srcObject = stream;
  await video.play();

  const detect = createGestureDetector(opts);
  const state = { stop: false, lastVideoTime: -1, frames: 0, statFrames: 0, lastStat: performance.now() };
  // Tiny canvas for measuring how bright the picture is (for the "too dark" warning).
  const thumb = document.createElement('canvas'); thumb.width = 32; thumb.height = 24;
  const thumbCtx = thumb.getContext('2d', { willReadFrequently: true });
  const loop = () => {
    if (state.stop) return;
    if (video.currentTime !== state.lastVideoTime && video.readyState >= 2) {
      state.lastVideoTime = video.currentTime;
      const now = performance.now();
      const res = landmarker.detectForVideo(video, now);
      state.frames++; state.statFrames++;
      if (now - state.lastStat >= 500) {
        let luma = null;
        try { thumbCtx.drawImage(video, 0, 0, 32, 24); luma = lumaMean(thumbCtx.getImageData(0, 0, 32, 24).data); } catch (_) { /* unreadable frame */ }
        bus.emit('face_frame', { player, fps: (state.statFrames * 1000) / (now - state.lastStat), luma, t: Date.now() });
        state.statFrames = 0; state.lastStat = now;
      }
      const cats = res?.faceBlendshapes?.[0]?.categories;
      if (cats) {
        const scores = scoreMap(cats);
        bus.emit('face_values', { player, scores, t: Date.now() });
        for (const name of detect(scores, now)) bus.emit('gesture', { player, name, t: Date.now() });
        bus.emit('head_sample', { player, sample: headSample(res.faceLandmarks?.[0]), t: Date.now() });
      } else {
        bus.emit('face_values', { player, scores: null, t: Date.now() }); // no face in view
        bus.emit('head_sample', { player, sample: null, t: Date.now() });
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  running = { state, stream, landmarker };
  onStatus('Face tracking on.');
}

export function stopFaceTracking() {
  if (!running) return;
  running.state.stop = true;
  running.stream.getTracks().forEach((t) => t.stop());
  try { running.landmarker.close(); } catch (_) { /* ignore */ }
  running = null;
}

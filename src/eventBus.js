const listeners = new Map();

export const bus = {
  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => bus.off(type, fn);
  },
  off(type, fn) {
    listeners.get(type)?.delete(fn);
  },
  emit(type, payload) {
    listeners.get(type)?.forEach((fn) => fn(payload));
  },
};

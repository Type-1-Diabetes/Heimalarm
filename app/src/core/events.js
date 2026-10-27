// Einfacher Ereignis-Bus zwischen den Modulen.
const handlers = new Map();

export function on(name, fn) {
  if (!handlers.has(name)) handlers.set(name, new Set());
  handlers.get(name).add(fn);
  return () => handlers.get(name).delete(fn);
}

export function emit(name, data) {
  for (const fn of handlers.get(name) || []) {
    try { fn(data); } catch (e) { console.error(`[${name}]`, e); }
  }
}

// A Map or Set whose key or value type is only inferred may end up holding external data that does not match the inferred type.
// Adding it and reading it back must behave as in plain JavaScript instead of asserting the inferred type. The container itself stays a Map or Set.
const data = JSON.parse('{"t":"abc","u":"d","l":["x","y"]}') as { t: number; u: number; l: number[] };
const say = (label: string, f: () => unknown): void => { let r: string; try { const v = f(); r = typeof v + " " + (typeof v === "object" ? JSON.stringify(v) : String(v)); } catch (e) { r = "throws " + (e as Error).constructor.name; } console.log(label + " ==> " + r); };
say("Map.set", () => { const m = new Map([[1, 2]]); m.set(2, data.t); return m.get(2)! + 1; });
say("Map constructor", () => { const m = new Map([[1, data.t]]); return m.get(1)! + 1; });
say("Map key", () => { const m = new Map([[1, 2]]); m.set(data.t, 3); return [...m.keys()].map(k => k + 1); });
say("Map values", () => { const m = new Map([[1, 2]]); m.set(2, data.t); let s = ""; for (const v of m.values()) s += v + 1; return s; });
say("Map forEach", () => { const m = new Map([[1, data.t]]); let s = ""; m.forEach(v => { s += v + 1; }); return s; });
say("Set.add", () => { const s = new Set([1]); s.add(data.t); return [...s].map(v => v + 1); });
say("Set constructor", () => { const s = new Set([data.t]); let r = ""; for (const v of s) r += v + 1; return r; });
say("a variable assigned from Map.get", () => { const m = new Map([[1, 2]]); m.set(2, data.t); let n = 0; n = m.get(2)!; return n + 1; });
say("a variable that adds up Map values", () => { const m = new Map([[1, 2]]); m.set(2, data.t); let n = 0; for (const v of m.values()) n += v; return n; });
say("entries destructured", () => { const m = new Map([[1, 2]]); m.set(2, data.t); let r = ""; for (const [k, v] of m) r += k + v + 1; return r; });
say("size, has and delete stay exact", () => { const m = new Map([[1, 2]]); m.set(2, data.t); return [m.size, m.has(2), m.delete(2), m.size].join(); });
say("WeakMap.set", () => { const key = {}; const w = new WeakMap([[key, 1]]); w.set(key, data.t); return w.get(key)! + 1; });
say("the iterator taken by hand", () => { const s = new Set([1]); s.add(data.t); let last = 0; const it = s[Symbol.iterator](); for (let step = it.next(); !step.done; step = it.next()) last = step.value; return last + 1; });

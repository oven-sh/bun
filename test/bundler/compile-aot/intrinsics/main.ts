const out: string[] = [];
const say = (name: string, f: () => unknown) => { let r: string; try { const v = f(); r = typeof v === "string" ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v); } catch (e: any) { r = "threw " + e.constructor.name + ": " + String(e.message).slice(0, 60); } out.push(name + " = " + r); };
const any = (v: unknown): any => v;

const ascii = "hello, world";
const wide = "héllo 世界 😀!";
const rope = any("left-" + String(Date.now()).slice(0, 0) + "right" + ascii.slice(3));
for (const s of [ascii, wide, rope, ""]) {
  for (const i of [0, 1, 6, 7, 8, 9, s.length - 1, s.length, -1, 1.5, NaN, any("2"), any(undefined), 2 ** 31]) {
    say(`charCodeAt(${JSON.stringify(s).slice(0, 8)}, ${String(i)})`, () => s.charCodeAt(i));
    say(`codePointAt(${JSON.stringify(s).slice(0, 8)}, ${String(i)})`, () => s.codePointAt(i));
    say(`charAt(${JSON.stringify(s).slice(0, 8)}, ${String(i)})`, () => s.charAt(i));
  }
}
say("charCodeAt on a String object", () => any(new String("abc")).charCodeAt(1));
say("charCodeAt on a number", () => any(5).charCodeAt?.(0));
say("charCodeAt borrowed", () => String.prototype.charCodeAt.call(any(12345), 2));
say("charAt borrowed by null", () => String.prototype.charAt.call(any(null), 0));
const fake = { charCodeAt(i: number) { return "mine " + i; }, charAt: (i: number) => "arrow " + i, codePointAt: 7 };
say("charCodeAt of an object", () => fake.charCodeAt(3));
say("charAt of an object", () => fake.charAt(3));
say("codePointAt that is a number", () => any(fake).codePointAt(1));

const ints = [1, 2, 3]; const vals: unknown[] = ["a", {}, null]; const dbls = [1.5, 2.5]; const holes = [1, , 3]; const empty: number[] = [];
say("push int", () => ints.push(4)); say("push double onto ints", () => ints.push(4.5)); say("push string onto numbers", () => any(ints).push("s"));
say("ints now", () => JSON.stringify(ints));
say("push object", () => vals.push({ a: 1 })); say("push undefined", () => vals.push(undefined)); say("vals now", () => vals.length + ":" + typeof vals[3] + typeof vals[4]);
say("push onto doubles", () => dbls.push(3.5)); say("push int onto doubles", () => dbls.push(4)); say("dbls now", () => JSON.stringify(dbls));
say("push onto holes", () => holes.push(9)); say("holes now", () => JSON.stringify(holes));
say("push onto empty", () => empty.push(1)); say("empty now", () => JSON.stringify(empty));
const many: number[] = []; for (let i = 0; i < 1000; i++) many.push(i * 2); say("many", () => many.length + ":" + many[999] + ":" + many.reduce((a, b) => a + b, 0));
const objs: object[] = []; for (let i = 0; i < 1000; i++) objs.push({ i }); say("objs", () => objs.length + ":" + JSON.stringify(objs[999]));
const old: unknown[] = []; for (let i = 0; i < 50; i++) old.push(i); Bun.gc(true); for (let i = 0; i < 50; i++) old.push({ young: i }); Bun.gc(true); say("old array, young values", () => old.length + ":" + JSON.stringify(old[99]));
say("push onto frozen", () => Object.freeze([1, 2]).push(3));
say("push onto sealed", () => Object.seal([1, 2]).push(3));
say("push onto non-extensible", () => Object.preventExtensions([1, 2]).push(3));
say("push, length not writable", () => { const a = [1]; Object.defineProperty(a, "length", { writable: false }); return a.push(2); });
say("push onto literal twice", () => { const f = () => [1, 2, 3]; const a = f(); a.push(4); return JSON.stringify([a, f()]); });
say("push two", () => any([1]).push(2, 3)); say("push none", () => any([1]).push());
say("push borrowed by an object", () => { const o: any = { length: 2 }; const r = Array.prototype.push.call(o, "x"); return r + ":" + JSON.stringify(o); });
class Stack extends Array<number> { push(...v: number[]) { return super.push(...v.map(x => x * 10)); } }
say("push of a subclass", () => { const s = new Stack(); s.push(1); s.push(2); return JSON.stringify(Array.from(s)); });
class Plain extends Array<number> {}
say("push of a plain subclass", () => { const s = new Plain(); s.push(1); s.push(2); return JSON.stringify(Array.from(s)) + (s instanceof Plain); });
const queue = { items: [] as number[], push(v: number) { this.items.unshift(v); return "queued"; }, pop() { return "popped " + this.items.length; } };
say("push of an object", () => queue.push(5)); say("pop of an object", () => queue.pop());
say("pop ints", () => [1, 2, 3].pop()); say("pop values", () => ["a", "b"].pop()); say("pop doubles", () => [1.5, 2.5].pop()); say("pop empty", () => [].pop());
say("pop hole", () => { const a = [1, , ]; return String(a.pop()) + a.length; });
say("pop hole with a prototype behind it", () => { (Array.prototype as any)[1] = "proto"; try { const a = [1, , ]; return String(a.pop()) + a.length; } finally { delete (Array.prototype as any)[1]; } });
say("pop frozen", () => Object.freeze([1, 2]).pop());
say("pop until empty", () => { const a = [1, 2, 3]; const r = []; while (a.length) r.push(a.pop()); r.push(a.pop()); return JSON.stringify(r) + a.length; });
say("pop an argument", () => any([1, 2]).pop(9));
for (const v of [[], [1], new Stack(), new Plain(), {}, null, undefined, 1, "s", new Proxy([], {}), new Proxy({}, {}), new Uint8Array(1), { length: 0 }, Array.prototype, function () {}])
  say("isArray " + Object.prototype.toString.call(v), () => Array.isArray(v));
say("isArray of a revoked proxy", () => { const p = Proxy.revocable([], {}); p.revoke(); return Array.isArray(p.proxy); });
say("isArray none", () => any(Array).isArray()); say("isArray two", () => any(Array).isArray([], 1));
say("isArray of an object", () => ({ isArray: (v: unknown) => "mine " + v }).isArray(1));

const m = new Map<unknown, unknown>([["a", 1], [1, "one"], [NaN, "nan"], [0, "zero"]]); const k = {};
say("get", () => m.get("a")); say("get number", () => m.get(1)); say("get NaN", () => m.get(NaN)); say("get -0", () => m.get(-0)); say("get missing", () => m.get("zz")); say("get rope", () => m.get("" + "a"));
say("has", () => m.has("a")); say("has missing", () => m.has(k)); say("set returns the map", () => m.set(k, "obj") === m); say("get object", () => m.get(k)); say("size", () => m.size);
say("set chained", () => m.set("x", 1).set("y", 2).get("y"));
for (let i = 0; i < 2000; i++) m.set("k" + i, i); say("after many sets", () => m.size + ":" + m.get("k1999") + ":" + m.has("k2000"));
const s = new Set<unknown>([1, "a", NaN]);
say("set has", () => s.has(1)); say("set has NaN", () => s.has(NaN)); say("set has missing", () => s.has(2)); say("add returns the set", () => s.add(2) === s); say("set has added", () => s.has(2) + ":" + s.size);
for (let i = 0; i < 2000; i++) s.add(i % 500); say("after many adds", () => s.size);
const wm = new WeakMap<object, number>(); const ws = new WeakSet<object>();
say("weak map", () => { wm.set(k, 5); return wm.get(k) + ":" + wm.has(k) + ":" + wm.has({}); }); say("weak set", () => { ws.add(k); return ws.has(k) + ":" + ws.has({}); });
say("weak map set of a number", () => any(wm).set(1, 2)); say("weak set add of a number", () => any(ws).add(1));
say("map get borrowed by a set", () => Map.prototype.get.call(any(s), 1)); say("set has borrowed by a map", () => Set.prototype.has.call(any(m), "a"));
say("map has borrowed by a set", () => Map.prototype.has.call(any(s), 1)); say("set add borrowed by an object", () => Set.prototype.add.call(any({}), 1));
class Counting extends Map<string, number> { gets = 0; get(key: string) { this.gets++; return super.get(key); } }
say("get of a subclass", () => { const c = new Counting([["a", 1]]); return c.get("a") + ":" + c.get("b") + ":" + c.gets + ":" + c.has("a"); });
class PlainMap extends Map<string, number> {}
say("get of a plain subclass", () => { const c = new PlainMap([["a", 1]]); c.set("b", 2); return c.get("a") + ":" + c.get("b") + ":" + c.has("c"); });
const store = { data: { a: 1 } as Record<string, number>, get(key: string) { return this.data[key]; }, has(key: string) { return key in this.data; }, set(key: string, v: number) { this.data[key] = v; return "stored"; }, add(v: number) { return v + 1; } };
say("get of an object", () => store.get("a")); say("has of an object", () => store.has("b")); say("set of an object", () => store.set("b", 2)); say("add of an object", () => store.add(1));
say("get of a URLSearchParams", () => new URLSearchParams("a=1").get("a")); say("has of a Headers", () => new Headers({ a: "1" }).has("a")); say("get of a FormData", () => { const f = new FormData(); f.set("a", "1"); return f.get("a"); });
say("get that throws in a key's hash", () => m.get({ toString() { throw new Error("no"); } }));
say("get none", () => any(m).get()); say("has two", () => any(m).has("a", 1)); say("set one", () => any(m).set("only") === m); say("get undefined key", () => m.get(undefined) + ":" + m.has(undefined));
say("get of null", () => any(null).get(1)); say("has of undefined", () => any(undefined).has(1)); say("push of a number", () => any(5).push(1));
const patched = new Map([["a", 1]]); any(patched).get = function (key: string) { return "patched " + key; }; say("get of a map with its own get", () => patched.get("a"));
const original = Map.prototype.has; say("has after the prototype is changed", () => { Map.prototype.has = function (key) { return !original.call(this, key); }; try { return m.has("a") + ":" + m.has("never"); } finally { Map.prototype.has = original; } }); say("has after it is put back", () => m.has("a"));

{
  const built = (t: string) => t.split("").join(""); const sym = Symbol("s"); const obj = { o: 1 }; const fn = () => 1;
  const keys: unknown[] = ["", "a", "key", "a longer key, of forty-odd characters, to compare", "\u4e16\u754c", "caf\u00e9", 0, 1, -1, 2 ** 31 - 1, -(2 ** 31), 2 ** 31, 2 ** 53, 1.5, -0, NaN, Infinity, 10n, 2n ** 70n, true, false, null, undefined, sym, Symbol.iterator, obj, fn, [], 0.1 + 0.2];
  const same: unknown[] = [built(""), built("a"), built("key"), built("a longer key, of forty-odd characters, to compare"), built("\u4e16\u754c"), built("caf\u00e9"), -0, 3 - 2, -2 + 1, 2147483646 + 1, -2147483647 - 1, 2147483647 + 1, 2 ** 52 * 2, 3 / 2, 0, 0 / 0, 1 / 0, BigInt(10), BigInt(2) ** BigInt(70), !0, !1, null, void 0, sym, Symbol.iterator, obj, fn, [], 0.30000000000000004];
  const near: unknown[] = ["b", "kez", "a longer key, of forty-odd characters, to comparf", "\u4e16", "cafe", 2, 1.0000001, "1", "0", "null", "true", 11n, Symbol("s"), { o: 1 }, () => 1];
  const map = new Map<unknown, unknown>(); const set = new Set<unknown>();
  keys.forEach((key, i) => { map.set(key, i); set.add(key); });
  say("keys: sizes", () => map.size + ":" + set.size);
  say("keys: get by the same", () => keys.map(key => map.get(key)).join());
  say("keys: get by an equal", () => same.map(key => map.get(key)).join());
  say("keys: has by an equal", () => same.map(key => +map.has(key) + "" + +set.has(key)).join());
  say("keys: near misses", () => near.map(key => String(map.get(key)) + +map.has(key) + +set.has(key)).join());
  say("keys: set by an equal", () => { same.forEach((key, i) => map.set(key, "v" + i)); return map.size + ":" + keys.map(key => map.get(key)).join(); });
  say("keys: set by an equal, wanted", () => same.map((key, i) => map.set(key, i) === map).join());
  say("keys: add by an equal", () => { same.forEach(key => set.add(key)); return set.size + ":" + same.map(key => set.add(key) === set).join(); });
  say("keys: order is as it was", () => [...map.keys()].map(key => typeof key === "symbol" ? "sym" : typeof key === "bigint" ? key + "n" : Object.is(key, -0) ? "-0" : typeof key === "function" ? "fn" : String(key).slice(0, 8)).join("|"));
  say("keys: delete and look", () => { for (const key of same.slice(0, 12)) { map.delete(key); set.delete(key); } return map.size + ":" + keys.map(key => String(map.get(key)) + +set.has(key)).join(); });
  say("keys: put back", () => { same.slice(0, 12).forEach((key, i) => { map.set(key, -i); set.add(key); }); return map.size + ":" + set.size + ":" + keys.map(key => map.get(key)).join(); });
  say("keys: clear and look", () => { map.clear(); set.clear(); return keys.map(key => String(map.get(key)) + +map.has(key) + +set.has(key)).join("") + map.size; });
  say("keys: after clear", () => { map.set("a", 1); set.add("a"); return map.get(built("a")) + ":" + set.has(built("a")) + ":" + map.size; });
  const fresh = new Map(); const freshSet = new Set();
  say("keys: of nothing", () => [fresh.get("a"), fresh.has("a"), freshSet.has("a"), fresh.size].join());
  const grown = new Map<unknown, unknown>(); const grownSet = new Set<unknown>();
  say("keys: many", () => { for (let i = 0; i < 5000; i++) { grown.set("s" + i, i); grown.set(i, "n" + i); grownSet.add("s" + i); grownSet.add(i * 2); } let ok = 0; for (let i = 0; i < 5000; i++) ok += +(grown.get("s" + i) === i) + +(grown.get(i) === "n" + i) + +grownSet.has("s" + i) + +grownSet.has(i * 2) + +!grownSet.has(i * 2 + 1) + +!grown.has("t" + i); return ok + ":" + grown.size + ":" + grownSet.size; });
  say("keys: many deleted", () => { for (let i = 0; i < 5000; i += 3) { grown.delete("s" + i); grownSet.delete(i * 2); } let ok = 0; for (let i = 0; i < 5000; i++) ok += +(grown.get("s" + i) === (i % 3 ? i : undefined)) + +(grownSet.has(i * 2) === !!(i % 3)); return ok + ":" + grown.size + ":" + grownSet.size; });
  const aged = new Map<string, unknown>(); for (let i = 0; i < 100; i++) aged.set("k" + i, i); Bun.gc(true); Bun.gc(true);
  say("keys: young values in an old map", () => { for (let r = 0; r < 3; r++) { for (let i = 0; i < 100; i++) aged.set("k" + i, { r, i }); Bun.gc(true); } return JSON.stringify(aged.get("k99")) + aged.size; });
  say("keys: a rope", () => { const left = "a longer key, of forty-odd "; const right = "characters, to compare"; const m2 = new Map([[left + right, 1]]); return m2.get(left + right) + ":" + m2.has(left + right.slice(0, 5) + right.slice(5)); });
  const wideMap = new Map<string, number>(); for (let i = 0; i < 200; i++) wideMap.set("\u4e16" + i, i);
  say("keys: two-byte strings", () => { let ok = 0; for (let i = 0; i < 200; i++) ok += +(wideMap.get("\u4e16" + i) === i) + +!wideMap.has("\u754c" + i); return ok; });
  say("keys: a string as one byte and as two", () => { const m2 = new Map([["abc", 1]]); const wide = ("\u4e16abc").slice(1); return m2.get(wide) + ":" + m2.has(wide) + ":" + new Set([wide]).has("abc"); });
}

function thrower(map: any) { return map.get(1); }
say("stack of a get of nothing", () => { try { thrower(undefined); } catch (e: any) { return String(e.stack).split("\n").slice(0, 3).map(l => l.trim().replace(/\(.*[\\/]/, "(")).join(" < "); } });

const codeAt = (t: string, i: number) => t.charCodeAt(i); const pointAt = (t: string, i: number) => t.codePointAt(i); const at = (t: string, i: number) => t.charAt(i);
const pushed = (a: unknown[], v: unknown) => a.push(v); const popped = (a: unknown[]) => a.pop(); const isList = (v: unknown) => Array.isArray(v);
const got = (c: Map<unknown, unknown>, key: unknown) => c.get(key); const had = (c: { has(key: unknown): boolean }, key: unknown) => c.has(key); const put = (c: Map<unknown, unknown>, key: unknown, v: unknown) => c.set(key, v); const added = (c: Set<unknown>, key: unknown) => c.add(key);
say("last: maps and sets", () => { const c = new Map<unknown, unknown>([["a", 1]]); const t = new Set<unknown>([1]); return [got(c, "a"), got(c, "b"), had(c, "a"), had(t, 1), had(t, 2), had(store as any, "a"), put(c, "a", 2) === c, put(c, "z", 3) === c, got(c, "z"), added(t, 1) === t, added(t, 9) === t, had(t, 9), c.size, t.size].join(); });
say("last: strings", () => [codeAt(ascii, 1), codeAt(wide, 7), codeAt(ascii, 99), pointAt(wide, 9), pointAt(wide, 10), at(ascii, 4), at(wide, 6), at(ascii, -1), codeAt(rope, 2), any(codeAt)(5, 0)].join());
say("last: arrays", () => { const a: unknown[] = [1]; return [pushed(a, 2), pushed(a, "s"), popped(a), popped(a), popped(a), popped(a), isList(a), isList(0), pushed(Object.freeze([]) as any, 1)].join(); });
const chain = { charAt(n: number): string { if (!n) return "bottom"; return this.charAt(n - 1); }, push(n: number): number { return n ? this.pop(n - 1) : 0; }, pop(n: number): number { return n ? this.push(n - 1) : 1; }, isArray(n: number, acc: number): number { return n ? chain.isArray(n - 1, acc + n) : acc; }, codePointAt(n: number): unknown { return n ? this.codePointAt(n - 1) : "abc".codePointAt(1); } };
say("last: a method of that name that calls itself", () => chain.charAt(300000));
say("last: two that call each other", () => chain.push(300001));
say("last: with two arguments", () => any(chain).isArray(300000, 0));
say("last: that ends in the real one", () => chain.codePointAt(300000));

function lex(src: string) { let n = 0, sum = 0; const seen = new Map<number, number>(); const parts: string[] = []; for (let i = 0; i < src.length; i++) { const c = src.charCodeAt(i); sum += c + (src.codePointAt(i) ?? 0); if (c === 32) n++; seen.set(c, (seen.get(c) ?? 0) + 1); if (!seen.has(c + 1)) parts.push(src.charAt(i)); } return [n, sum, seen.size, parts.length, parts.pop()].join(); }
say("lex ascii", () => lex(ascii.repeat(50))); say("lex wide", () => lex(wide.repeat(50))); say("lex rope", () => lex(rope));
function drain(list: unknown[]) { let n = 0; const back: unknown[] = []; while (list.length) { const v = list.pop(); if (Array.isArray(v)) n += v.length; else back.push(v); } return n + ":" + back.length; }
say("drain", () => drain([[1, 2], "a", [3], {}, [[4]], 5]));

for (const line of out) console.log(line);

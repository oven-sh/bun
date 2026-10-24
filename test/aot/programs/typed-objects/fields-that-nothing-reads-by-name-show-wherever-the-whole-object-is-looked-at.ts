// Fields that no code reads by name show wherever the whole object is looked at: console.log, JSON.stringify, Object.keys and its kin, `in`, hasOwn, for-in, spread, rest, Object.assign, structuredClone, Bun.inspect, deep equality, a computed key.
class P { a: number; hidden: string; other = 3; constructor(a: number) { this.a = a; this.hidden = "h" + a; } }
const p = new P(1);
console.log(p.a);
console.log(p);
console.log(JSON.stringify(p), Object.keys(p).join(), Object.entries(p).length, "hidden" in p, Object.hasOwn(p, "hidden"), p.hasOwnProperty("other"));
class Q { a = 1; secret = { deep: [1, 2] }; }
const q = new Q(); console.log(q.a, Bun.inspect(q), structuredClone(q), { ...q }, Object.assign({}, q));
class R { a = 1; z = 2; }
const r = new R(); let n = 0; for (const k in r) n++; console.log(r.a, n, Reflect.ownKeys(r), Object.getOwnPropertyNames(r), Object.getOwnPropertyDescriptors(r));
class S { a = 1; w = 5; }
const s: any = new S(); const key = ["w", "a"][Date.now() > 0 ? 0 : 1]; console.log(s.a, s[key]);
class T { a = 1; v = 6; }
const { a, ...rest } = new T(); console.log(a, rest);
class U { a = 1; u = 7; }
console.log(Bun.deepEquals(new U(), { a: 1 }), Bun.deepEquals(new U(), { a: 1, u: 7 }), require("util").isDeepStrictEqual({ ...new U() }, { a: 1, u: 7 }));
const lit = { used: 1, unused: 2 }; console.log(lit.used, Object.values(lit));

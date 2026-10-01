// Something is looked up through objects of many shapes, so that it is the cache all sites share that answers. Then an object on the
// prototype chain changes, and the very next lookup has to know.
const out: string[] = [];
const say = (name: string, f: () => unknown) => {
  let text: string;
  try { text = String(f()); } catch (e: any) { text = "threw " + e?.name + ": " + e?.message; }
  out.push(name + " = " + text);
};
const SHAPES = 40;
// (The prototypes that the language comes with may be frozen.)
const attempt = (f: () => void) => { try { f(); } catch (e: any) { out.push("could not: " + e?.name); } };
// Objects of that many shapes, all with `proto` for a prototype.
function family(proto: object | null, own: Record<string, unknown> = {}) {
  const all: any[] = [];
  for (let i = 0; i < SHAPES; i++) { const o = Object.create(proto); o["s" + i] = i; Object.assign(o, own); all.push(o); }
  return all;
}
// One site each, that sees them all.
function readX(o: any) { return o.x; }
function readY(o: any) { return o.y; }
function hasX(o: any) { return "x" in o; }
function writeX(o: any, v: any) { o.x = v; }
function callM(o: any) { return o.m(); }
function readKey(o: any, k: string) { return o[k]; }
const sum = (all: any[], f: (o: any) => any) => { const seen = new Map<string, number>(); for (let r = 0; r < 3; r++) for (const o of all) { const v = String(f(o)); if (r === 2) seen.set(v, (seen.get(v) ?? 0) + 1); } return [...seen].map(([v, n]) => v + "*" + n).join(","); };

function scenario(name: string, depth: number, at: number) {
  // A chain that deep, and the change is to the object that far up it.
  const chain: any[] = [];
  let p: any = null;
  for (let i = 0; i < depth; i++) { p = Object.create(p); p["level" + i] = i; chain.unshift(p); }
  const all = family(chain[0]);
  const target = chain[at];
  const label = `${name} depth ${depth} at ${at}`;
  say(label + ": absent", () => sum(all, readX) + " " + sum(all, hasX));
  target.x = "added";
  say(label + ": added", () => sum(all, readX) + " " + sum(all, hasX));
  target.x = "changed";
  say(label + ": changed", () => sum(all, readX));
  if (at > 0) { chain[0].x = "shadow"; say(label + ": shadowed", () => sum(all, readX)); delete chain[0].x; say(label + ": no longer shadowed", () => sum(all, readX)); }
  Object.defineProperty(target, "x", { get() { return "got"; }, configurable: true });
  say(label + ": getter", () => sum(all, readX) + " " + sum(all, hasX));
  Object.defineProperty(target, "x", { value: "value again", configurable: true, writable: true });
  say(label + ": value again", () => sum(all, readX));
  delete target.x;
  say(label + ": deleted", () => sum(all, readX) + " " + sum(all, hasX));
  const other = { x: "from another" };
  const before = Object.getPrototypeOf(target);
  Object.setPrototypeOf(other, before);
  Object.setPrototypeOf(target, other);
  say(label + ": another prototype", () => sum(all, readX) + " " + sum(all, hasX));
  Object.setPrototypeOf(target, before);
  say(label + ": the old prototype", () => sum(all, readX) + " " + sum(all, hasX));
}
for (const depth of [1, 2, 3, 5]) for (let at = 0; at < depth; at++) scenario("chain", depth, at);

// ---- Object.prototype, Array.prototype, Function.prototype
{
  const all = family(Object.prototype);
  say("Object.prototype: absent", () => sum(all, readX) + " " + sum(all, hasX));
  attempt(() => { (Object.prototype as any).x = "on Object.prototype"; });
  say("Object.prototype: added", () => sum(all, readX) + " " + sum(all, hasX) + " " + readX([]) + " " + readX(() => 0) + " " + readX(5) + " " + readX("s"));
  attempt(() => { delete (Object.prototype as any).x; });
  say("Object.prototype: deleted", () => sum(all, readX) + " " + sum(all, hasX) + " " + readX([]));
  const arrays = Array.from({ length: SHAPES }, (_, i) => Object.assign([i], { ["a" + i]: 1 }));
  say("arrays: absent", () => sum(arrays, readX));
  attempt(() => { (Array.prototype as any).x = "on Array.prototype"; });
  say("arrays: added", () => sum(arrays, readX) + " " + sum(all, readX));
  attempt(() => { delete (Array.prototype as any).x; });
  say("arrays: deleted", () => sum(arrays, readX));
  const functions = Array.from({ length: SHAPES }, (_, i) => Object.assign(() => i, { ["f" + i]: 1 }));
  say("functions: absent", () => sum(functions, readX));
  attempt(() => { (Function.prototype as any).x = "on Function.prototype"; });
  say("functions: added", () => sum(functions, readX));
  attempt(() => { delete (Function.prototype as any).x; });
  say("functions: deleted", () => sum(functions, readX));
}

// ---- two prototypes with the same structure: the one on the lookup path makes a transition that the other has already made
{
  const make = () => { const p: any = Object.create(null); p.a = 1; p.b = 2; return p; };
  const first = make(), second = make();
  Object.create(first); Object.create(second);
  second.x = "the other's"; // The transition exists now.
  const all = family(first);
  say("twins: absent", () => sum(all, readX) + " " + sum(all, hasX));
  first.x = "its own";
  say("twins: added", () => sum(all, readX) + " " + sum(all, hasX));
  const third = make(); Object.create(third);
  const more = family(third);
  say("twins, again: absent", () => sum(more, readX));
  third.x = "third";
  say("twins, again: added", () => sum(more, readX));
}

// ---- classes
{
  class A { m() { return "A.m"; } }
  class B extends A {}
  class C extends B {}
  const all = Array.from({ length: SHAPES }, (_, i) => Object.assign(new C(), { ["c" + i]: i }));
  say("classes: inherited", () => sum(all, callM) + " " + sum(all, readX));
  (B.prototype as any).m = function () { return "B.m"; };
  say("classes: overridden in the middle", () => sum(all, callM));
  (C.prototype as any).m = function () { return "C.m"; };
  say("classes: overridden below", () => sum(all, callM));
  delete (C.prototype as any).m; delete (B.prototype as any).m;
  say("classes: as they were", () => sum(all, callM));
  (A.prototype as any).m = function () { return "A.m, replaced"; };
  say("classes: replaced at the top", () => sum(all, callM));
  Object.setPrototypeOf(B.prototype, { m() { return "grafted"; } });
  say("classes: grafted", () => sum(all, callM));
  // A class that is defined afterwards, whose prototype no lookup has gone through, must not invalidate anything.
  class D { x = 0; later() { return 1; } }
  (D.prototype as any).x2 = 1;
  say("classes: after another was defined", () => sum(all, callM) + " " + sum(all, readX) + new D().later());
}

// ---- stores: setters and read-only properties on the prototype chain
{
  const proto: any = {};
  const fresh = () => family(proto);
  const store = (all: any[]) => { for (const o of all) writeX(o, 1); return all.filter(o => Object.hasOwn(o, "x")).length + " own"; };
  say("stores: plain", () => store(fresh()) + ", " + store(fresh()) + ", " + store(fresh()));
  let calls = 0;
  Object.defineProperty(proto, "x", { set(v) { calls++; }, get() { return "g"; }, configurable: true });
  say("stores: a setter", () => store(fresh()) + ", called " + calls);
  Object.defineProperty(proto, "x", { value: "fixed", writable: false, configurable: true });
  say("stores: read only", () => store(fresh()));
  delete proto.x;
  say("stores: plain again", () => store(fresh()));
  const grand: any = {}; Object.setPrototypeOf(proto, grand);
  say("stores: a longer chain", () => store(fresh()));
  Object.defineProperty(grand, "x", { set(v) { calls += 100; }, configurable: true });
  say("stores: a setter further up", () => store(fresh()) + ", called " + calls);
  delete grand.x;
  Object.freeze(grand);
  say("stores: frozen further up", () => store(fresh()));
}

// ---- prototypes that are dictionaries, are frozen, or become prototypes late
{
  const big: any = {};
  for (let i = 0; i < 200; i++) big["k" + i] = i;
  for (let i = 0; i < 150; i++) delete big["k" + i];
  const all = family(big);
  say("dictionary: absent", () => sum(all, readX) + " " + sum(all, o => o.k199));
  big.x = "in a dictionary";
  say("dictionary: added", () => sum(all, readX));
  delete big.k199;
  say("dictionary: deleted", () => sum(all, o => o.k199));
  big.k199 = "back";
  say("dictionary: back", () => sum(all, o => o.k199));
  const late: any = { a: 1 };
  const bases = family(null);
  say("late: absent", () => sum(bases, readX));
  for (const o of bases) Object.setPrototypeOf(o, late);
  say("late: has a prototype", () => sum(bases, readX) + " " + sum(bases, o => o.a));
  late.x = "late";
  say("late: added", () => sum(bases, readX));
  const sealed: any = Object.seal({ x: "sealed" });
  const under = family(sealed);
  say("sealed", () => sum(under, readX));
  sealed.x = "sealed, changed";
  say("sealed: changed", () => sum(under, readX));
  Object.freeze(sealed);
  say("frozen", () => { try { sealed.x = "no"; } catch {} return sum(under, readX); });
}

// ---- by a name that is computed, and symbols
{
  const proto: any = {};
  const all = family(proto);
  const s = Symbol("s");
  say("computed: absent", () => sum(all, o => readKey(o, "x")) + " " + sum(all, o => o[s]));
  proto.x = "computed"; proto[s] = "symbol";
  say("computed: added", () => sum(all, o => readKey(o, "x")) + " " + sum(all, o => o[s]));
  delete proto.x; delete proto[s];
  say("computed: deleted", () => sum(all, o => readKey(o, "x")) + " " + sum(all, o => o[s]));
}

// ---- proxies and the like on the chain
{
  let answer: any = undefined;
  const proxy = new Proxy({}, { get: (_, k) => (k === "x" ? answer : undefined), has: (_, k) => k === "x" && answer !== undefined });
  const all = family(proxy);
  say("proxy: absent", () => sum(all, readX) + " " + sum(all, hasX));
  answer = "from the proxy";
  say("proxy: present", () => sum(all, readX) + " " + sum(all, hasX));
}

// ---- over and over, with collections in between
{
  const proto: any = {};
  const all = family(proto);
  const log: string[] = [];
  for (let round = 0; round < 12; round++) {
    if (round % 3 === 0) { delete proto.x; proto.x = "r" + round; } else if (round % 3 === 1) delete proto.x; else Object.defineProperty(proto, "x", { get: () => "g" + round, configurable: true });
    if (round % 4 === 0) Bun.gc(true);
    log.push(sum(all, readX) + "/" + sum(all, hasX) + "/" + sum(all, readY));
  }
  say("rounds", () => log.join(" "));
}
console.log(out.join("\n"));

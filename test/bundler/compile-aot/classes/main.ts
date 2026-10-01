// A constructor with many subclasses creates objects that start with different structures. The result has to be the same as storing
// the properties one at a time, whatever has happened to the prototypes in the meantime.
const out: string[] = [];
const say = (name: string, f: () => unknown) => {
  let text: string;
  try { text = String(f()); } catch (e: any) { text = "threw " + e?.name + ": " + e?.message; }
  out.push(name + " = " + text);
};
const attempt = (f: () => void) => { try { f(); } catch (e: any) { out.push("could not: " + e?.name); } };
class Base { declare a: any; declare b: any; declare c: any; constructor(a: any, b: any) { this.a = a; this.b = b; this.c = a + b; } who() { return "Base"; } }
class Other { declare b: any; declare a: any; constructor(a: any, b: any) { this.b = b; this.a = a; } }
function OldBase(this: any, a: any, b: any) { this.p = a; this.q = b; }
const describe = (o: any) => JSON.stringify(Object.entries(o)) + Object.getPrototypeOf(o)?.constructor?.name + Object.keys(Object.getOwnPropertyDescriptors(o)).length;
const tally = (all: any[]) => { const seen = new Map<string, number>(); for (const s of all) seen.set(s, (seen.get(s) ?? 0) + 1); return [...seen].map(([s, n]) => s + "*" + n).join(" "); };
// So many classes that extend it, made one at a time so that each is its own.
const extend = (base: any, n: number, body = (B: any) => class extends B {}) => Array.from({ length: n }, () => body(base));
const construct = (classes: any[], rounds = 3) => { let last: string[] = []; for (let r = 0; r < rounds; r++) last = classes.map((C, i) => { const o = new C(i % 3, "s"); return JSON.stringify(Object.entries(o)) + (Object.getPrototypeOf(o) === C.prototype) + (o instanceof Base); }); return tally(last); };

for (const n of [1, 2, 3, 8, 40, 300, 700]) say(n + " classes", () => construct(extend(Base, n)));
say("with constructors", () => construct(extend(Base, 20, B => class extends B { constructor(a: any, b: any) { super(a, b); } })));
say("that store more", () => construct(extend(Base, 20, B => class extends B { d: any; constructor(a: any, b: any) { super(a, b); this.d = a; } })));
say("with fields", () => construct(extend(Base, 20, B => class extends B { f = 1; g = "g"; })));
say("with a field of the same name", () => construct(extend(Base, 20, B => class extends B { a = "field"; })));
say("two deep", () => construct(extend(Base, 6).flatMap(C => extend(C, 6))));
say("with methods", () => construct(extend(Base, 20, B => class extends B { who() { return "sub"; } get x() { return 1; } static s() {} })));
say("Base itself among them", () => construct([Base, ...extend(Base, 5), Base, ...extend(Base, 5)]));

// ---- setters and read-only properties on the prototypes
const explicit = (B: any) => class extends B { constructor(a: any, b: any) { super(a, b); } };
for (const [kind, classes] of [["implicit", extend(Base, 30)], ["explicit", extend(Base, 30, explicit)], ["explicit, two deep", extend(Base, 5, explicit).flatMap(C => extend(C, 6, explicit))]] as [string, any[]][]) {
  out.push("-- " + kind);
  say("warm", () => construct(classes));
  const log: string[] = [];
  Object.defineProperty(classes[3].prototype, "b", { set(v) { log.push("3:" + v); }, get() { return "got"; }, configurable: true });
  say("a setter on one", () => construct(classes) + " " + log.length + " " + describe(new classes[3](1, 2)));
  delete classes[3].prototype.b;
  say("gone again", () => construct(classes));
  Object.defineProperty(Base.prototype, "c", { set(v) { log.push("c"); }, configurable: true });
  say("a setter on Base.prototype", () => { log.length = 0; return construct(classes) + " " + log.length + " " + describe(new Base(1, 2)); });
  delete (Base.prototype as any).c;
  say("gone again, too", () => construct(classes) + " " + describe(new Base(1, 2)));
  Object.defineProperty(classes[7].prototype, "a", { value: "fixed", writable: false, configurable: true });
  say("read only on one", () => { try { return describe(new classes[7](1, 2)); } catch (e: any) { return e.name; } });
  say("the others", () => construct(classes.filter((_, i) => i !== 7)));
  delete classes[7].prototype.a;
  attempt(() => Object.defineProperty(Object.prototype, "a", { set(v) { log.push("O"); }, configurable: true }));
  say("a setter on Object.prototype", () => { log.length = 0; return construct(classes) + " " + log.length; });
  attempt(() => { delete (Object.prototype as any).a; });
  say("as they were", () => construct(classes));
  const graft = { set b(v: any) { log.push("graft"); } };
  Object.setPrototypeOf(graft, Base.prototype);
  Object.setPrototypeOf(classes[9].prototype, graft);
  say("a prototype in between", () => { log.length = 0; return construct(classes) + " " + log.length + " " + (new classes[9](1, 2) instanceof Base); });
  Object.setPrototypeOf(classes[9].prototype, Base.prototype);
  say("taken out again", () => construct(classes));
  Object.freeze(classes[11].prototype);
  say("a frozen prototype", () => construct(classes));
  classes[12].prototype.extra = 1;
  say("a property of another name", () => construct(classes));
}

// ---- a constructor that does nothing but store what it was given, so that nothing else has had a look at the prototypes
{
  class Plain { declare a: any; declare b: any; constructor(a: any, b: any) { this.a = a; this.b = b; } }
  const classes: any[] = extend(Plain, 30, explicit);
  const own = (rounds: number) => { let last: string[] = []; for (let r = 0; r < rounds; r++) last = classes.map((C, i) => Object.keys(new C(i % 3, "s")).join("")); return tally(last); };
  say("plain: warm", () => own(200));
  let calls = 0;
  Object.defineProperty(classes[3].prototype, "b", { set(v) { calls++; }, configurable: true });
  say("plain: a setter on one", () => own(5) + " " + calls);
  delete classes[3].prototype.b;
  say("plain: gone again", () => own(200) + " " + calls);
  Object.defineProperty(Plain.prototype, "a", { set(v) { calls += 1000; }, configurable: true });
  say("plain: a setter on the base's", () => own(2) + " " + calls);
  delete (Plain.prototype as any).a;
  say("plain: gone again, too", () => own(200) + " " + calls);
  Object.defineProperty(classes[5].prototype, "a", { value: 1, writable: false, configurable: true });
  say("plain: read only on one", () => { try { return own(2); } catch (e: any) { return e.name; } });
  delete classes[5].prototype.a;
  say("plain: as they were", () => own(200));
  const graft = { set b(v: any) { calls += 1_000_000; } };
  Object.setPrototypeOf(graft, Plain.prototype);
  Object.setPrototypeOf(classes[9].prototype, graft);
  say("plain: a prototype in between", () => own(2) + " " + calls);
}

// ---- functions, whose prototype can be another object
{
  const subs = Array.from({ length: 20 }, () => { function Sub(this: any, a: any, b: any) { return Reflect.construct(OldBase, [a, b], new.target); } Object.setPrototypeOf(Sub.prototype, OldBase.prototype); return Sub as any; });
  const run = () => tally(subs.map((S, i) => { let o: any; for (let r = 0; r < 3; r++) o = new S(i % 2, "z"); return JSON.stringify(Object.entries(o)) + (Object.getPrototypeOf(o) === S.prototype); }));
  say("functions", run);
  const replaced = { marker: true };
  subs[4].prototype = replaced;
  say("another prototype", () => run() + " " + (Object.getPrototypeOf(new subs[4](1, 2)) === replaced));
  subs[5].prototype = 5;
  say("a prototype that is no object", () => run() + " " + (Object.getPrototypeOf(new subs[5](1, 2)) === Object.prototype));
  subs[6].prototype = { set p(v: any) { out.push("setter p " + v); } };
  say("a prototype with a setter", () => run() + " " + describe(new subs[6](1, 2)));
}

// ---- constructed with something else
{
  class NT {}
  say("Reflect.construct", () => { let r = ""; for (let i = 0; i < 4; i++) r = describe(Reflect.construct(Base, [1, 2], NT)) + " / " + describe(Reflect.construct(Other, [1, 2], NT)) + " / " + describe(Reflect.construct(OldBase, [1, 2], NT)); return r; });
  const targets = extend(Object, 12);
  say("two constructors, the same targets", () => { let r: string[] = []; for (let round = 0; round < 4; round++) r = targets.flatMap(T => [describe(Reflect.construct(Base, [1, 2], T)), describe(Reflect.construct(Other, [1, 2], T))]); return tally(r); });
  say("a bound function", () => describe(Reflect.construct(Base, [1, 2], NT.bind(null))) + describe(new (Base.bind(null, 7))(8)));
  say("a proxy", () => describe(Reflect.construct(Base, [1, 2], new Proxy(NT, {}))) + describe(new (new Proxy(Base, {}))(1, 2)));
  let asked = 0;
  say("a proxy that is asked", () => describe(Reflect.construct(Base, [1, 2], new Proxy(NT, { get(t, k, r) { if (k === "prototype") asked++; return Reflect.get(t, k, r); } }))) + asked);
  say("a native function", () => describe(Reflect.construct(Base, [1, 2], Array)) + describe(Reflect.construct(Base, [1, 2], Map)) + describe(Reflect.construct(Base, [1, 2], Object)));
  say("an arrow", () => Reflect.construct(Base, [1, 2], (() => 0) as any));
}

// ---- classes come and go
{
  const log: string[] = [];
  for (let round = 0; round < 12; round++) {
    log.push(construct(extend(Base, 50, round % 2 ? (B => class extends B { k = round; }) : undefined), 2).length + "");
    if (round % 3 === 0) Bun.gc(true);
  }
  say("rounds", () => log.join());
}
say("hot", () => { const classes = extend(Base, 10); let n = 0; for (let i = 0; i < 300_000; i++) n += new classes[i % 10](i, 1).c; return n; });
console.log(out.join("\n"));

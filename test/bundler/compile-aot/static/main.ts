import * as L from "./lib";
const out: unknown[] = [];
const p = (...a: unknown[]) => console.log(...a);
p("empty", JSON.stringify(L.EMPTY), L.EMPTY.length, L.EMPTY === "", "" + [""].length, ({ "": 5 } as any)[L.EMPTY]);
p("one", L.one, L.one + L.one, ({ x: 7 } as any)[L.one], L.wide, L.wide.length, L.wideLong.length, L.wideLong.slice(6, 7));
const d = new L.Derived(); p("derived", d.a, d.p, d.m(4), d instanceof L.Base, L.Derived.name, L.Derived.s);
const w = new L.WithFields() as any; p("fields", w.b, w.computed1, w.a, (L.WithFields as any).blk, Object.keys(w).join());
p("gen", [...L.gen(4)].join());
p("asy", await L.asy(41));
{ const r: string[] = []; for await (const x of L.agen()) r.push(x); p("agen", r.join()); }
p("arrow", L.arrow(2)(3));
p("tag", L.tag`a${1}\n${"z"}c`, L.sameTemplate() === L.sameTemplate());
try { L.thrower(); } catch (e) { p("stack", (e as Error).stack!.split("\n").slice(0, 2).map(s => s.replace(/\(.*[\\/]/, "(")).join(" | ")); }
p("arguments", (L.usesArguments as any)(1, 2, 3));
p("tdz", L.tdz());
p("big", L.big * 2n, typeof L.big);
p("zero", L.zero, L.zeros().join(), L.zero === 0n, !L.zero);
p("oldstyle", new (L.OldStyle as any)(5).get(), (L.both as any)(4), new (L.both as any)(4).v);
p("setup", JSON.stringify(L.table), Object.keys(L.table).join(), JSON.stringify(L.config), Object.isFrozen(L.frozen), L.child.hello(), Object.keys(L.many).length, L.many.k57, JSON.stringify(L.inLoop), L.withAccessor.g, Object.keys(L.withAccessor).join(), JSON.stringify(L.spread));
{ let t = 0; for (let i = 0; i < 1000; i++) t += L.config.x + L.table.a + (L.config as any).missing === undefined ? 1 : 0; const ks: string[] = []; for (const k in L.config) ks.push(k); p("setup2", t, ks.join(), "y" in L.config, L.table.hasOwnProperty("b")); }
p("re", "xabbbc ABC".replace(L.re, "[$1]"), L.re.flags, L.re.source, "2026-09".match(L.reNamed)!.groups!.year);
p("re2", /a(b+)c/gi.test("abc"), /^$/.test(""), "a,b".split(/,/).join("+"));
p("arrays", JSON.stringify(L.literalArrays()), L.literalArrays()[0] !== L.literalArrays()[0]);
{ const a = L.literalArrays()[0] as number[]; a.push(9); p("cow", a.join(), (L.literalArrays()[0] as number[]).join()); }
p("emptykey", JSON.stringify(L.objWithEmptyKey()));
p("toString", L.arrow.toString(), "|", L.Derived.toString(), "|", L.Base.prototype.m.toString(), "|", L.gen.toString().slice(0, 20));
p("classToString", L.WithFields.toString().replace(/\s+/g, " "));
p("names", L.thrower.name, L.arrow.name, (() => {}).name === "", (function () {}).name === "", L.Base.prototype.m.name, L.thrower.length, L.Base.prototype.m.length);
p("eval", (0, eval)("1+1"), new Function("a", "b", "return a*b")(6, 7));
p("symbols", typeof Symbol.iterator, [][Symbol.iterator].name, Symbol.for("x").description, Object.prototype.toString.call(L.gen(1)));
p("dyn", (await import("./dyn")).default("q"));
for (let i = 0; i < 3; i++) { Bun.gc(true); }
p("aftergc2", new (L.OldStyle as any)(6).get(), new (L.both as any)(7).v);
p("aftergc", L.wideLong.length, new L.WithFields().b, "xabc".replace(L.re, "$1"), L.tag`q${2}`, [...L.gen(2)].join(), L.literalArrays()[2].join("/"));
const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
p("worker", await new Promise(r => { worker.onmessage = e => r(e.data); worker.postMessage("ping"); }));
worker.terminate();

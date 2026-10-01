// What errors say, and what functions print as: everything here that depends on the text of the program.
const cases: Record<string, () => unknown> = {
  readOfUndefined: () => { const a: any = { b: undefined }; return a.b.c; },
  readOfNull: () => { const a: any = null; return a.name; },
  deepRead: () => { const config: any = { server: {} }; return config.server.options.port; },
  elementOfUndefined: () => { const list: any = undefined; return list[3]; },
  callOfUndefined: () => { const o: any = {}; return o.method(); },
  callOfNumber: () => { const o: any = { n: 5 }; return o.n(1, 2); },
  callOfVariable: () => { const notAFunction: any = "text"; return notAFunction(); },
  callOfResult: () => { const f: any = () => 1; return f()(); },
  newOfNonConstructor: () => { const o: any = { C: () => 1 }; return new o.C(); },
  newOfUndefined: () => { const o: any = {}; return new o.Missing(); },
  storeToUndefined: () => { const a: any = {}; a.b.c = 1; },
  storeToNull: () => { const a: any = null; a.x = 1; },
  inOfPrimitive: () => { const s: any = "str"; return "x" in s; },
  instanceofNonCallable: () => { const o: any = {}; return {} instanceof o; },
  destructureUndefined: () => { const u: any = undefined; const { x } = u; return x; },
  destructureNull: () => { const u: any = null; const [x] = u; return x; },
  spreadNonIterable: () => { const n: any = 5; return [...n]; },
  forOfNonIterable: () => { const n: any = {}; for (const x of n) return x; },
  undefinedVariable: () => (globalThis as any).eval ? (0, eval)("missingVariable") : 0,
  tdz: () => { const f = () => later; const r = f(); let later = 1; return r; },
  superBeforeThis: () => { class A {} class B extends A { constructor() { (this as any).x = 1; super(); } } return new B(); },
  classWithoutNew: () => { class K {} return (K as any)(); },
  symbolToString: () => `${Symbol("s") as any}`,
  bigintMix: () => (1n as any) + 1,
  privateMissing: () => { class P { #x = 1; static read(o: any) { return o.#x; } } return P.read({}); },
  optionalCallOfNonFunction: () => { const o: any = { f: 1 }; return o.f?.(); },
  templateCall: () => { const t: any = undefined; return t`x`; },
  getterThrows: () => { const o = { get g(): never { throw new RangeError("from a getter"); } }; return o.g; },
  awaitThenable: () => { const o: any = undefined; return o.then; },
};
for (const [name, f] of Object.entries(cases)) {
  try { f(); console.log(name.padEnd(26), "no error"); }
  catch (e: any) { console.log(name.padEnd(26), `${e?.constructor?.name}: ${e?.message}`); }
}
function declared(a: number, b = 2, ...rest: number[]) { return a + b + rest.length; }
class Klass { field = 1; static s = 2; method(x: number) { return x; } get g() { return 1; } }
const arrow = (x: number) => x * 2; async function asyncFn() { await 1; } function* gen() { yield 1; }
for (const f of [declared, Klass, arrow, asyncFn, gen, Klass.prototype.method, Object.getOwnPropertyDescriptor(Klass.prototype, "g")!.get!, Math.floor, function () {}, class {}, declared.bind(null)])
  console.log("toString:", JSON.stringify(String(f).replace(/\s+/g, " ").slice(0, 90)), "| name", JSON.stringify(f.name), "length", f.length);
console.log("isClass by text:", /^class\b/.test(String(Klass)), "| native by text:", /\[native code\]/.test(String(declared)), /\[native code\]/.test(String(Math.floor)));

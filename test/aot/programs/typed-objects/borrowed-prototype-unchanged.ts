// A plain object from untyped code that satisfies a record type, and that is the prototype of another object, stays as it is where it enters a typed place: at the top, below plain data, and where a read by name yields it. Its heir sees every later store. All data is built by stores, never written as a literal that looks like the type.
type Inner = { p: number; q?: string; deep: number[] };
type Outer = { inner: Inner; n?: number };
function own(): Outer { return { inner: { p: 7, deep: [1] } }; }
const kept: any[] = [];
function read(o: Outer): unknown { const i = o.inner; return [i.p, i.q, i.deep.length, o.inner.p, o.n]; }
function store(o: Outer): unknown { o.inner.q = "set"; o.n = 3; return [o.inner.q, o.n]; }
function attempt(name: string, f: () => unknown): void { try { console.log(name, JSON.stringify(f())); } catch (e) { console.log(name, (e as Error).name + ": " + (e as Error).message.split("\n").slice(0, 2).join(" | ").replace(/ \(bun compile[^)]*\)/, "").slice(0, 150)); } }
const built = (entries: [string, unknown][], onto: any = {}): any => { for (const [name, value] of entries) onto[name] = value; return onto; };
const inner = (): any => built([["p", 1], ["deep", [1, 2]]]);
const heirOf = (made: any): any => { kept.push(Object.create(made)); return made; };
const makers: [string, () => any][] = [
  ["one of its own", () => own()],
  ["plain data", () => built([["inner", inner()]])],
  ["the prototype of another", () => heirOf(built([["inner", inner()]]))],
  ["the prototype of another, parsed", () => heirOf(JSON.parse('{"inner": {"p": 1, "deep": [1, 2]}}'))],
  ["plain data that holds the prototype of another", () => built([["inner", heirOf(inner())]])],
  ["prototypes of others on both levels", () => heirOf(built([["inner", heirOf(inner())]]))],
  ["a proxy that holds the prototype of another", () => new Proxy(built([["inner", heirOf(inner())]]), {})],
  ["an accessor that yields the prototype of another", () => { const below = heirOf(inner()); return Object.defineProperty({}, "inner", { get() { return below; }, enumerable: true, configurable: true }); }],
];
for (const [name, make] of makers) {
  attempt(name + ":", () => { const source = make(); kept.push(source); const o: Outer = source; return [read(o), o === source, Object.keys(o).join()]; });
  attempt(name + ", stores:", () => { const source = make(); kept.push(source); const o: Outer = source; return [store(o), source.inner.q, source.n]; });
  attempt(name + ", its heir sees a later store:", () => { const before = kept.length; const source = make(); const o: Outer = source; o.n = 9; const heir = kept[before]; return heir === undefined ? "no heir" : [heir.n, heir.p, heir.inner === undefined]; });
}

// A fixture of aot-audit-members.test.ts. One case a line: `t(() => { .. });`. Each runs three times: plain, in an --aot executable, under --aot-audit.
// The attributes of a member: of an object that typed code has not made, where it enters a record type; and of what typed code has made, redefined through `any`.
declare const Bun: any, process: any;
const far = Bun.argv.length > 99 ? 1 : 0;
const anyv = (v: unknown): any => [v, 0][far];
const json = (text: string): any => JSON.parse(text);
const G = '{"id":"x","n":{"x":1}}';
let at = 0;
interface P0 { id: string; n: { x: number } }
interface P1 { id: string; n: { x: number } }
interface P2 { id: string; n: { x: number } }
interface P3 { id: string; n: { x: number } }
interface P4 { id: string; n: { x: number } }
interface P5 { id: string; n: { x: number } }
interface P6 { id: string; n: { x: number } }
interface P7 { id: string; n: { x: number } }
interface P8 { id: string; n: { x: number } }
interface P9 { id: string; n: { x: number } }
interface P10 { id: string; n: { x: number } }
interface P11 { id: string; n: { x: number } }
interface P12 { id: string; n: { x: number } }
interface P13 { id: string; n: { x: number } }
interface P14 { id: string; n: { x: number } }
interface M0 { id: string; n: { x: number } } function make0(): M0 { return { id: "k", n: { x: 0 } }; } function id0(o: M0) { return o.id; }
interface M1 { id: string; n: { x: number } } function make1(): M1 { return { id: "k", n: { x: 0 } }; } function id1(o: M1) { return o.id; }
interface M2 { id: string; n: { x: number } } function make2(): M2 { return { id: "k", n: { x: 0 } }; } function id2(o: M2) { return o.id; }
interface M3 { id: string; n: { x: number } } function make3(): M3 { return { id: "k", n: { x: 0 } }; } function id3(o: M3) { return o.id; }
interface M4 { id: string; n: { x: number } } function make4(): M4 { return { id: "k", n: { x: 0 } }; } function id4(o: M4) { return o.id; }
interface M5 { id: string; n: { x: number } } function make5(): M5 { return { id: "k", n: { x: 0 } }; } function id5(o: M5) { return o.id; }
interface M6 { id: string; n: { x: number } } function make6(): M6 { return { id: "k", n: { x: 0 } }; } function id6(o: M6) { return o.id; }
class K0 { id = "k"; n = 1; }
class K1 { id = "k"; n = 1; }
class K2 { id = "k"; n = 1; }
class K3 { id = "k"; n = 1; }
class K4 { id = "k"; n = 1; }
class K5 { id = "k"; n = 1; }
class K6 { id = "k"; n = 1; }
interface MO { id: string; n: { x: number }; o?: string } function makeO(): MO { return { id: "k", n: { x: 0 }, o: "o" }; } function oOf(o: MO) { return String(o.o); }
interface MP { id: string; n: { x: number }; o?: string } function makeP(): MP { return { id: "k", n: { x: 0 }, o: "o" }; } function pOf(o: MP) { return String(o.o); }
class KO { id = "k"; o?: string = "o"; }
class KP { id = "k"; o?: string = "o"; }
const keep: unknown[] = [{ id: "k", n: { x: 0 } } as P0, { id: "k", n: { x: 0 } } as P1, { id: "k", n: { x: 0 } } as P2, { id: "k", n: { x: 0 } } as P3, { id: "k", n: { x: 0 } } as P4, { id: "k", n: { x: 0 } } as P5, { id: "k", n: { x: 0 } } as P6, { id: "k", n: { x: 0 } } as P7, { id: "k", n: { x: 0 } } as P8, { id: "k", n: { x: 0 } } as P9, { id: "k", n: { x: 0 } } as P10, { id: "k", n: { x: 0 } } as P11, { id: "k", n: { x: 0 } } as P12, { id: "k", n: { x: 0 } } as P13, { id: "k", n: { x: 0 } } as P14];
function t(f: () => unknown) { at++; let said: string; try { const v = f(); said = typeof v + " " + String(v); } catch (e) { said = "threw " + (e as Error).constructor.name + (process.env.WHY ? " " + String((e as Error).message).split("\n").join(" ~ ") : ""); } console.log(at, said); }
t(() => { const v: P0 = anyv(Object.defineProperty(json(G), "id", { value: "y", writable: false, enumerable: true, configurable: true })); return typeof v + v.id + v.n.x; }); // an outside object: read only
t(() => { const v: P1 = anyv(Object.defineProperty(json(G), "id", { value: "y", writable: true, enumerable: true, configurable: false })); return typeof v + v.id + v.n.x; }); // an outside object: not configurable
t(() => { const v: P2 = anyv(Object.defineProperty(json(G), "id", { value: "y", writable: false, enumerable: true, configurable: false })); return typeof v + v.id + v.n.x; }); // an outside object: read only and not configurable
t(() => { const v: P3 = anyv(Object.defineProperty(json(G), "id", { value: "y", writable: true, enumerable: false, configurable: true })); return typeof v + v.id + v.n.x; }); // an outside object: hidden // silent: a hidden property of its own: the audit sees it in line and asks no further
t(() => { const v: P4 = anyv(Object.defineProperty(json(G), "id", { value: "y", writable: false, enumerable: false, configurable: true })); return typeof v + v.id + v.n.x; }); // an outside object: hidden and read only // silent: a hidden property of its own: the audit sees it in line and asks no further
t(() => { const v: P5 = anyv(Object.defineProperty(json(G), "id", { get() { return "y"; }, enumerable: true, configurable: true })); return typeof v + v.id + v.n.x; }); // an outside object: a getter
t(() => { const v: P6 = anyv(Object.defineProperty(json(G), "id", { value: 5, writable: false, enumerable: true, configurable: true })); return typeof v + v.id + v.n.x; }); // an outside object: read only, of another kind
t(() => { const v: P7 = anyv(Object.defineProperty(json(G), "id", { value: 5, writable: true, enumerable: true, configurable: false })); return typeof v + v.id + v.n.x; }); // an outside object: not configurable, of another kind
t(() => { const v: P8 = anyv((() => { const d = json(G); Object.defineProperty(d.n, "x", { value: 2, writable: false, enumerable: true, configurable: true }); return d; })()); return typeof v + v.id + v.n.x; }); // an outside object: read only, below
t(() => { const v: P9 = anyv((() => { const d = json(G); Object.defineProperty(d.n, "x", { get() { return 2; }, enumerable: true, configurable: true }); return d; })()); return typeof v + v.id + v.n.x; }); // an outside object: a getter, below
t(() => { const v: P10 = anyv(Object.defineProperty(json(G), "extra", { value: 5, writable: false, enumerable: true, configurable: true })); return typeof v + v.id + v.n.x; }); // an outside object: an extra member read only
t(() => { const v: P11 = anyv(Object.freeze(json(G))); return typeof v + v.id + v.n.x; }); // an outside object: frozen
t(() => { const v: P12 = anyv(Object.seal(json(G))); return typeof v + v.id + v.n.x; }); // an outside object: sealed
t(() => { const v: P13 = anyv(Object.preventExtensions(json(G))); return typeof v + v.id + v.n.x; }); // an outside object: closed to new properties
t(() => { const v: P14 = anyv(Object.seal(Object.defineProperty(json(G), "id", { value: "y", writable: false, enumerable: true, configurable: true }))); return typeof v + v.id + v.n.x; }); // an outside object: sealed, one member read only
t(() => { const o = make0(); Object.defineProperty(anyv(o), "id", { value: "y", writable: false, enumerable: true, configurable: true }); return id0(o); }); // a record of typed code: read only
t(() => { const o = make1(); Object.defineProperty(anyv(o), "id", { value: "y", writable: true, enumerable: true, configurable: false }); return id1(o); }); // a record of typed code: not configurable
t(() => { const o = make2(); Object.defineProperty(anyv(o), "id", { value: "y", writable: false, enumerable: true, configurable: false }); return id2(o); }); // a record of typed code: read only and not configurable
t(() => { const o = make3(); Object.defineProperty(anyv(o), "id", { value: "y", writable: true, enumerable: false, configurable: true }); return id3(o); }); // a record of typed code: hidden
t(() => { const o = make4(); Object.defineProperty(anyv(o), "id", { get() { return "y"; }, enumerable: true, configurable: true }); return id4(o); }); // a record of typed code: a getter
t(() => { const o = make5(); Object.defineProperty(anyv(o), "id", { value: 5, writable: false, enumerable: true, configurable: true }); return id5(o); }); // a record of typed code: read only, of another kind
t(() => { const o = make6(); Object.defineProperty(anyv(o), "id", { value: "y", writable: true, enumerable: true, configurable: true }); return id6(o); }); // a record of typed code: as it is
t(() => { const o = new K0(); Object.defineProperty(anyv(o), "id", { value: "y", writable: false, enumerable: true, configurable: true }); return o.id; }); // an instance: read only
t(() => { const o = new K1(); Object.defineProperty(anyv(o), "id", { value: "y", writable: true, enumerable: true, configurable: false }); return o.id; }); // an instance: not configurable
t(() => { const o = new K2(); Object.defineProperty(anyv(o), "id", { value: "y", writable: false, enumerable: true, configurable: false }); return o.id; }); // an instance: read only and not configurable
t(() => { const o = new K3(); Object.defineProperty(anyv(o), "id", { value: "y", writable: true, enumerable: false, configurable: true }); return o.id; }); // an instance: hidden
t(() => { const o = new K4(); Object.defineProperty(anyv(o), "id", { get() { return "y"; }, enumerable: true, configurable: true }); return o.id; }); // an instance: a getter
t(() => { const o = new K5(); Object.defineProperty(anyv(o), "id", { value: 5, writable: false, enumerable: true, configurable: true }); return o.id; }); // an instance: read only, of another kind
t(() => { const o = new K6(); Object.defineProperty(anyv(o), "id", { value: "y", writable: true, enumerable: true, configurable: true }); return o.id; }); // an instance: as it is
t(() => { const o = makeO(); Object.defineProperty(anyv(o), "o", { value: "y", writable: true, enumerable: false, configurable: true }); return oOf(o) + Object.keys(o).length; }); // a record of typed code: an optional member hidden
t(() => { const o = makeP(); Object.defineProperty(anyv(o), "o", { get() { return "y"; }, enumerable: true, configurable: true }); return pOf(o); }); // a record of typed code: an optional member a getter
t(() => { const o = new KO(); Object.defineProperty(anyv(o), "o", { value: "y", writable: true, enumerable: false, configurable: true }); return String(o.o) + Object.keys(o).length; }); // an instance: an optional member hidden
t(() => { const o = new KP(); Object.defineProperty(anyv(o), "o", { get() { return "y"; }, enumerable: true, configurable: true }); return String(o.o); }); // an instance: an optional member a getter
if (far) console.log(keep);

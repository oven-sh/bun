// A fixture of aot-audit-members.test.ts. One case a line: `t(() => { .. });`. Each runs three times: plain, in an --aot executable, under --aot-audit.
declare const Bun: any, process: any, Buffer: any;
const far = Bun.argv.length > 99 ? 1 : 0;
const anyv = (v: unknown): any => [v, 0][far];
const json = (text: string): any => JSON.parse(text);
let at = 0;
interface Ctx0 { cwd: string }
interface C1 { cwd: string; deep: { x: number } } interface R1 { id: string; ctx: C1 }
interface C2 { cwd: string; deep: { x: number } } interface R2 { id: string; ctx: C2 }
interface C3 { cwd: string; deep: { x: number } } interface R3 { id: string; ctx: C3 }
interface C4 { cwd: string; deep: { x: number } } interface R4 { id: string; ctx: C4 }
interface C5 { cwd: string; deep: { x: number } } interface R5 { id: string; ctx: C5 }
interface C6 { cwd: string; deep: { x: number } } interface R6 { id: string; ctx: C6 }
interface C7 { cwd: string; deep: { x: number } } interface R7 { id: string; ctx: C7 }
interface C8 { cwd: string; deep: { x: number } } interface R8 { id: string; ctx: C8 }
interface C9 { cwd: string; deep: { x: number } } interface R9 { id: string; ctx: C9 }
interface C10 { cwd: string; deep: { x: number } } interface R10 { id: string; ctx: C10 }
interface C11 { cwd: string; deep: { x: number } } interface R11 { id: string; ctx: C11 }
interface C12 { cwd: string; deep: { x: number } } interface R12 { id: string; ctx: C12 }
interface C13 { cwd: string; deep: { x: number } } interface R13 { id: string; ctx: C13 }
interface C14 { cwd: string; deep: { x: number } } interface R14 { id: string; ctx: C14 }
interface C15 { cwd: string; deep: { x: number } } interface R15 { id: string; ctx: C15 }
interface C16 { cwd: string; deep: { x: number } } interface R16 { id: string; ctx: C16 }
interface C17 { cwd: string; deep: { x: number } } interface R17 { id: string; ctx: C17 }
interface C18 { cwd: string; deep: { x: number } } interface R18 { id: string; ctx: C18 }
interface C19 { cwd: string; deep: { x: number } } interface R19 { id: string; ctx: C19 }
interface C20 { cwd: string; deep: { x: number } } interface R20 { id: string; ctx: C20 }
interface C21 { cwd: string; deep: { x: number } } interface R21 { id: string; ctx: C21 }
interface C22 { cwd: string; deep: { x: number } } interface R22 { id: string; ctx: C22 }
interface C23 { cwd: string; deep: { x: number } } interface R23 { id: string; ctx: C23 }
interface C24 { cwd: string; deep: { x: number } } interface R24 { id: string; ctx: C24 }
interface C25 { cwd: string; deep: { x: number } } interface R25 { id: string; ctx: C25 }
interface C26 { cwd: string; deep: { x: number } } interface R26 { id: string; ctx: C26 }
interface C27 { cwd: string; deep: { x: number } } interface R27 { id: string; ctx: C27 }
interface C28 { cwd: string; deep: { x: number } } interface R28 { id: string; ctx: C28 }
interface C29 { cwd: string; deep: { x: number } } interface R29 { id: string; ctx: C29 }
interface C30 { cwd: string; deep: { x: number } } interface R30 { id: string; ctx: C30 }
interface C31 { cwd: string; deep: { x: number } } interface R31 { id: string; ctx: C31 }
interface C32 { cwd: string; deep: { x: number } } interface R32 { id: string; ctx: C32 }
interface C33 { cwd: string; deep: { x: number } } interface R33 { id: string; ctx: C33 }
interface C34 { cwd: string; deep: { x: number } } interface R34 { id: string; ctx: C34 }
interface C35 { cwd: string; deep: { x: number } } interface R35 { id: string; ctx: C35 }
interface C36 { cwd: string; deep: { x: number } } interface R36 { id: string; ctx: C36 }
interface C37 { cwd: string; deep: { x: number } } interface R37 { id: string; ctx: C37 }
interface C38 { cwd: string; deep: { x: number } } interface R38 { id: string; ctx: C38 }
interface C39 { cwd: string; deep: { x: number } } interface R39 { id: string; ctx: C39 }
interface CS { cwd: string; deep: { x: number } } interface RS { id: string; ctx: CS }
class Impl implements RS { id = "i"; ctx: CS = { cwd: "/", deep: { x: 1 } }; } class Sub extends Impl { more = 1; } class Other { id = "o"; }
interface CN { cwd: string; deep: { x: number } } interface RN { id: string; ctx: CN }
interface CV { cwd: string; deep: { x: number } } interface Base { id: string; ctx: CV } interface A1 extends Base { a: CV } interface B1 extends Base { b: CV }
interface CT { cwd: string; deep: { x: number } } interface T1 { id: string; ctx: CT } interface T2 { id: string; ctx: CT; opt?: CT } interface Both { one: T1; two: T2 }
interface CI { cwd: string; deep: { x: number } } interface Wide { a: CI; o1?: CI; o2?: CI; o3?: CI; o4?: CI; o5?: CI; o6?: CI; o7?: CI; o8?: CI; o9?: CI; o10?: CI; o11?: CI; o12?: CI; o13?: CI; o14?: CI; o15?: CI; o16?: CI; o17?: CI; o18?: CI; o19?: CI; o20?: CI; o21?: CI; o22?: CI; o23?: CI; o24?: CI; }
interface CM { cwd: string; deep: { x: number } } interface Mem { c: CM; f: () => void; m: Map<string, number>; xs: number[]; d: Date; a: any; u: unknown; o: object; n: number | null; s?: string }
declare global { var held: unknown }
const CC = '{"cwd":"/","deep":{"x":1}}', G = '{"id":"y","ctx":' + CC + "}";
const keep: unknown[] = [{ id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R1, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R2, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R3, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R4, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R5, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R6, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R7, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R8, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R9, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R10, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R11, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R12, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R13, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R14, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R15, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R16, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R17, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R18, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R19, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R20, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R21, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R22, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R23, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R24, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R25, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R26, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R27, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R28, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R29, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R30, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R31, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R32, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R33, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R34, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R35, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R36, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R37, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R38, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as R39, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as RS, new Impl() as RS, new Sub(), new Other(), { id: "k", ctx: { cwd: "/", deep: { x: 1 } }, a: { cwd: "/", deep: { x: 1 } } } as A1, { id: "k", ctx: { cwd: "/", deep: { x: 1 } }, b: { cwd: "/", deep: { x: 1 } } } as B1, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as T1, { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } as T2, { one: { id: "k", ctx: { cwd: "/", deep: { x: 1 } } }, two: { id: "k", ctx: { cwd: "/", deep: { x: 1 } } } } as Both, { a: { cwd: "/", deep: { x: 1 } } } as Wide, { c: { cwd: "/", deep: { x: 1 } }, f() {}, m: new Map(), xs: [], d: new Date(0), a: 1, u: 1, o: {}, n: null } as Mem];
function t(f: () => unknown) { at++; let said: string; try { const v = f(); said = typeof v + " " + String(v); } catch (e) { said = "threw " + (e as Error).constructor.name + (process.env.WHY ? " " + String((e as Error).message).replace(/ \(bun --aot[^)]*\)/, "").replace(/\n */g, " ~ ") : ""); } console.log(at, said); }
t(() => { const v: R1 = anyv(Object.freeze(json(G))); return typeof v; }); // frozen // silent: frozen, sealed or closed to new properties: what typed code has made may be so too
t(() => { const v: R2 = anyv(Object.seal(json(G))); return typeof v; }); // sealed // silent: frozen, sealed or closed to new properties: what typed code has made may be so too
t(() => { const v: R3 = anyv(Object.preventExtensions(json(G))); return typeof v; }); // closedToNew // silent: frozen, sealed or closed to new properties: what typed code has made may be so too
t(() => { const v: R4 = anyv(Object.assign(json(G), { [Symbol("q")]: 1 })); return typeof v; }); // symbolKey
t(() => { const v: R5 = anyv(Object.assign(json(G), { 0: 1 })); return typeof v; }); // indexKey
t(() => { const v: R6 = anyv(Object.defineProperty(json(G), "id", { value: "y", writable: false, enumerable: true, configurable: true })); return typeof v; }); // readOnly
t(() => { const v: R7 = anyv(Object.defineProperty(json(G), "id", { value: "y", writable: true, enumerable: true, configurable: false })); return typeof v; }); // fixed
t(() => { const v: R8 = anyv(Object.defineProperty(json(G), "id", { value: "y", writable: true, enumerable: false, configurable: true })); return typeof v; }); // hidden
t(() => { const v: R9 = anyv(Object.defineProperty(json(G), "extra", { get() { return 1; }, enumerable: true, configurable: true })); return typeof v; }); // extraGetter
t(() => { const v: R10 = anyv(Object.defineProperty(json(G), "id", { get() { return "y"; }, enumerable: true, configurable: true })); return typeof v; }); // getter
t(() => { const v: R11 = anyv(Object.setPrototypeOf(json(G), { z: 1 })); return typeof v; }); // otherProto // silent: another prototype and not native: `new` on a class or a function of the program may have made it
t(() => { const v: R12 = anyv(Object.setPrototypeOf(json(G), null)); return typeof v; }); // nullProto
t(() => { const v: R13 = anyv((() => { const d = json(G); Object.create(d); return d; })()); return typeof v; }); // isProto
t(() => { const v: R14 = anyv((() => { const d = json(G); d.self = d; return d; })()); return typeof v; }); // cycle
t(() => { const v: R15 = anyv(new String("x")); return typeof v; }); // boxed
t(() => { const v: R16 = anyv(new Error("x")); return typeof v; }); // error
t(() => { const v: R17 = anyv(process.env); return typeof v; }); // env
t(() => { const v: R18 = anyv(Bun); return typeof v; }); // bun
t(() => { const v: R19 = anyv(globalThis); return typeof v; }); // global
t(() => { const v: R20 = anyv(Math); return typeof v; }); // math
t(() => { const v: R21 = anyv((function (..._: unknown[]) { return arguments; })(1)); return typeof v; }); // args
t(() => { const v: R22 = anyv(new Date(0)); return typeof v; }); // date
t(() => { const v: R23 = anyv(/a/); return typeof v; }); // regexp
t(() => { const v: R24 = anyv(Promise.resolve(1)); return typeof v; }); // promise
t(() => { const v: R25 = anyv(new Uint8Array(1)); return typeof v; }); // typedArray
t(() => { const v: R26 = anyv(() => 1); return typeof v; }); // fn
t(() => { const v: R27 = anyv(class Z {}); return typeof v; }); // klass
t(() => { const v: R28 = anyv(new WeakMap()); return typeof v; }); // weak
t(() => { const v: R29 = anyv(new Proxy(json(G), {})); return typeof v; }); // proxy
t(() => { const v: R30 = anyv(Object.assign(Object.create(Object.prototype), json(G))); return typeof v; }); // objectCreate
t(() => { const v: R31 = anyv(Object.assign(new Object(), json(G))); return typeof v; }); // newObject
t(() => { const v: R32 = anyv({ ...json(G) }); return typeof v; }); // spread
t(() => { const v: R33 = anyv(Object.fromEntries(Object.entries(json(G)))); return typeof v; }); // fromEntries
t(() => { const v: R34 = anyv(structuredClone(json(G))); return typeof v; }); // structured
t(() => { const v: R35 = anyv(1); return typeof v; }); // number
t(() => { const v: R36 = anyv("x"); return typeof v; }); // string
t(() => { const v: R37 = anyv(null); return typeof v; }); // nil
t(() => { const v: R38 = anyv(undefined); return typeof v; }); // undef
t(() => { const v: R39 = anyv(true); return typeof v; }); // bool
t(() => { const v: RS = anyv(new Impl()); return typeof v; }); // a class that implements the record
t(() => { const v: RS = anyv(new Sub()); return typeof v; }); // its heir
t(() => { const v: RS = anyv(new Other()); return typeof v; }); // a class of the program that does not fit // silent: another prototype and not native: `new` on a class or a function of the program may have made it
t(() => { const v: RS = anyv(json(G)); return typeof v; }); // data that fits
t(() => { const v: RN = json(G); return typeof v; }); // a type nobody allocates, data that fits
t(() => { const v: RN = json('{"id":"y"}'); return typeof v; }); // a type nobody allocates, data that lacks
t(() => { const v: Base = json(G); return typeof v; }); // a base nobody allocates: data of the base alone
t(() => { const v: Base = json(G.slice(0, -1) + ',"a":' + CC + "}"); return typeof v; }); // a base nobody allocates: data of one heir
t(() => { const v: A1 | B1 = json(G.slice(0, -1) + ',"b":' + CC + "}"); return typeof v; }); // a union: data of the second
t(() => { const v: A1 | B1 = json(G); return typeof v; }); // a union: data of neither
t(() => { const d = json(G); const v: Both = anyv(Object.assign(json("{}"), { one: d, two: d })); return typeof v; }); // one object under two types
t(() => { const v: Both = json('{"one":' + G + ',"two":' + G + "}"); return typeof v; }); // two objects
t(() => { const v: Wide = json('{"a":' + CC + "}"); return typeof v; }); // a wide type, small data, fresh
t(() => { const d = json('{"a":' + CC + "}"); const other = d; const v: Wide = d; return typeof v + typeof other; }); // a wide type, small data, held twice
t(() => { const d = anyv(json('{"a":' + CC + "}")); globalThis.held = d; const v: Wide = d; return typeof v; }); // a wide type, small data, held by a global
t(() => { const v: Mem = anyv(Object.assign(json('{"c":' + CC + ',"xs":[],"a":1,"u":1,"o":{},"n":null}'), { f() {}, m: new Map(), d: new Date(0) })); return typeof v; }); // fits
t(() => { const v: Mem = anyv(Object.assign(json('{"c":' + CC + ',"xs":[],"a":1,"u":1,"o":{},"n":null}'), { f() {}, m: new Map(), d: new Date(0) }, { f: 1 })); return typeof v; }); // f is a number
t(() => { const v: Mem = anyv(Object.assign(json('{"c":' + CC + ',"xs":[],"a":1,"u":1,"o":{},"n":null}'), { f() {}, m: new Map(), d: new Date(0) }, { f: {} })); return typeof v; }); // f is an object
t(() => { const v: Mem = anyv(Object.assign(json('{"c":' + CC + ',"xs":[],"a":1,"u":1,"o":{},"n":null}'), { f() {}, m: new Map(), d: new Date(0) }, { m: new Set() })); return typeof v; }); // m is a Set
t(() => { const v: Mem = anyv(Object.assign(json('{"c":' + CC + ',"xs":[],"a":1,"u":1,"o":{},"n":null}'), { f() {}, m: new Map(), d: new Date(0) }, { m: {} })); return typeof v; }); // m is plain
t(() => { const v: Mem = anyv(Object.assign(json('{"c":' + CC + ',"xs":[],"a":1,"u":1,"o":{},"n":null}'), { f() {}, m: new Map(), d: new Date(0) }, { xs: {} })); return typeof v; }); // xs is plain
t(() => { const v: Mem = anyv(Object.assign(json('{"c":' + CC + ',"xs":[],"a":1,"u":1,"o":{},"n":null}'), { f() {}, m: new Map(), d: new Date(0) }, { xs: new Uint8Array(1) })); return typeof v; }); // xs is a typed array
t(() => { const v: Mem = anyv(Object.assign(json('{"c":' + CC + ',"xs":[],"a":1,"u":1,"o":{},"n":null}'), { f() {}, m: new Map(), d: new Date(0) }, { d: "1970" })); return typeof v; }); // d is a string
t(() => { const v: Mem = anyv(Object.assign(json('{"c":' + CC + ',"xs":[],"a":1,"u":1,"o":{},"n":null}'), { f() {}, m: new Map(), d: new Date(0) }, { d: {} })); return typeof v; }); // d is plain
t(() => { const v: Mem = anyv(Object.assign(json('{"c":' + CC + ',"xs":[],"a":1,"u":1,"o":{},"n":null}'), { f() {}, m: new Map(), d: new Date(0) }, { o: 1 })); return typeof v; }); // o is a number
t(() => { const v: Mem = anyv(Object.assign(json('{"c":' + CC + ',"xs":[],"a":1,"u":1,"o":{},"n":null}'), { f() {}, m: new Map(), d: new Date(0) }, { o: () => 1 })); return typeof v; }); // o is a function
t(() => { const v: Mem = anyv(Object.assign(json('{"c":' + CC + ',"xs":[],"a":1,"u":1,"o":{},"n":null}'), { f() {}, m: new Map(), d: new Date(0) }, { o: null })); return typeof v; }); // o is null
t(() => { const v: Mem = anyv(Object.assign(json('{"c":' + CC + ',"xs":[],"a":1,"u":1,"o":{},"n":null}'), { f() {}, m: new Map(), d: new Date(0) }, { n: undefined })); return typeof v; }); // n is undefined
t(() => { const v: Mem = anyv(Object.assign(json('{"c":' + CC + ',"xs":[],"a":1,"u":1,"o":{},"n":null}'), { f() {}, m: new Map(), d: new Date(0) }, { n: "1" })); return typeof v; }); // n is a string
t(() => { const v: Mem = anyv(Object.assign(json('{"c":' + CC + ',"xs":[],"a":1,"u":1,"o":{},"n":null}'), { f() {}, m: new Map(), d: new Date(0) }, { s: undefined })); return typeof v; }); // s is undefined
t(() => { const v: Mem = anyv(Object.assign(json('{"c":' + CC + ',"xs":[],"a":1,"u":1,"o":{},"n":null}'), { f() {}, m: new Map(), d: new Date(0) }, { s: null })); return typeof v; }); // s is null
t(() => { const v: Mem = anyv(Object.assign(json('{"c":' + CC + ',"xs":[],"a":1,"u":1,"o":{},"n":null}'), { f() {}, m: new Map(), d: new Date(0) }, { s: 1 })); return typeof v; }); // s is a number
t(() => { const v: Mem = anyv(Object.assign(json('{"c":' + CC + ',"xs":[],"a":1,"u":1,"o":{},"n":null}'), { f() {}, m: new Map(), d: new Date(0) }, { a: undefined, u: undefined })); return typeof v; }); // a, u undefined
t(() => { const d = Object.assign(json('{"c":' + CC + ',"xs":[],"a":1,"u":1,"o":{},"n":null}'), { f() {}, m: new Map(), d: new Date(0) }); delete d.a; const v: Mem = anyv(d); return typeof v; }); // lacks a: any
t(() => { const d = Object.assign(json('{"c":' + CC + ',"xs":[],"a":1,"u":1,"o":{},"n":null}'), { f() {}, m: new Map(), d: new Date(0) }); delete d.u; const v: Mem = anyv(d); return typeof v; }); // lacks u: unknown
t(() => { const d = Object.assign(json('{"c":' + CC + ',"xs":[],"a":1,"u":1,"o":{},"n":null}'), { f() {}, m: new Map(), d: new Date(0) }); delete d.n; const v: Mem = anyv(d); return typeof v; }); // lacks n: number | null
t(() => keep.length);
export {};

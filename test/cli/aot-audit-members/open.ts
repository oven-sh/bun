// A fixture of aot-audit-members.test.ts. One case a line: `t(() => { .. });`. Each runs three times: plain, in an --aot executable, under --aot-audit.
declare const Bun: any, process: any, Buffer: any;
const far = Bun.argv.length > 99 ? 1 : 0;
const anyv = (v: unknown): any => [v, 0][far];
const json = (text: string): any => JSON.parse(text);
let at = 0;
interface Ctx { cwd: string }
interface Session { type: "session"; id: string; ctx: Ctx }
interface Prims { c: Ctx; s: string; n: number; b: boolean; g: bigint; y: symbol; u: undefined; z: null }
interface Nullable { c: Ctx; a: string | null; b: number | undefined; d?: string | null; e: Ctx | null; f: Ctx | undefined }
interface Loose { c: Ctx; a: any; k: unknown; o: object; fn: () => void; F: Function }
interface Globals { c: Ctx; m: Map<string, number>; d: Date; r: RegExp; e: Error; p: Promise<number>; u8: Uint8Array; st: Set<string> }
interface Arrays { c: Ctx; xs: number[]; t: [number, string]; ro: readonly string[]; nested: Ctx[][] }
interface Lits { c: Ctx; w: "a" | "b"; q: 1 | 2; tf: true }
interface Methods { c: Ctx; m(): number }
interface Index { c: Ctx; [key: string]: unknown }
type Dict = Record<string, Ctx>;
interface Big { a: Ctx; b1?: Ctx; b2?: Ctx; b3?: Ctx; b4?: Ctx; b5?: Ctx; b6?: Ctx; b7?: Ctx; b8?: Ctx; b9?: Ctx; b10?: Ctx; b11?: Ctx; b12?: Ctx; b13?: Ctx; b14?: Ctx; b15?: Ctx; b16?: Ctx }
interface Ext extends Session { more: Ctx }
class K { constructor(public ctx: Ctx) {} }
interface HasK { c: Ctx; k: K }
interface Gen<T> { c: Ctx; v: T }
const fresh = (id: string): Session => ({ type: "session", id, ctx: { cwd: "/" } });
const C = '{"cwd":"/"}', S = '{"type":"session","id":"y","ctx":{"cwd":"/"}}';
const keep: unknown[] = [fresh("a"), { c: { cwd: "/" }, s: "", n: 0, b: true, g: 1n, y: Symbol(), u: undefined, z: null } as Prims, { c: { cwd: "/" }, a: null, b: 1, e: null, f: undefined } as Nullable, { c: { cwd: "/" }, a: 1, k: 1, o: {}, fn() {}, F() {} } as Loose, { c: { cwd: "/" }, xs: [], t: [1, ""], ro: [], nested: [] } as Arrays, { c: { cwd: "/" }, w: "a", q: 1, tf: true } as Lits, { c: { cwd: "/" }, m() { return 1; } } as Methods, { c: { cwd: "/" } } as Index, { a: { cwd: "/" } } as Big, { ...fresh("e"), more: { cwd: "/" } } as Ext, { c: { cwd: "/" }, k: new K({ cwd: "/" }) } as HasK, { c: { cwd: "/" }, v: 1 } as Gen<number>, { c: { cwd: "/" }, m: new Map(), d: new Date(0), r: /a/, e: new Error("x"), p: Promise.resolve(1), u8: new Uint8Array(1), st: new Set() } as Globals];
function t(f: () => unknown) { at++; let said: string; try { const v = f(); said = typeof v + " " + String(v); } catch (e) { said = "threw " + (e as Error).constructor.name + (process.env.WHY ? " " + String((e as Error).message).replace(/ \(bun --aot[^)]*\)/, "").replace(/\n */g, " ~ ") : ""); } console.log(at, said); }
t(() => { function f(): Session { return json(S); } return f().id; });
t(() => { function f(s: Session) { return s.id; } return f(json(S)); });
t(() => { function f(s: Session) { return s.id; } return (f as any)(json(S)); });
t(() => { const box: { s: Session } = { s: fresh("b") }; box.s = json(S); return box.s.id; });
t(() => { const list: Session[] = json("[" + S + "]"); return list[0].id; });
t(() => { const list: Session[] = [fresh("c")]; list.push(json(S)); return list[1].id; });
t(() => { const list: Session[] = [fresh("c")]; list[0] = json(S); return list[0].id; });
t(() => { const m = new Map<string, Session>(); m.set("a", json(S)); return m.get("a")!.id; });
t(() => { const s: Session | null = json(S); return s!.id; });
t(() => { const s: Session | string = json(S); return typeof s; });
t(() => { class H { s: Session = fresh("h"); } const h = new H(); h.s = json(S); return h.s.id; });
t(() => { class H { s: Session = fresh("h"); } const h = new H(); h.s = json('{"id":"y"}'); return h.s.id; });
t(() => { class H { s: Session = fresh("h"); } const h: any = new H(); h.s = json('{"id":"y"}'); return h.s.id; });
t(() => { class H { s: Session = fresh("h"); } const h: any = new H(); h.s = json(S); return h.s.id; });
t(() => { function f({ ctx }: Session) { return ctx.cwd; } return f(json(S)); });
t(() => { function f({ ctx }: Session) { return String(ctx); } return f(json('{"id":"y"}')); });
t(() => { let n = 0; for (const s of json("[" + S + "]") as Session[]) n += s.id.length; return n; });
t(() => { let n = 0; for (const s of json('[{"id":"y"}]') as Session[]) n += s.id.length; return n; });
t(() => { const [s]: Session[] = json('[{"id":"y"}]'); return s.id; });
t(() => { const o: { s: Session } = json('{"s":{"id":"y"}}'); return o.s.id; });
t(() => { const p: Prims = anyv({ c: json(C), s: "", n: 0, b: true, g: 1n, y: Symbol(), u: undefined, z: null }); return typeof p; });
t(() => { const p: Prims = Object.assign(json('{"s":"","n":0,"b":true,"z":null}'), { c: json(C), g: 1n, y: Symbol(), u: undefined }); return typeof p; });
t(() => { const p: Prims = Object.assign(json('{"s":"","n":0,"b":true,"z":null}'), { c: json(C), g: 1n, y: Symbol() }); return typeof p; });
t(() => { const p: Prims = Object.assign(json('{"s":"","n":"0","b":true,"z":null}'), { c: json(C), g: 1n, y: Symbol(), u: undefined }); return typeof p; });
t(() => { const p: Prims = Object.assign(json('{"s":"","n":0,"b":1,"z":null}'), { c: json(C), g: 1n, y: Symbol(), u: undefined }); return typeof p; });
t(() => { const p: Prims = Object.assign(json('{"s":"","n":0,"b":true,"z":null}'), { c: json(C), g: 1, y: Symbol(), u: undefined }); return typeof p; });
t(() => { const p: Prims = Object.assign(json('{"s":"","n":0,"b":true,"z":null}'), { c: json(C), g: 1n, y: "y", u: undefined }); return typeof p; });
t(() => { const p: Prims = Object.assign(json('{"s":"","n":0,"b":true,"z":null}'), { c: json(C), g: 1n, y: Symbol(), u: null }); return typeof p; });
t(() => { const p: Prims = Object.assign(json('{"s":"","n":0,"b":true,"z":0}'), { c: json(C), g: 1n, y: Symbol(), u: undefined }); return typeof p; });
t(() => { const p: Prims = Object.assign(json('{"s":null,"n":0,"b":true,"z":null}'), { c: json(C), g: 1n, y: Symbol(), u: undefined }); return typeof p; });
t(() => { const p: Prims = Object.assign(json('{"s":"","n":null,"b":true,"z":null}'), { c: json(C), g: 1n, y: Symbol(), u: undefined }); return typeof p; });
t(() => { const p: Prims = Object.assign(json('{"s":"","n":0,"b":null,"z":null}'), { c: json(C), g: 1n, y: Symbol(), u: undefined }); return typeof p; });
t(() => { const p: Prims = Object.assign(json('{"s":"","n":1.5,"b":false,"z":null}'), { c: json(C), g: 1n, y: Symbol(), u: undefined }); return typeof p; });
t(() => { const v: Nullable = json('{"c":' + C + ',"a":null,"b":1,"e":null,"f":' + C + '}'); return typeof v; });
t(() => { const v: Nullable = json('{"c":' + C + ',"a":null,"e":null}'); return typeof v; });
t(() => { const v: Nullable = json('{"c":' + C + ',"a":"x","b":null,"e":null,"f":null}'); return typeof v; });
t(() => { const v: Nullable = json('{"c":' + C + ',"a":1,"b":1,"e":null,"f":' + C + '}'); return typeof v; });
t(() => { const v: Nullable = json('{"c":' + C + ',"a":null,"b":1,"d":5,"e":null,"f":' + C + '}'); return typeof v; });
t(() => { const v: Nullable = json('{"c":' + C + ',"a":null,"b":1,"e":{},"f":' + C + '}'); return typeof v; });
t(() => { const v: Loose = Object.assign(json('{"c":' + C + ',"a":1,"k":1,"o":{}}'), { fn() {}, F() {} }); return typeof v; });
t(() => { const v: Loose = Object.assign(json('{"c":' + C + ',"o":{}}'), { fn() {}, F() {} }); return typeof v; });
t(() => { const v: Loose = Object.assign(json('{"c":' + C + ',"a":1,"k":1,"o":1}'), { fn() {}, F() {} }); return typeof v; });
t(() => { const v: Loose = Object.assign(json('{"c":' + C + ',"a":1,"k":1,"o":[]}'), { fn() {}, F() {} }); return typeof v; });
t(() => { const v: Loose = Object.assign(json('{"c":' + C + ',"a":1,"k":1,"o":{},"fn":1}'), { F() {} }); return typeof v; });
t(() => { const v: Loose = Object.assign(json('{"c":' + C + ',"a":1,"k":1,"o":{},"fn":{}}'), { F() {} }); return typeof v; });
t(() => { const v: Loose = Object.assign(json('{"c":' + C + ',"a":1,"k":1,"o":{},"F":{}}'), { fn() {} }); return typeof v; });
t(() => { const v: Globals = Object.assign(json('{"c":' + C + '}'), { m: new Map(), d: new Date(0), r: /a/, e: new Error("x"), p: Promise.resolve(1), u8: new Uint8Array(1), st: new Set() }); return typeof v; });
t(() => { const v: Globals = Object.assign(json('{"c":' + C + '}'), { m: new Set(), d: new Date(0), r: /a/, e: new Error("x"), p: Promise.resolve(1), u8: new Uint8Array(1), st: new Set() }); return typeof v; });
t(() => { const v: Globals = Object.assign(json('{"c":' + C + '}'), { m: new Map(), d: "1970", r: /a/, e: new Error("x"), p: Promise.resolve(1), u8: new Uint8Array(1), st: new Set() }); return typeof v; });
t(() => { const v: Globals = Object.assign(json('{"c":' + C + '}'), { m: new Map(), d: new Date(0), r: {}, e: new Error("x"), p: Promise.resolve(1), u8: new Uint8Array(1), st: new Set() }); return typeof v; });
t(() => { const v: Globals = Object.assign(json('{"c":' + C + '}'), { m: new Map(), d: new Date(0), r: /a/, e: new TypeError("x"), p: Promise.resolve(1), u8: new Uint8Array(1), st: new Set() }); return typeof v; });
t(() => { const v: Globals = Object.assign(json('{"c":' + C + '}'), { m: new Map(), d: new Date(0), r: /a/, e: { message: "x" }, p: Promise.resolve(1), u8: new Uint8Array(1), st: new Set() }); return typeof v; });
t(() => { const v: Globals = Object.assign(json('{"c":' + C + '}'), { m: new Map(), d: new Date(0), r: /a/, e: new Error("x"), p: { then() {} }, u8: new Uint8Array(1), st: new Set() }); return typeof v; });
t(() => { const v: Globals = Object.assign(json('{"c":' + C + '}'), { m: new Map(), d: new Date(0), r: /a/, e: new Error("x"), p: Promise.resolve(1), u8: Buffer.alloc(1), st: new Set() }); return typeof v; });
t(() => { const v: Globals = Object.assign(json('{"c":' + C + '}'), { m: new Map(), d: new Date(0), r: /a/, e: new Error("x"), p: Promise.resolve(1), u8: new Uint16Array(1), st: new Set() }); return typeof v; });
t(() => { const v: Arrays = json('{"c":' + C + ',"xs":[1],"t":[1,"a"],"ro":["a"],"nested":[[' + C + ']]}'); return typeof v; });
t(() => { const v: Arrays = json('{"c":' + C + ',"xs":["a"],"t":["a",1],"ro":[1],"nested":[1]}'); return typeof v; });
t(() => { const v: Arrays = json('{"c":' + C + ',"xs":{},"t":[1,"a"],"ro":["a"],"nested":[]}'); return typeof v; });
t(() => { const v: Arrays = json('{"c":' + C + ',"xs":[1],"t":{},"ro":["a"],"nested":[]}'); return typeof v; });
t(() => { const v: Arrays = json('{"c":' + C + ',"xs":[1],"t":[],"ro":"a","nested":[]}'); return typeof v; });
t(() => { const v: Lits = json('{"c":' + C + ',"w":"a","q":1,"tf":true}'); return typeof v; });
t(() => { const v: Lits = json('{"c":' + C + ',"w":"z","q":1,"tf":true}'); return typeof v; });
t(() => { const v: Lits = json('{"c":' + C + ',"w":"a","q":3,"tf":true}'); return typeof v; });
t(() => { const v: Lits = json('{"c":' + C + ',"w":"a","q":1,"tf":false}'); return typeof v; });
t(() => { const v: Lits = json('{"c":' + C + ',"w":1,"q":1,"tf":true}'); return typeof v; });
t(() => { const v: Lits = json('{"c":' + C + ',"w":"a","q":"1","tf":true}'); return typeof v; });
t(() => { const v: Lits = json('{"c":' + C + ',"w":"a","q":1.5,"tf":true}'); return typeof v; });
t(() => { const v: Methods = Object.assign(json('{"c":' + C + '}'), { m() { return 1; } }); return typeof v; });
t(() => { const v: Methods = json('{"c":' + C + '}'); return typeof v; });
t(() => { const v: Methods = json('{"c":' + C + ',"m":1}'); return typeof v; });
t(() => { const v: Index = json('{"c":' + C + ',"zz":1}'); return typeof v; });
t(() => { const v: Index = json('{"zz":1}'); return typeof v; });
t(() => { const v: Dict = json('{"a":' + C + '}'); return typeof v; });
t(() => { const v: Dict = json('{"a":1}'); return typeof v; });
t(() => { const v: Big = json('{"a":' + C + '}'); return typeof v; });
t(() => { const d = json('{"a":' + C + '}'); const other = d; const v: Big = d; return typeof v + typeof other; });
t(() => { const v: Big = json('{"a":' + C + ',"b16":' + C + '}'); return typeof v; });
t(() => { const v: Big = json('{"a":' + C + ',"b16":1}'); return typeof v; });
t(() => { const v: Ext = json('{"type":"session","id":"y","ctx":' + C + ',"more":' + C + '}'); return typeof v; });
t(() => { const v: Ext = json(S); return typeof v; });
t(() => { const v: Session = json('{"type":"session","id":"y","ctx":' + C + ',"more":' + C + '}'); return typeof v; });
t(() => { const v: HasK = Object.assign(json('{"c":' + C + '}'), { k: new K({ cwd: "/" }) }); return typeof v; });
t(() => { const v: HasK = json('{"c":' + C + ',"k":{"ctx":' + C + '}}'); return typeof v; });
t(() => { const v: HasK = json('{"c":' + C + ',"k":{}}'); return typeof v; });
t(() => { const v: HasK = json('{"c":' + C + ',"k":1}'); return typeof v; });
t(() => { const v: Gen<number> = json('{"c":' + C + ',"v":1}'); return typeof v; });
t(() => { const v: Gen<number> = json('{"c":' + C + ',"v":"x"}'); return typeof v; });
t(() => { const v: Gen<Ctx> = json('{"c":' + C + ',"v":{}}'); return typeof v; });
t(() => { const v: Session = Object.seal(json(S)); return typeof v; });
t(() => { const v: Session = Object.preventExtensions(json(S)); return typeof v; });
t(() => { const v: Session = Object.freeze(json(S)); return typeof v; });
t(() => { const v: Session = Object.assign(json(S), { [Symbol("q")]: 1 }); return typeof v; });
t(() => { const v: Session = Object.assign(json(S), { 0: 1 }); return typeof v; });
t(() => { const v: Session = Object.defineProperty(json('{"type":"session","ctx":' + C + '}'), "id", { value: "y", writable: false, enumerable: true, configurable: true }); return typeof v; });
t(() => { const v: Session = Object.defineProperty(json('{"type":"session","ctx":' + C + '}'), "id", { value: "y", writable: true, enumerable: true, configurable: false }); return typeof v; });
t(() => { const v: Session = Object.defineProperty(json(S), "extra", { get() { return 1; }, enumerable: true, configurable: true }); return typeof v; });
t(() => { const v: Session = Object.setPrototypeOf(json(S), { z: 1 }); return typeof v; });
t(() => { const v: Session = Object.setPrototypeOf(json(S), null); return typeof v; });
t(() => { const d = json(S); const child = Object.create(d); const v: Session = d; return typeof v + typeof child; });
t(() => { const d = json(S); d.self = d; const v: Session = d; return typeof v; });
t(() => { const c = json(C); const v: { a: Ctx; b: Ctx } = anyv(Object.assign(json("{}"), { a: c, b: c })); return v.a === v.b; });
t(() => { const v: Session = anyv(new String("x")); return typeof v; });
t(() => { const v: Session = anyv(new Error("x")); return typeof v; });
t(() => { const v: Session = anyv(process.env); return typeof v; });
t(() => { const v: Session = anyv(Bun); return typeof v; });
t(() => { const v: Session = anyv(globalThis); return typeof v; });
t(() => { const v: Session = anyv(Math); return typeof v; });
t(() => { const v: Session = anyv((function () { return arguments; })()); return typeof v; });
t(() => keep.length);
export {};

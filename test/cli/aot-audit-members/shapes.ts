// A fixture of aot-audit-members.test.ts. One case a line: `t(() => { .. });`. Each runs three times: plain, in an --aot executable, under --aot-audit.
declare const Bun: any, process: any, Buffer: any;
const far = Bun.argv.length > 99 ? 1 : 0;
const anyv = (v: unknown): any => [v, 0][far];
const json = (text: string): any => JSON.parse(text);
let at = 0;
interface Ctx { cwd: string }
interface Session { type: "session"; id: string; ctx: Ctx }
interface Opt { id: string; ctx?: Ctx }
interface Nest { a: { b: { c: number } } }
interface Lists { items: Ctx[] }
type U = { kind: "a"; x: Ctx } | { kind: "b"; y: Ctx };
class K { constructor(public ctx: Ctx) {} }
const fresh = (id: string): Session => ({ type: "session", id, ctx: { cwd: "/" } });
const keep: unknown[] = [fresh("a"), { id: "o", ctx: { cwd: "/" } } as Opt, { a: { b: { c: 1 } } } as Nest, { items: [{ cwd: "/" }] } as Lists, { kind: "a", x: { cwd: "/" } } as U, { kind: "b", y: { cwd: "/" } } as U, new K({ cwd: "/" })];
function t(f: () => unknown) { at++; let said: string; try { const v = f(); said = typeof v + " " + String(v); } catch (e) { said = "threw " + (e as Error).constructor.name + (process.env.WHY ? " " + String((e as Error).message).replace(/ \(bun --aot[^)]*\)/, "").replace(/\n */g, " ~ ") : ""); } console.log(at, said); }
t(() => { const s: Session = json('{"type":"session","id":"y","ctx":{"cwd":"/"}}'); return s.id; });
t(() => { const s: Session = json('{"id":"y"}'); return s.id; });
t(() => { const s: Session = json('{"type":"session","id":"y"}'); return s.id; });
t(() => { const s: Session = json('{"type":"session","id":1,"ctx":{"cwd":"/"}}'); return s.id; });
t(() => { const s: Session = json('{"type":"other","id":"y","ctx":{"cwd":"/"}}'); return s.id; });
t(() => { const s: Session = json('{"type":"session","id":"y","ctx":{}}'); return s.id; });
t(() => { const s: Session = json('{"type":"session","id":"y","ctx":{"cwd":1}}'); return s.id; });
t(() => { const s: Session = json('{"type":"session","id":"y","ctx":null}'); return s.id; });
t(() => { const s: Session = json('{"type":"session","id":"y","ctx":[]}'); return s.id; });
t(() => { const s: Session = json('{"type":"session","id":"y","ctx":{"cwd":"/"},"more":1}'); return s.id; });
t(() => { const s: Session = json('{"type":"session","id":"y","ctx":{"cwd":"/","more":1}}'); return s.id; });
t(() => { const s: Session = json('{"ctx":{"cwd":"/"},"id":"y","type":"session"}'); return s.id; });
t(() => { const s: Session = anyv({ type: "session", id: "y", ctx: { cwd: "/" } }); return s.id; });
t(() => { const s: Session = anyv({ type: "session", id: "y" }); return s.id; });
t(() => { const s: Session = anyv(Object.create({ type: "session", id: "y", ctx: { cwd: "/" } })); return s.id; }); // silent: another prototype and not native: `new` on a class or a function of the program may have made it
t(() => { const s: Session = anyv(Object.assign(Object.create(null), { type: "session", id: "y", ctx: { cwd: "/" } })); return s.id; });
t(() => { const s: Session = anyv(Object.freeze({ type: "session", id: "y", ctx: { cwd: "/" } })); return s.id; });
t(() => { const s: Session = anyv({ type: "session", get id() { return "y"; }, ctx: { cwd: "/" } }); return s.id; }); // silent: what typed code has made goes by its layout in a build, which the audit does not know
t(() => { const s: Session = anyv(Object.defineProperty({ type: "session", ctx: { cwd: "/" } }, "id", { value: "y", enumerable: false, writable: true, configurable: true })); return s.id; }); // silent: a hidden property of its own: the audit sees its tag by the bit a Structure keeps for one
t(() => { const s: Session = anyv(new Map()); return typeof s; });
t(() => { const s: Session = anyv([]); return typeof s; });
t(() => { const s: Session = anyv(() => 1); return typeof s; });
t(() => { const s: Session = anyv(new (class X { type = "session"; id = "y"; ctx = { cwd: "/" }; })()); return s.id; }); // silent: another prototype and not native: `new` on a class or a function of the program may have made it
t(() => { const s: Session = anyv(new Proxy({ type: "session", id: "y", ctx: { cwd: "/" } }, {})); return s.id; });
t(() => { const o: Opt = json('{"id":"y"}'); return o.id; });
t(() => { const o: Opt = json('{"id":"y","ctx":{"cwd":"/"}}'); return o.id; });
t(() => { const o: Opt = json('{"id":"y","ctx":{}}'); return o.id; });
t(() => { const o: Opt = json('{"id":"y","ctx":null}'); return o.id; });
t(() => { const o: Opt = anyv({ id: "y", ctx: undefined }); return o.id; });
t(() => { const o: Opt = json('{}'); return String(o.id); });
t(() => { const n: Nest = json('{"a":{"b":{"c":1}}}'); return n.a.b.c; });
t(() => { const n: Nest = json('{"a":{"b":{"c":"x"}}}'); return typeof n; });
t(() => { const n: Nest = json('{"a":{"b":{}}}'); return typeof n; });
t(() => { const n: Nest = json('{"a":{}}'); return typeof n; });
t(() => { const l: Lists = json('{"items":[{"cwd":"/"}]}'); return l.items.length; });
t(() => { const l: Lists = json('{"items":[{}]}'); return l.items.length; });
t(() => { const l: Lists = json('{"items":[1]}'); return l.items.length; });
t(() => { const l: Lists = json('{"items":{}}'); return typeof l; });
t(() => { const l: Lists = json('{}'); return typeof l; });
t(() => { const u: U = json('{"kind":"a","x":{"cwd":"/"}}'); return u.kind; });
t(() => { const u: U = json('{"kind":"b","y":{"cwd":"/"}}'); return u.kind; });
t(() => { const u: U = json('{"kind":"a","y":{"cwd":"/"}}'); return u.kind; });
t(() => { const u: U = json('{"kind":"c","x":{"cwd":"/"}}'); return u.kind; });
t(() => { const u: U = json('{"kind":"a"}'); return u.kind; });
t(() => { const u: U = json('{"x":{"cwd":"/"}}'); return typeof u; });
t(() => { const k: K = json('{"ctx":{"cwd":"/"}}'); return typeof k; });
t(() => { const k: K = anyv(new K({ cwd: "/" })); return typeof k; });
t(() => { const s = json('{"id":"y"}') as Session; return s.id; });
t(() => { const s = json('{"type":"session","id":"y","ctx":{"cwd":"/"}}') as Session; return s.ctx.cwd; });
t(() => { const d = json('{"id":"y"}'); const s = d as Session; return s.id; });
t(() => { const d = json('{"id":"y"}'); const s = d as Session; return s.ctx; });
t(() => { function f(): Session { return json('{"id":"y"}'); } return f().id; });
t(() => { function f(s: Session) { return s.id; } return f(json('{"id":"y"}')); });
t(() => { function f(s: Session) { return s.id; } return (f as any)(json('{"id":"y"}')); });
t(() => { const box: { s: Session } = { s: fresh("b") }; box.s = json('{"id":"y"}'); return box.s.id; });
t(() => { const list: Session[] = json('[{"id":"y"}]'); return list[0].id; });
t(() => { const list: Session[] = [fresh("c")]; list.push(json('{"id":"y"}')); return list[1].id; });
t(() => { const list: Session[] = [fresh("c")]; list[0] = json('{"id":"y"}'); return list[0].id; });
t(() => { const m = new Map<string, Session>(); m.set("a", json('{"id":"y"}')); return m.get("a")!.id; });
t(() => { const s: Session | null = json('{"id":"y"}'); return s!.id; });
t(() => { const s: Session | string = json('{"id":"y"}'); return typeof s; });
t(() => { const s: Session | undefined = json('null'); return typeof s; });
t(() => { const d = json('{"type":"session","id":"y","ctx":{"cwd":"/"}}'); const other = d; const s: Session = d; other.id = "z"; return s.id; });
t(() => { const d = json('{"type":"session","id":"y","ctx":{"cwd":"/"},"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7,"h":8}'); const s: Session = d; return s.id; });
t(() => keep.length);
export {};

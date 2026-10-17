// A fixture of aot-audit-members.test.ts. One case a line: `t(() => { .. });`. Each runs three times: plain, in an --aot executable, under --aot-audit.
// What typed code has made, redefined through `any`, in a program that freezes something of unknown type: every layout may be frozen. Each twice: `id` read only, then a member hidden: that is taken where the member may be absent.
declare const Bun: any, process: any;
const far = Bun.argv.length > 99 ? 1 : 0;
const anyv = (v: unknown): any => [v, 0][far];
let at = 0;
const seen: unknown[] = [];
function look(o: unknown) { seen.push(Object.keys(anyv(o)).length); }
class L0 { id = "k"; late!: number; }
class L1 { id = "k"; late: number; constructor() { look(this); this.late = 1; } }
class L2 { id = "k"; n = 1; }
class L3 { id = "k"; late: number; constructor(c: boolean) { if (c) { this.late = 1; return; } look(this); this.late = 2; } }
interface A4 { id: string; o?: string } interface B4 { id: string; o: string } function makeB4(): B4 { return { id: "k", o: "o" }; } function makeA4(): A4 { return { id: "k" }; } function viewA4(a: A4) { return String(a.o); }
interface R5 { id: string; n: number } function make5(): R5 { return { id: "k", n: 1 }; } function n5(o: R5) { return o.n; }
class Base6 { id = "k"; } class Derived6 extends Base6 { more = 1; } function id6(o: Base6) { return o.id; }
class L7 { id = "k"; o?: string; }
class L8 { id = "k"; o?: string = "o"; }
class L9 { id = "k"; o?: string; constructor(c: boolean) { if (c) this.o = "o"; } }
function t(f: () => unknown) { at++; let said: string; try { const v = f(); said = typeof v + " " + String(v); } catch (e) { said = "threw " + (e as Error).constructor.name + (process.env.WHY ? " " + String((e as Error).message).split("\n").join(" ~ ") : ""); } console.log(at, said); }
t(() => { const o = new L0(); Object.defineProperty(anyv(o), "id", { value: "y", writable: false, enumerable: true, configurable: true }); return o.id; }); // THE FLAG: `late!: number`, never stored at birth: `id` read only
t(() => { const o = new L0(); Object.defineProperty(anyv(o), "late", { value: 1, writable: true, enumerable: false, configurable: true }); return o.late; }); // `late!: number`, never stored at birth: `late` HIDDEN
t(() => { const o = new L1(); Object.defineProperty(anyv(o), "id", { value: "y", writable: false, enumerable: true, configurable: true }); return o.id; }); // THE FLAG: stored behind a call that sees `this`: `id` read only
t(() => { const o = new L1(); Object.defineProperty(anyv(o), "late", { value: 5, writable: true, enumerable: false, configurable: true }); return o.late; }); // stored behind a call that sees `this`: `late` HIDDEN
t(() => { const o = new L2(); Object.defineProperty(anyv(o), "id", { value: "y", writable: false, enumerable: true, configurable: true }); return o.id; }); // THE FLAG: THE CONTROL: a member with an initializer: `id` read only
t(() => { const o = new L2(); Object.defineProperty(anyv(o), "n", { value: 5, writable: true, enumerable: false, configurable: true }); return o.n; }); // THE CONTROL: a member with an initializer: `n` HIDDEN
t(() => { const o = new L3(far === 1); Object.defineProperty(anyv(o), "id", { value: "y", writable: false, enumerable: true, configurable: true }); return o.id; }); // THE FLAG: stored on two roads: `id` read only
t(() => { const o = new L3(far === 1); Object.defineProperty(anyv(o), "late", { value: 5, writable: true, enumerable: false, configurable: true }); return o.late; }); // stored on two roads: `late` HIDDEN
t(() => { const o = makeB4(); Object.defineProperty(anyv(o), "id", { value: "y", writable: false, enumerable: true, configurable: true }); return o.id; }); // THE FLAG: a record that fits a class whose `o?` is stored (L8, L9: without them the executable throws: siblings.ts): `id` read only
t(() => { const o = makeB4(); Object.defineProperty(anyv(o), "o", { value: "h", writable: true, enumerable: false, configurable: true }); return o.o + viewA4(o) + viewA4(makeA4()); }); // a record that fits a class whose `o?` is stored (L8, L9: without them the executable throws: siblings.ts): `o` HIDDEN // silent: a hidden member that a wider type calls optional: whether it may be redefined only the engine knows
t(() => { const o = make5(); Object.defineProperty(anyv(o), "id", { value: "y", writable: false, enumerable: true, configurable: true }); return o.id; }); // THE FLAG: THE CONTROL: a record: a required member: `id` read only
t(() => { const o = make5(); Object.defineProperty(anyv(o), "n", { value: 5, writable: true, enumerable: false, configurable: true }); return n5(o); }); // THE CONTROL: a record: a required member: `n` HIDDEN
t(() => { const o = new Derived6(); Object.defineProperty(anyv(o), "id", { value: "y", writable: false, enumerable: true, configurable: true }); return o.id; }); // THE FLAG: a derived class: its own member: `id` read only
t(() => { const o = new Derived6(); Object.defineProperty(anyv(o), "more", { value: 5, writable: true, enumerable: false, configurable: true }); return o.more + id6(o); }); // a derived class: its own member: `more` HIDDEN
t(() => { const o = new L7(); Object.defineProperty(anyv(o), "id", { value: "y", writable: false, enumerable: true, configurable: true }); return o.id; }); // THE FLAG: an optional member without an initializer: `id` read only
t(() => { const o = new L7(); Object.defineProperty(anyv(o), "o", { value: "h", writable: true, enumerable: false, configurable: true }); return String(o.o); }); // an optional member without an initializer: `o` HIDDEN
t(() => { const o = new L8(); Object.defineProperty(anyv(o), "id", { value: "y", writable: false, enumerable: true, configurable: true }); return o.id; }); // THE FLAG: THE OTHER CONTROL: an optional member with an initializer (the fixture's KO): `id` read only
t(() => { const o = new L8(); Object.defineProperty(anyv(o), "o", { value: "h", writable: true, enumerable: false, configurable: true }); return String(o.o); }); // THE OTHER CONTROL: an optional member with an initializer (the fixture's KO): `o` HIDDEN
t(() => { const o = new L9(far === 1); Object.defineProperty(anyv(o), "id", { value: "y", writable: false, enumerable: true, configurable: true }); return o.id; }); // THE FLAG: an optional member stored on one road: `id` read only
t(() => { const o = new L9(far === 1); Object.defineProperty(anyv(o), "o", { value: "h", writable: true, enumerable: false, configurable: true }); return String(o.o); }); // an optional member stored on one road: `o` HIDDEN
t(() => { const v = Object.freeze(JSON.parse('{"a":1}')); return typeof v; }); // THE PROGRAM FREEZES SOMETHING OF UNKNOWN TYPE

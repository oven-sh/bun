// Getters and setters in literals and classes: descriptors, inheritance, `super`, a getter that replaces itself.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
type Shape = { w: number; h: number; readonly area: number };
class Temp { c = 0; get f(): number { return this.c * 9 / 5 + 32 } set f(v: number) { this.c = (v - 32) * 5 / 9 } static get zero(): Temp { return new Temp() } }
class Lazy { calls = 0; get v(): number { this.calls++; Object.defineProperty(this, "v", { value: 7, writable: false }); return 7 } }
function area(s: Shape): number { return s.area }
row("a getter in a literal held to a type with that field", () => { const s: Shape = { w: 2, h: 3, get area() { return this.w * this.h } }; s.w = 5; return area(s) + " " + Object.keys(s).join() + " " + JSON.stringify(s) });
row("accessors of a class", () => { const t = new Temp(); t.f = 212; return t.c + " " + t.f + " " + Object.keys(t).join() + " " + ("f" in t) + " " + Object.hasOwn(t, "f") + " " + Temp.zero.c });
row("the accessor's descriptor", () => { const d = Object.getOwnPropertyDescriptor(Temp.prototype, "f")!; return typeof d.get + " " + typeof d.set + " " + d.enumerable + " " + d.configurable });
row("a getter that replaces itself by a value", () => { const l = new Lazy(); return l.v + " " + l.v + " " + l.calls + " " + Object.keys(l).join() });
row("a getter inherited through Object.create", () => { const t = new Temp(); t.c = 100; const heir = Object.create(t); return heir.f + " " + heir.c });
row("a setter only", () => { let seen = 0; const o = { set v(x: number) { seen = x } }; o.v = 4; return seen + " " + hide(o).v });
row("a getter that throws", () => { const o = { get v(): number { throw new RangeError("no") } }; return o.v });
row("super in an accessor", () => { class Hot extends Temp { get f(): number { return super.f + 1 } set f(v: number) { super.f = v } } const h = new Hot(); h.f = 32; return h.f + " " + h.c });

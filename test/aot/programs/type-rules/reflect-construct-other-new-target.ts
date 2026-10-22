// A constructor function with a declared `this` is constructed with a new.target that has another prototype: the object inherits from that prototype.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
interface T { n: number }
function F(this: T, n: number) { this.n = n }
function Other() {}
row("Reflect.construct with another new.target", () => { const made = new (F as any)(1); const o = Reflect.construct(made.constructor, [5], Other); return o.n + " " + (Object.getPrototypeOf(o) === Other.prototype) });

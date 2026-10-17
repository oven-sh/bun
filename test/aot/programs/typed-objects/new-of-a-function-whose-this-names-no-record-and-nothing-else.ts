// `new` of a plain function that a constant holds under a cast to a type with a construct signature. What it makes has the function's own prototype object and satisfies the type the signature names: it is not refused.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
interface Bare { held: unknown }
interface BareClass { new (value: unknown): Bare; prototype: object }
const plain = function (this: any, value: unknown) { this.held = value } as unknown as BareClass;
row("read at once", () => new plain(1).held);
row("held by a constant", () => { const made: Bare = new plain(2); return made.held });

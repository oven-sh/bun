// `new` of a plain function that a constant holds under a cast to a type with a construct signature. What it makes has the function's own prototype object and satisfies the type the signature names: it is not refused.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
interface Bare { held: number }
interface BareClass { new (value: number): Bare; prototype: object }
const plain = function (this: any, value: number) { this.held = value } as unknown as BareClass;
row("read at once", () => new plain(1).held + 1);
row("held by a constant", () => { const made: Bare = new plain(2); return made.held + 1 });
row("handed on", () => { const twice = (bare: Bare): number => bare.held * 2; return twice(new plain(3)) });
row("its prototype is the function's", () => Object.getPrototypeOf(new plain(4)) === plain.prototype);
row("instanceof", () => (new plain(5) as object) instanceof (plain as unknown as Function));
row("constructor", () => (new plain(6) as unknown as { constructor: unknown }).constructor === plain);
row("keys", () => Object.keys(new plain(7)).join());
row("beside a literal of the same type", () => { const list: Bare[] = [new plain(8), { held: 9 }]; return list.map(each => each.held).join() });
row("stored to", () => { const made = new plain(10); made.held += 1; return made.held });
row("copied", () => { const copy: Bare = { ...new plain(11) }; return copy.held + " " + (Object.getPrototypeOf(copy) === Object.prototype) });
const untyped = function (this: any) { this.other = 1 } as unknown as { new (): object };
row("a signature that names object", () => Object.keys(new untyped()).join());
interface Typed { held: number }
const typed = function (this: Typed, value: number) { this.held = value } as unknown as { new (value: number): Typed };
row("a function whose this names the record", () => new typed(12).held + 1);
row("and its prototype", () => Object.getPrototypeOf(new typed(13)) === (typed as unknown as { prototype: object }).prototype);

// `new` of a function that a constant holds under a cast to a type with a construct signature: what plain JavaScript does, whatever the function is expected to be.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
interface Held { held: unknown; describe(): string }
interface HeldClass { new (value: unknown): Held; prototype: object }
interface Bare { held: unknown }
interface BareClass { new (value: unknown): Bare; prototype: object }
const make = (label: string): ((value: unknown) => Held) => {
  const Proto = { describe(this: Held): string { return label + "(" + String(this.held) + ")" } };
  const Impl = function (this: any, value: unknown) { this.held = value } as unknown as HeldClass;
  Impl.prototype = Proto;
  return function (value: unknown) { return new Impl(value) };
};
const first = make("first"), second = make("second");
row("made", () => first(1).describe() + " " + second("two").describe());
row("own and inherited", () => { const made = first(1); return Object.keys(made).join() + " " + ("describe" in made) + " " + Object.prototype.hasOwnProperty.call(made, "describe") });
row("each has its own prototype", () => Object.getPrototypeOf(first(1)) !== Object.getPrototypeOf(second(1)));
row("many", () => { let text = ""; for (let i = 0; i < 5; i++) text += first(i).describe(); return text });
const returning = function (this: any, value: unknown) { this.held = value; return { held: "another", describe: () => "returned" } } as unknown as HeldClass;
row("a constructor that returns an object", () => new returning(1).describe());
const primitive = function (this: any, value: unknown) { this.held = value; return 5 } as unknown as HeldClass;
primitive.prototype = { describe(this: Held) { return "kept " + String(this.held) } };
row("a constructor that returns a number", () => new primitive(1).describe());
const arrow = ((value: unknown) => ({ held: value })) as unknown as BareClass;
row("an arrow function is no constructor", () => new arrow(1).held);
const late = function (this: any, value: unknown) { this.held = value } as unknown as HeldClass;
row("the prototype is read at each call", () => { late.prototype = { describe: () => "one" }; const one = new late(0).describe(); late.prototype = { describe: () => "two" }; return one + " " + new late(0).describe() });
const bare = function (this: any, value: unknown) { this.held = value } as unknown as BareClass;
row("a prototype that is no object", () => { (bare as { prototype: unknown }).prototype = 5; return Object.getPrototypeOf(new bare(0)) === Object.prototype });

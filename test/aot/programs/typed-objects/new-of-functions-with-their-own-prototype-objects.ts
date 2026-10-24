// `new` of plain functions, cast to a type with a construct signature, that keep the prototype object they were born with: new.target, and a variable that holds one function and then another.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
interface Bare { held: unknown }
interface BareClass { new (value: unknown): Bare; prototype: object }
const target = function (this: any) { this.held = (new.target as unknown) === target } as unknown as BareClass;
row("new.target", () => new target(0).held);
let changing = function (this: any, value: unknown) { this.held = "before" } as unknown as BareClass;
row("a variable that changes, before", () => new changing(0).held);
changing = function (this: any, value: unknown) { this.held = "after" } as unknown as BareClass;
row("and after", () => new changing(0).held);

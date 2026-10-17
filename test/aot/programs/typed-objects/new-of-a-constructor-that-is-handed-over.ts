// The function reaches `new` as an argument: nothing at the `new` says which function it is.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
interface Bare { held: unknown }
interface BareClass { new (value: unknown): Bare }
const plain = function (this: any, value: unknown) { this.held = value } as unknown as BareClass;
const build = (constructor: BareClass, value: unknown): Bare => new constructor(value);
row("handed over", () => build(plain, 1).held);
row("out of a list", () => [plain].map(each => new each(2).held).join());

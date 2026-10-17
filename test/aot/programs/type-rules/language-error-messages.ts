// The messages of the TypeErrors, ReferenceErrors, RangeErrors and SyntaxErrors that the language itself throws.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
type Item = { id: number; n: number; sub?: { v: number } };
row("a property of undefined", () => { const t: Item = { id: 1, n: 1 }; return hide(t.sub).v });
row("a property of undefined, typed", () => { const t: Item = { id: 1, n: 1 }; return t.sub!.v });
row("a property of null", () => hide(null).x);
row("a store to undefined", () => { hide(undefined).x = 1; return 0 });
row("a call of what is no function", () => hide({ f: 1 }).f());
row("a call of what is not there", () => hide({}).g());
row("new of what is no constructor", () => new (hide(() => 1))());
row("a variable in its dead zone", () => { const f = () => late; const v = f(); let late = 1; return v + late });
row("a constant stored to", () => { const c = 1; hide(() => { eval("0") }); (0, eval)("1"); return c });
row("what is not iterable", () => { for (const x of hide(5)) return x; return 0 });
row("a pattern on undefined", () => { const { a } = hide(undefined); return a });
row("in of what is no object", () => "a" in hide(5));
row("instanceof of what is no function", () => hide({}) instanceof hide(5));
row("BigInt mixed with a number", () => hide(1n) + hide(1));
row("a Symbol to a string", () => "" + hide(Symbol("s")));
row("the stack is spent", () => { const f = (n: number): number => f(n + 1) + 1; return f(0) });
row("an array of a bad length", () => new Array(hide(-1)).length);
row("JSON.parse of what is none", () => parse("{"));

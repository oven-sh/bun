// A store to `Error.prototype.name` takes effect: a built-in that is not always locked and that the program writes stays writable. `Function.prototype` takes no new name in a compiled program: every string key of it is fixed, present or absent.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.constructor.name : String(e))) } }
function hide(v: unknown): any { return v }
row("Error.prototype.name", () => { (Error.prototype as any).name = "X"; return new Error("m").name + " " + String(new Error("m")) });
row("Function.prototype.mine", () => { (Function.prototype as any).mine = 1; return (row as any).mine });

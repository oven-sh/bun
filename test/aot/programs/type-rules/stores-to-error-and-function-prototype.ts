// Stores to `Error.prototype.name` and to a new property of `Function.prototype`.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
row("Error.prototype.name", () => { (Error.prototype as any).name = "X"; return new Error("m").name + " " + String(new Error("m")) });
row("Function.prototype.mine", () => { (Function.prototype as any).mine = 1; return (row as any).mine });

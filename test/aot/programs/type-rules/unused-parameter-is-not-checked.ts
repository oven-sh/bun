// A parameter that is never read is not type-checked. Each function is called through `any` with a string for `a: number`: it throws exactly when the function reads the parameter, passes it on, captures it, or uses `arguments`.
const wrong: any = "wrong";
const row = (name: string, f: () => unknown) => { try { const result = f(); console.log(name, typeof result === "function" ? "function" : String(result)); } catch (e) { console.log(name, "throws", (e as Error).constructor.name); } };
function ignores(a: number): number { return 1; }
function reads(a: number): number { return a; }
function passesOn(a: number): number { return ignores(a); }
function usesArguments(a: number): number { return arguments.length; }
function readsArguments(a: number): unknown { return arguments[0]; }
function hasRest(a: number, ...rest: number[]): number { return rest.length; }
function defaultReadsIt(a: number, b: number = a): number { return 2; }
function hasDefault(a: number = 5): number { return 3; }
function destructures({ x }: { x: number }): number { return 4; }
function captures(a: number): () => number { return () => a; }
function capturesUnused(a: number): () => number { return () => 5; }
function typeofOnly(a: number): string { return typeof a; }
function assignsOnly(a: number): number { a = 6; return a; }
const table: Record<string, Function> = { ignores, reads, passesOn, usesArguments, readsArguments, hasRest, defaultReadsIt, hasDefault, destructures, captures, capturesUnused, typeofOnly, assignsOnly };
for (const name of Object.keys(table)) row(name, () => table[name](wrong));

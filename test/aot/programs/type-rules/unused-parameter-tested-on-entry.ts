// A parameter with a written type is tested on entry, whether or not the body uses it. Each function is called as a function value with a string for `a: number`: every call throws a TypeError, also where the parameter is never read, only assigned, or has a default. The neighbors below have no written type to test: a parameter typed by its context, `any`, `unknown`, a type parameter, a type taken from a default. They return as in plain Bun.
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
const typedByContext: (a: number) => number = a => 7;
function declaredAny(a: any): number { return 8; }
function declaredUnknown(a: unknown): number { return 9; }
function generic<T>(a: T): number { return 10; }
function constrained<T extends number>(a: T): number { return 11; }
function typedByDefault(a = 5): number { return 12; }
const table: Record<string, Function> = { ignores, reads, passesOn, usesArguments, readsArguments, hasRest, defaultReadsIt, hasDefault, destructures, captures, capturesUnused, typeofOnly, assignsOnly, typedByContext, declaredAny, declaredUnknown, generic, constrained, typedByDefault };
for (const name of Object.keys(table)) row(name, () => table[name](wrong));

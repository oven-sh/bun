// `x as T` never converts. A type that a string satisfies (ArrayLike, Iterable, { length: number }, String), alone or in a union, takes a string as it is.
// A primitive that does not satisfy the type throws a TypeError. A type parameter tests nothing.
declare const console: { log(...values: unknown[]): void };
interface HasLength { length: number }
const values: unknown[] = [123, 12.5, true, false, 10n, "ab"];
function attempt(label: string, run: (value: unknown) => unknown): void {
  console.log(label + ": " + values.map(value => { try { const got = run(value); return typeof got === "bigint" ? got + "n" : JSON.stringify(got); } catch (error) { return "threw " + (error as Error).name; } }).join(" "));
}
function isArrayLike(value?: any): boolean { return value != null && typeof value !== "function" && typeof (value as ArrayLike<unknown>).length === "number"; }
function items(collection: unknown): string[] { const list = collection as ArrayLike<unknown>; return Array.from(list).map(String); }
function generic<T extends ArrayLike<unknown>>(value: unknown): string { return typeof (value as T); }

attempt("isArrayLike", value => isArrayLike(value));
attempt("items", value => items(value));
attempt("ArrayLike<unknown>", value => typeof (value as ArrayLike<unknown>));
attempt("{ length: number }", value => typeof (value as { length: number }));
attempt("HasLength", value => typeof (value as HasLength));
attempt("Iterable<string>", value => typeof (value as Iterable<string>));
attempt("String", value => typeof (value as String));
attempt("string | object", value => typeof (value as string | object));
attempt("readonly unknown[] | string", value => typeof (value as readonly unknown[] | string));
attempt("string | ArrayLike<string>", value => typeof (value as string | ArrayLike<string>));
attempt("number | Date", value => typeof (value as number | Date));
attempt("a type parameter", value => generic(value));
attempt("length through the cast", value => (value as ArrayLike<unknown>).length);
attempt("length through { length: number }", value => (value as { length: number }).length);
attempt("the value itself", value => value as ArrayLike<unknown>);
attempt("double cast", value => typeof (value as unknown as Iterable<unknown>));
attempt("from any", value => { const given: any = value; return typeof (given as ArrayLike<unknown>); });

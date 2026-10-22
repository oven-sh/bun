// With `strictNullChecks` a type such as `number` excludes undefined and null for the checker only. At run time both pass every written type and stay what they are, and a test for them that the checker considers needless still answers. A value of another kind throws as without the option.
const nothing: any = undefined;
const empty: any = null;
const text: any = "text";
interface Row { id: number; name: string }
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}
function kind(n: number): string { return n === undefined ? "undefined" : n === null ? "null" : typeof n; }
function nameOf(row: Row): string { return row === null ? "no row" : row.name ?? "no name"; }
function result(): string { return nothing; }

attempt("undefined for a parameter of type number", () => kind(nothing));
attempt("null for a parameter of type number", () => kind(empty));
attempt("a string for a parameter of type number", () => kind(text));
attempt("null for an object type", () => nameOf(empty));
attempt("a field of type string that is missing", () => nameOf({ id: 1 } as any));
attempt("null in a variable of type number", () => { const n: number = empty; return n; });
attempt("undefined as a result of type string", () => result());
attempt("undefined in a variable of type number | null", () => { const n: number | null = nothing; return n; });
attempt("null in an element of number[]", () => { const list: number[] = [1]; list[0] = empty; return list[0]; });

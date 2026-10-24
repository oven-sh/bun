// A type that the checker only inferred tests nothing. Below each case stands the same code with the type written, and that one throws.
const text: any = "text";
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}
class Inferred { level = 0; }
class Written { level: number = 0; }
function inferredResult() { let n = 0; n = text; return n; }
function writtenResult(): number { let n = 0; n = text; return n; }
function inferredDefault(n = 0) { return typeof n; }
function writtenDefault(n: number = 0) { return typeof n; }
const callWithText = (f: (n: number) => string): string => (f as any)(text);

attempt("a variable typed by its initializer", () => { let n = 0; n = text; return typeof n; });
attempt("a variable, written", () => { let n: number = 0; n = text; return typeof n; });
attempt("a class field typed by its initializer", () => { const m = new Inferred(); m.level = text; return typeof m.level; });
attempt("a class field, written", () => { const m = new Written(); m.level = text; return typeof m.level; });
attempt("a property of a literal", () => { const o = { n: 0 }; o.n = text; return typeof o.n; });
attempt("a property of a literal, written", () => { const o: { n: number } = { n: 0 }; o.n = text; return typeof o.n; });
attempt("an element of a literal", () => { const list = [1, 2]; list[0] = text; return typeof list[0]; });
attempt("an element of a literal, written", () => { const list: number[] = [1, 2]; list[0] = text; return typeof list[0]; });
attempt("a result", () => typeof inferredResult());
attempt("a result, written", () => typeof writtenResult());
attempt("a parameter typed by its default", () => inferredDefault(text));
attempt("a parameter with a default, written", () => writtenDefault(text));
attempt("a callback parameter typed by its context", () => callWithText(n => typeof n));
attempt("a callback parameter, written", () => callWithText((n: number) => typeof n));

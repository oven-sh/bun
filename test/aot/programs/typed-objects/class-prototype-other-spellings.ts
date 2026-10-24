// `C.prototype` is declared to be a `C` and is none. However it is spelled and wherever it is kept, a method that is replaced on it is replaced.
const attempt = (label: string, f: () => unknown): void => {
  try {
    console.log(label + ": " + f());
  } catch (e) {
    console.log(label + ": throws " + (e as Error).name);
  }
};
class Dots { m(): string { return "Dots.m"; } }
attempt("dots", () => { const made = new Dots(), was = made.m(); (Dots.prototype as any).m = () => "patched"; return [was, made.m(), new Dots().m()]; });
class Brackets { m(): string { return "Brackets.m"; } }
attempt("prototype in brackets", () => { const made = new Brackets(), was = made.m(); (Brackets["prototype"] as any).m = () => "patched"; return [was, made.m(), new Brackets().m()]; });
class Both { m(): string { return "Both.m"; } }
attempt("both in brackets", () => { const made = new Both(), was = made.m(); (Both["prototype"] as any)["m"] = () => "patched"; return [was, made.m(), new Both().m()]; });
class Typed { m(): string { return "Typed.m"; } }
attempt("in brackets, typed", () => { const made = new Typed(), was = made.m(); Typed["prototype"].m = () => "patched"; return [was, made.m(), new Typed().m()]; });
class Kept { n = 1; m(): string { return "Kept.m" + this.n; } }
attempt("kept in a constant", () => { const made = new Kept(), was = made.m(); const kept = Kept.prototype; kept.m = () => "patched"; return [was, made.m(), new Kept().m(), kept.n, kept instanceof Kept, Object.keys(kept).length]; });
class Annotated { n = 1; m(): string { return "Annotated.m" + this.n; } }
attempt("kept under its declared type", () => { const made = new Annotated(), was = made.m(); const kept: Annotated = Annotated["prototype"]; kept.m = () => "patched"; return [was, made.m(), new Annotated().m(), kept instanceof Annotated]; });
class Handed { n = 2; m(): string { return "Handed.m"; } }
const describe = (object: Handed): string => object.m() + " " + (object instanceof Handed) + " " + Object.keys(object).length;
attempt("handed to a function", () => [describe(new Handed()), describe(Handed.prototype), describe(Handed["prototype"])]);
class Untouched { n = 3; m(): number { return this.n; } }
attempt("a class whose prototype object is only read", () => [typeof Untouched.prototype.m, Untouched["prototype"].m.call(new Untouched()), Object.getOwnPropertyNames(Untouched["prototype"]).join()]);

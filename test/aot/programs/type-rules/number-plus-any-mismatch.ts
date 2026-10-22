// An operator on a number and `any` that gives no number breaks the written type `number` of its result.
function onLeft(n: number, v: any): number {
  const r: number = n + v;
  return r;
}
function onRight(n: number, v: any): number {
  const r: number = v + n;
  return r;
}
function attempt(name: string, f: () => number): void {
  try {
    console.log(name, f());
  } catch (e) {
    console.log(name, e instanceof TypeError ? "TypeError" : "other " + e);
  }
}
attempt("number", () => onLeft(1, 2));
attempt("number on the right", () => onRight(1, 2));
attempt("double", () => onLeft(1, 0.5));
attempt("undefined", () => onLeft(1, undefined));
attempt("null", () => onLeft(1, null));
attempt("object with a number", () => onLeft(1, { valueOf() { console.log("valueOf ran"); return 2; } }));
attempt("string", () => onLeft(1, "2"));
attempt("string on the right", () => onRight(1, "2"));
attempt("object with a string", () => onLeft(1, { valueOf() { console.log("valueOf ran"); return "2"; } }));
attempt("BigInt", () => onLeft(1, 2n));

// A type guard or an assertion function tests nothing: what it claims about a value is a prediction, and a value of another kind goes on as in plain Bun. A type argument written at a call is tested at the call; an inferred one is a prediction.
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
const hide = (v: unknown): unknown => v
// Guards and assertion functions that lie.
function isNumber(v: unknown): v is number { return v !== null }
attempt("guard, a string as a number", () => { const v = hide("s"); if (isNumber(v)) return v + 1; return "no" })
attempt("guard, a boolean as a number", () => { const v = hide(true); if (isNumber(v)) return v * 2; return "no" })
attempt("guard, an object as a number", () => { const v = hide({}); if (isNumber(v)) return typeof v + v.toFixed; return "no" })
function assertString(v: unknown): asserts v is string {}
attempt("assertion function, a number as a string, length", () => { const v = hide(5); assertString(v); return v.length })
attempt("assertion function, a number as a string, +", () => { const v = hide(5); assertString(v); return v + "!" })
// A generic function of the program: inside it `T` names no kind. A type argument written at the call is tested at the call, and so is an annotated variable that takes the result. An inferred type argument tests nothing.
function cast<T>(v: unknown): T { return v as T }
function first<T>(items: T[]): T { return items[0] }
attempt("generic cast", () => cast<number>("s") + 1)
attempt("generic cast to a variable", () => { const n: number = cast("s"); return n + 1 })
attempt("generic element", () => first<number>(JSON.parse('["s"]')) + 1)
function prop<T, K extends keyof T>(o: T, k: K): T[K] { return o[k] }
attempt("plain data with a field of another kind", () => prop(JSON.parse('{"x":"s"}') as { x: number }, "x") + 1)

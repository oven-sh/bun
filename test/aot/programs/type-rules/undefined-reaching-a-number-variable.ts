// `undefined` that reaches a variable of type `number` through `!` or an out-of-bounds element throws a TypeError there.
function attempt(label: string, f: () => unknown) { try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) } }
interface Box { inner?: { value: number } }
const list: number[] = [1, 2], empty: Box = {}
attempt("undefined! into a number", () => { let position: number = undefined!; return position })
attempt("an element out of bounds into a number", () => { const n: number = list[5]; return n })
attempt("(x?.y)! asserts", () => (empty.inner?.value)!.toString())
attempt("the value of a written `as`, converted", () => { const n: number = empty.inner?.value as number; return n })

// `undefined` that reaches a variable of type `number` through `!`, an out-of-bounds element or `as number` passes and stays undefined.
function attempt(label: string, f: () => unknown) { try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) } }
interface Box { inner?: { value: number } }
const list: number[] = [1, 2], empty: Box = {}
attempt("undefined! into a number", () => { let position: number = undefined!; return position })
attempt("an element out of bounds into a number", () => { const n: number = list[5]; return n })
attempt("a method called on (x?.y)!", () => (empty.inner?.value)!.toString())
attempt("undefined through a written `as`", () => { const n: number = empty.inner?.value as number; return n })

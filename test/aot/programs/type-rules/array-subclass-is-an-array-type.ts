// An instance of a subclass of Array is an array: it passes where the array type `T[]` is declared, and `for...of` calls the iterator of its class.
class Sub extends Array<number> { *[Symbol.iterator](): Generator<number, undefined, unknown> { yield 100; yield 200 } }
class Plain extends Array<number> {}
function each(x: any) { const out: unknown[] = []; for (const v of x) out.push(v); return out.join() }
function total(a: number[]) { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return t }
function attempt(label: string, f: () => unknown) { try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) } }
attempt("Sub.from, whose type is number[]", () => each(Sub.from([1, 2])))
attempt("Plain.from, whose type is number[]", () => each(Plain.from([4, 5])))
attempt("new Sub, at its own type", () => { const s = new Sub(); s.push(1); return each(s) })
attempt("new Plain, at its own type", () => { const p = new Plain(); p.push(4, 5); return each(p) + " " + p.length })
attempt("new Plain, at number[]", () => { const p: number[] = new Plain(); p.push(4, 5); return each(p) })
attempt("new Plain, passed as number[]", () => { const p = new Plain(); p.push(4, 5); return total(p) })
attempt("new Plain, through any, at number[]", () => { const p: any = new Plain(); p.push(4, 5); const a: number[] = p; return a.length })
attempt("new Plain, through any, as number[]", () => { const p: any = new Plain(); p.push(4, 5); return (p as number[]).length })
export {};

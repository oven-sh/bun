// A typed function is called through `any` with arguments missing: a missing argument is `undefined`, which passes every written type, as in plain Bun.
function many(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number): number { return a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + i * 9 + j * 10 }
const indirect: any = many
try { indirect(1, 2); console.log("arguments missing: no error") } catch (e) { console.log("arguments missing:", e instanceof TypeError ? "TypeError" : "other " + e) }

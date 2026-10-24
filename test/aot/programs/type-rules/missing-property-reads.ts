// A missing value from a typed array, a destructuring pattern or a dictionary is undefined, and undefined passes where it enters a variable or a parameter of type `number`.
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
function twice(n: number): number { return n * 2 }
const i32 = new Int32Array([1, 2]), f64 = new Float64Array([0.5, NaN]), u8 = new Uint8Array(0)
attempt("Int32Array, past the end, variable", () => { const t: number = i32[2]; return t })
attempt("Float64Array, past the end, variable", () => { const t: number = f64[2]; return t })
attempt("Int32Array, -1, variable", () => { const t: number = i32[-1]; return t })
attempt("Uint8Array, empty, variable", () => { const t: number = u8[0]; return t })
attempt("Float64Array, past the end, parameter", () => twice(f64[2]))
attempt("Float64Array, NaN that is there", () => { const t: number = f64[1]; return t })
attempt("loop that runs one too far", () => { let t = 0, u = 0; for (let i = 0; i <= i32.length; i++) { const v = i32[i]; if (v === undefined) u++; else t += v } return t + "/" + u })
attempt("array pattern, more names than elements", () => { const [ta, tb, tc] = [1, 2] as number[]; return ta + tb + tc })
attempt("array pattern, with a default", () => { const [ta, tb, tc = 4] = [1, 2] as number[]; return ta + tb + tc })
const dict: Record<string, number> = { a: 1 }
attempt("dictionary, a key that is not there, variable", () => { const dz: number = dict["z"]; return dz })
attempt("dictionary, a key that is there, variable", () => { const da: number = dict["a"]; return da })

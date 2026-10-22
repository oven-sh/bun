// `number += any`: the sum has type `any` for TypeScript; if it is not a number, the assignment throws and nothing is stored.
const hide = (v: unknown): any => v
interface R { n: number; s: string; e: number | string }
const r: R = { n: 1, s: "a", e: 1 }
let total: number = 1
const nums: number[] = [1]
try { r.n += hide("x"); console.log("field: no error") } catch (e) { console.log("field:", e instanceof TypeError ? "TypeError" : "other " + e, r.n) }
try { total += hide("x"); console.log("variable: no error") } catch (e) { console.log("variable:", e instanceof TypeError ? "TypeError" : "other " + e, total) }
try { let local: number = 1; local += hide("x"); console.log("local: no error", local) } catch (e) { console.log("local:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { nums[0] += hide("x"); console.log("element: no error") } catch (e) { console.log("element:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { const n: number = nums[0]; console.log("read of the element: no error", n) } catch (e) { console.log("read of the element:", e instanceof TypeError ? "TypeError" : "other " + e) }
r.n += hide(2); total += hide(2); r.s += hide("b"); r.e += hide("x")
console.log("right", r.n, total, r.s, r.e)
// Declared number | string: the store fits. To the checker (tsc too) the variable is still narrowed to `number` by its initializer
// after `+= any`. That narrowing is a prediction, so the read tests nothing.
let wide: number | string = 1
try { wide += hide("s"); console.log("store to number | string: no error") } catch (e) { console.log("store to number | string:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(wide); console.log("read narrowed to number: no error") } catch (e) { console.log("read narrowed to number:", e instanceof TypeError ? "TypeError" : "other " + e) }

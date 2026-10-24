// A variable declared `number` or `boolean` without an initializer holds `undefined` until something is stored: a read yields it, and it passes where it enters a place declared `number` or `boolean`.
function kind(v: unknown): string { return v === undefined ? "undefined" : v === null ? "null" : typeof v }
function double(n: number): number { return n * 2 }
function orTen(n: number = 10): number { return n }

// A closure reads the variable before the assignment.
function closures(which: number): string {
  let n: number, b: boolean
  const reads: (() => unknown)[] = [() => kind(n), () => kind(b), () => double(n), () => b ? 1 : 0, () => orTen(n), () => n + 1, () => n === undefined]
  const before = String(reads[which]())
  n = 2; b = true
  return before
}
for (let which = 0; which < 7; which++) try { closures(which); console.log("closure " + which + ": no error") } catch (e) { console.log("closure " + which + ":", e instanceof TypeError ? "TypeError" : "other " + e) }

// `let x!: T` tests nothing, as `x!` does: a read while nothing has been stored yields undefined.
let moduleCount!: number
try { console.log(moduleCount); console.log("let x!: no error") } catch (e) { console.log("let x!:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(moduleCount + 1); console.log("let x!, added to: no error") } catch (e) { console.log("let x!, added to:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(orTen(moduleCount)); console.log("let x!, as an argument with a default: no error") } catch (e) { console.log("let x!, as an argument with a default:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(moduleCount ?? "none"); console.log("let x! ?? y: no error") } catch (e) { console.log("let x! ?? y:", e instanceof TypeError ? "TypeError" : "other " + e) }
moduleCount = 3
console.log(moduleCount + 1)

// A module variable read by a function that is called after the initializer-less `let` has run and before the first store.
function readLater(): string { return kind(later) + ":" + (later + 1) }
let later: number
try { console.log(readLater()); console.log("let without initializer: no error") } catch (e) { console.log("let without initializer:", e instanceof TypeError ? "TypeError" : "other " + e) }
later = 4
console.log(readLater())

// `var` is undefined from the start of its function.
function hoisted(flag: boolean, early: boolean): string {
  const get = () => v
  const first = early ? kind(get()) : "skipped"
  if (flag) { var v: number = 6 }
  return first + "," + double(get())
}
try { console.log(hoisted(true, true)); console.log("var, before: no error") } catch (e) { console.log("var, before:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(hoisted(true, false)); console.log("var, after: no error") } catch (e) { console.log("var, after:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(hoisted(false, false)); console.log("var, never stored: no error") } catch (e) { console.log("var, never stored:", e instanceof TypeError ? "TypeError" : "other " + e) }

// Each turn of a loop starts a fresh, unassigned variable.
function loop(): string {
  const readers: (() => string)[] = []
  for (let i = 0; i < 4; i++) {
    let seen: number
    readers.push(() => kind(seen) + (seen + i))
    if (i % 2) seen = i * 10
  }
  return readers.map(r => { try { return r() } catch (e) { return e instanceof TypeError ? "TypeError" : "other " + e } }).join()
}
console.log(loop())

// Only some paths assign.
interface Acc { total: number; text: string }
function paths(mode: number): string {
  let n: number, s: string
  const get = (): Acc => ({ total: n, text: s })
  if (mode > 0) n = mode
  if (mode > 1) s = "m" + mode
  return JSON.stringify(get())
}
for (const mode of [0, 1, 2]) try { console.log(paths(mode)); console.log("path " + mode + ": no error") } catch (e) { console.log("path " + mode + ":", e instanceof TypeError ? "TypeError" : "other " + e) }

// switch cases share one scope; try and finally.
function cases(): string {
  switch (0 as number) {
    case 0: let c: number; const r = () => kind(c); return r()
    default: c = 1; return String(c)
  }
}
try { console.log(cases()); console.log("let in a case: no error") } catch (e) { console.log("let in a case:", e instanceof TypeError ? "TypeError" : "other " + e) }
function tried(fail: boolean): string {
  let got: number
  const read = () => kind(got) + double(got)
  try { if (fail) throw new RangeError("x"); got = 1 } catch { return "caught " + read() }
  return read()
}
try { console.log(tried(false)); console.log("stored in try: no error") } catch (e) { console.log("stored in try:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(tried(true)); console.log("try left early: no error") } catch (e) { console.log("try left early:", e instanceof TypeError ? "TypeError" : "other " + e) }

// a missing element enters a place for a number.
try { const [d0, d1]: number[] = [1]; console.log(d0, d1); console.log("array pattern: no error") } catch (e) { console.log("array pattern:", e instanceof TypeError ? "TypeError" : "other " + e) }

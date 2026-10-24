// A variable declared `number` without an initializer holds `undefined`: a read gives undefined, which passes a result of type `number`.
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function cases(x: number): string {
  switch (x) {
    case 0: let c: number; const r = (): number => c; return String(r())
    case 1: return attempt(() => c)
    default: c = x; return String(c)
  }
}
try { console.log(cases(0)); console.log("number read before it is assigned, as the result of a function: no error") } catch (e) { console.log("number read before it is assigned, as the result of a function:", e instanceof TypeError ? "TypeError" : "other " + e) }
// The dead zone stays exact.
console.log(cases(1), attempt(() => cases(2)))
// A reference may be null or undefined: exact.
function references(late: boolean): string { let s: string; const r = (): string => s; if (late) s = "late"; return String(r()) }
console.log(references(false), references(true))

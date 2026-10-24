// Variables and constants that are read before their initializer has run.
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function readConst(): number { return tooEarly }
let r: string = "none"
try { r = String(readConst()) } catch (e) { r = "caught" }
console.log(r)
const tooEarly: number = Math.abs(-5) // not a constant expression: those are in type-rules/constant-tdz
console.log(readConst())
function innerZone(flag: boolean): string {
  const peek = () => inside
  const first = flag ? attempt(peek) : "skipped"
  let inside: number = 9
  return first + "," + peek() + "," + inside
}
console.log(innerZone(true), innerZone(false))
function cases(x: number): string {
  switch (x) {
    case 0: let c: number; const r = () => String(c); return r()
    case 1: return attempt(() => c)
    default: c = x; return String(c)
  }
}
console.log(cases(0), cases(1), attempt(() => cases(2)))

// Values of the right kind that are not among the constants their literal or enum type allows: a literal type promises the kind, so nothing throws.
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
const hide = (v: unknown): any => v
enum Level { Low, Mid, High }
// A numeric enum is tested as `number`: TypeScript lets any number into it.
attempt("enum, 0.5", () => { const l: Level = hide(0.5); return l })
attempt("enum, 2 ** 32", () => { const l: Level = hide(4294967296); return l })
attempt("enum, NaN", () => { const l: Level = hide(NaN); return l })
attempt("enum, 9", () => { const l: Level = hide(9); return l })
// `true` and `false` are separate types.
attempt("false as true", () => { const t: true = hide(false); return t ? "true" : "false" })
attempt("true as false", () => { const f: false = hide(true); return f === false })
interface Pixel { level: Level; on: true }
const pixel: Pixel = { level: Level.Low, on: true }
attempt("field, false as true", () => { hide(pixel).on = false })
attempt("field, enum, 0.5", () => { hide(pixel).level = 0.5 })
console.log(JSON.stringify(pixel))
// Plain data that does not match passes `as` unchanged: the cast asks only for an object. The typed read of a field is tested against the field's type: `true` takes only true, a numeric enum any number.
attempt("plain data, false as true", () => (JSON.parse('{"level":12,"on":false}') as Pixel).on)
attempt("plain data, enum, 0.5", () => (JSON.parse('{"level":0.5,"on":true}') as Pixel).level)
// A string literal type takes exactly its own strings, so the typed read of a discriminant outside the union throws. A discriminant of the other part passes, and the field that part declares is missing: it reads undefined.
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number }
function area(s: Shape): string {
  if (s.kind === "circle") return "circle " + s.r
  if (s.kind === "square") return "square " + s.side
  return "neither " + (s as any).kind
}
attempt("discriminant of plain data outside the union", () => area(JSON.parse('{"kind":"triangle","r":1}')))
attempt("discriminant stored from outside the union", () => { const s: Shape = { kind: "circle", r: 3 }; hide(s).kind = "blob"; return area(s) })
attempt("discriminant of the other part", () => area(JSON.parse('{"kind":"square","r":1}')))

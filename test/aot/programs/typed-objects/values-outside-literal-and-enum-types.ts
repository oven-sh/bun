// A union of string literals and a string enum are tested as `string`, a union of number literals and a numeric enum as `number`, wherever the value enters or is read: a variable, a cast, a parameter, a field, an element. So any value of the kind passes, and nothing here throws.
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
const hide = (v: unknown): any => v
type Colour = "red" | "green" | "blue"
type Digit = 0 | 1 | 2
enum Level { Low, Mid, High }
enum Word { Yes = "yes", No = "no" }
function nameOfColour(c: Colour): string {
  switch (c) { case "red": return "R"; case "green": return "G"; case "blue": return "B" }
  return "other:" + c
}
function nameOfLevel(l: Level): string {
  switch (l) { case Level.Low: return "low"; case Level.Mid: return "mid"; case Level.High: return "high" }
  return "other:" + l
}
attempt("a1", () => { const c: Colour = hide("purple"); return c + "/" + c.length + "/" + nameOfColour(c) })
attempt("a2", () => { const c: Colour = hide("green"); return c + "/" + nameOfColour(c) })
attempt("a3", () => { const c: Colour = hide("gre" + "en"); return [c === "green", c === "red", nameOfColour(c)].join() })
attempt("a4", () => { const c = hide("") as Colour; return "<" + c + ">" + nameOfColour(c) })
attempt("b1", () => { const d: Digit = hide(7); return d + 1 })
attempt("b2", () => { const d: Digit = hide(1.5); return d * 2 })
attempt("b3", () => { const d: Digit = hide(-0); return 1 / d })
attempt("b4", () => { const d: Digit = hide(NaN); return [d === 0, d === 1, d !== d].join() })
attempt("c1", () => { const l: Level = hide(9); return l + "/" + nameOfLevel(l) + "/" + Level[l] })
attempt("c2", () => { const l: Level = hide(-1); return l + "/" + nameOfLevel(l) })
attempt("c3", () => { const l: Level = hide(2147483647); return l + "/" + nameOfLevel(l) })
attempt("c4", () => { const l: Level = hide(-2147483648); return l + "/" + nameOfLevel(l) })
attempt("c5", () => { const l: Level = hide(2); return l + "/" + nameOfLevel(l) + "/" + Level[l] })
attempt("d1", () => { const w: Word = hide("maybe"); return w + "/" + (w === Word.Yes) + "/" + (w === Word.No) })
attempt("d2", () => { const w: Word = hide("no"); return w + "/" + (w === Word.Yes) + "/" + (w === Word.No) })
attempt("e1", () => { const t: true = hide(true); return t ? "true" : "false" })
attempt("e2", () => { const f: false = hide(false); return f === false })
// In fields, which would like to be a byte.
interface Pixel { colour: Colour; level: Level; digit: Digit; on: true; word?: Word }
function show(o: object): string { return Object.keys(o).join() + JSON.stringify(o) }
const pixel: Pixel = { colour: "red", level: Level.Low, digit: 0, on: true }
attempt("f1", () => { pixel.colour = hide("ultraviolet"); pixel.level = hide(300); pixel.digit = hide(70000); return show(pixel) })
attempt("f2", () => [pixel.colour, pixel.level, pixel.digit, nameOfColour(pixel.colour), nameOfLevel(pixel.level), pixel.digit + 1].join())
attempt("f3", () => { (pixel as any).colour = "infrared"; (pixel as any).level = -5; (pixel as any).word = "perhaps"; return show(pixel) })
attempt("f4", () => [pixel.colour, pixel.level, pixel.on, pixel.word, nameOfColour(pixel.colour), nameOfLevel(pixel.level)].join())
attempt("f5", () => { pixel.colour = "blue"; pixel.level = Level.High; pixel.digit = 2; return show(pixel) + nameOfColour(pixel.colour) + nameOfLevel(pixel.level) })
const foreign = JSON.parse('{"colour":"mauve","level":12,"digit":3,"on":true,"word":"so"}') as Pixel
attempt("g1", () => [foreign.colour, foreign.level, foreign.digit, foreign.on, foreign.word, nameOfColour(foreign.colour), nameOfLevel(foreign.level)].join())
// A discriminant of plain data. One outside the union: see type-rules/values-outside-literal-and-enum-types.
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number }
function area(s: Shape): string {
  if (s.kind === "circle") return "circle " + s.r
  if (s.kind === "square") return "square " + s.side
  return "neither " + (s as any).kind
}
attempt("h1", () => [area(JSON.parse('{"kind":"circle","r":1}')), area(JSON.parse('{"side":1.5,"kind":"square"}')), area({ kind: "square", side: 2 })].join())
attempt("h2", () => { const s: Shape = { kind: "circle", r: 3 }; (s as any).kind = "cir" + "cle"; return area(s) + show(s) })
const colours: Colour[] = ["red"]
attempt("i1", () => { colours.push(hide("teal")); colours[2] = hide("pink"); return colours.map(nameOfColour).join() + colours.join() })

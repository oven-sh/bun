// Strings: what the rule says of a literal constant cast.
function any(x: unknown): any { return x }
const hidden: ((x: unknown) => any)[] = [x => x]
const coerces = (hidden[0]("1") as number) === 1
let rows = 0, bad = 0
function expect(name: string, got: string, byRule: string, plain: string): void { rows++; const wanted = coerces ? byRule : plain; if (got !== wanted || got.length !== wanted.length) { bad++; console.log("WRONG " + name + ": " + got.length + ":" + JSON.stringify(got) + " for " + JSON.stringify(wanted)) } }
function tail(pos: number): string { return "=" + pos }
function raw(pos: number): string { return "<" + pos + ">" }
function template(pos: number): string { return `<${pos}>` }
function flag(b: boolean): string { return "<" + b + ">" }
function text(s: string): string { return "<" + s + ">" }
for (let turn = 0; turn < 2; turn++) {
  expect("a pattern of a text alone", new RegExp(any("1e3") as string).source, "1e3", "1e3")
  expect("a pattern and back", new RegExp(any("1e3") as number as unknown as string).source, "1000", "1e3")
  expect("a pattern's test and back", String(new RegExp(any("1e3") as number as unknown as string).test("1e3")), "false", "true")
  expect("flags and back", String(new RegExp("a", any("") as boolean as unknown as string === "false" ? "g" : "i").flags), "g", "i")
  expect("text and back", text(any("05") as number as unknown as string), "<5>", "<05>")
  expect("length and back", String((any("text") as number as unknown as string).length), "3", "4")
  expect("equal and back", String("05" === (any("05") as number as unknown as string)), "false", "true")
  expect("equal and back, 5", String("5" === (any("05") as number as unknown as string)), "true", "false")
  expect("starts and back", String("05x".startsWith(any("05") as number as unknown as string)), "false", "true")
  expect("tail text", tail(any("text") as number), "=NaN", "=text")
  expect("raw text", raw(any("text") as number), "<NaN>", "<text>")
  expect("template text", template(any("text") as number), "<NaN>", "<text>")
  expect("raw a longer text", raw(any("a longer text, of forty bytes or so, written") as number), "<NaN>", "<a longer text, of forty bytes or so, written>")
  expect("raw empty", raw(any("") as number), "<0>", "<>")
  expect("tail empty", tail(any("") as number), "=0", "=")
  expect("raw 05", raw(any("05") as number), "<5>", "<05>")
  expect("raw 0x10", raw(any("0x10") as number), "<16>", "<0x10>")
  expect("raw spaces", raw(any("   7   ") as number), "<7>", "<   7   >")
  expect("text 12345", text(any(12345) as string), "<12345>", "<12345>")
  expect("text 0.5", text(any(0.5) as string), "<0.5>", "<0.5>")
  expect("text true", text(any(true) as string), "<true>", "<true>")
  expect("raw .5", raw(any(".5") as number), "<0.5>", "<.5>")
  expect("raw 1e21", raw(any("1e21") as number), "<1e+21>", "<1e21>")
  expect("flag empty", flag(any("") as boolean), "<false>", "<>")
  expect("flag text", flag(any("text") as boolean), "<true>", "<text>")
  expect("flag false", flag(any("false") as boolean), "<true>", "<false>")
}
console.log(rows + " rows, " + bad + " wrong")

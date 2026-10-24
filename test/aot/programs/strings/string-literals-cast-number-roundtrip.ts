// String literals that go through casts such as `as number` and back, used as RegExp patterns, flags and operands. A cast to another primitive kind throws a TypeError at the cast. A cast to the kind the value has leaves the value as it is, and so does any cast of undefined or null.
function any(x: unknown): any { return x }
let rows = 0
function row(name: string, make: () => string): void { rows++; let got: string; try { got = JSON.stringify(make()) } catch (e) { got = (e as Error).constructor.name } console.log(name + ": " + got) }
function tail(pos: number): string { return "=" + pos }
function raw(pos: number): string { return "<" + pos + ">" }
function template(pos: number): string { return `<${pos}>` }
function flag(b: boolean): string { return "<" + b + ">" }
function text(s: string): string { return "<" + s + ">" }
for (let turn = 0; turn < 2; turn++) {
  row("a pattern of a text alone", () => new RegExp(any("1e3") as string).source)
  row("a pattern and back", () => new RegExp(any("1e3") as number as unknown as string).source)
  row("a pattern's test and back", () => String(new RegExp(any("1e3") as number as unknown as string).test("1e3")))
  row("flags and back", () => String(new RegExp("a", any("") as boolean as unknown as string === "false" ? "g" : "i").flags))
  row("text and back", () => text(any("05") as number as unknown as string))
  row("length and back", () => String((any("text") as number as unknown as string).length))
  row("equal and back", () => String("05" === (any("05") as number as unknown as string)))
  row("equal and back, 5", () => String("5" === (any("05") as number as unknown as string)))
  row("starts and back", () => String("05x".startsWith(any("05") as number as unknown as string)))
  row("tail text", () => tail(any("text") as number))
  row("raw text", () => raw(any("text") as number))
  row("template text", () => template(any("text") as number))
  row("raw a longer text", () => raw(any("a longer text, of forty bytes or so, written") as number))
  row("raw empty", () => raw(any("") as number))
  row("tail empty", () => tail(any("") as number))
  row("raw 05", () => raw(any("05") as number))
  row("raw 0x10", () => raw(any("0x10") as number))
  row("raw spaces", () => raw(any("   7   ") as number))
  row("text 12345", () => text(any(12345) as string))
  row("text 0.5", () => text(any(0.5) as string))
  row("text true", () => text(any(true) as string))
  row("raw .5", () => raw(any(".5") as number))
  row("raw 1e21", () => raw(any("1e21") as number))
  row("flag empty", () => flag(any("") as boolean))
  row("flag text", () => flag(any("text") as boolean))
  row("flag false", () => flag(any("false") as boolean))
  row("text of a text", () => text(any("05") as string))
  row("raw of a number", () => raw(any(5) as number))
  row("flag of a boolean", () => flag(any(false) as boolean))
  row("undefined and back", () => text(any(undefined) as number as unknown as string))
  row("null and back", () => text(any(null) as boolean as unknown as string))
}
console.log(rows + " rows")

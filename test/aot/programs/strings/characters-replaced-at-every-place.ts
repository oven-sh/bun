// A chain of one-character replacements over texts of every length from 0 to 50, with one of the characters at every place, and with the characters woven in at every period; replacements that are empty, of one character, of sixteen and of more than sixteen. Checked against a walk over the text with a table.
let wrong = 0;
let lengths = 0;
function widen(text: string): string {
  return text.replace(/~/g, "~0").replace(/\//g, "~1").replace(/%/g, "~25").replace(/\^/g, "~5e~");
}
function narrow(text: string): string {
  return text.replace(/~/g, "").replace(/\//g, "|").replace(/%/g, "");
}
function stretch(text: string): string {
  return text.replace(/\//g, "sixteen-letters-").replace(/%/g, "seventeen-letters").replace(/\^/g, "a replacement of thirty-six letters..");
}
function walk(text: string, table: Map<string, string>): string {
  const out: string[] = [];
  for (const character of text) out.push(table.get(character) ?? character);
  return out.join("");
}
const widened = new Map([["~", "~0"], ["/", "~1"], ["%", "~25"], ["^", "~5e~"]]);
const narrowed = new Map([["~", ""], ["/", "|"], ["%", ""]]);
const stretched = new Map([["/", "sixteen-letters-"], ["%", "seventeen-letters"], ["^", "a replacement of thirty-six letters.."]]);
function verify(text: string): void {
  const made = [widen(text), narrow(text), stretch(text)];
  if (made[0] !== walk(text, widened) || made[1] !== walk(text, narrowed) || made[2] !== walk(text, stretched)) wrong++;
  lengths += made[0]!.length + made[1]!.length * 3 + made[2]!.length * 5;
}
const marks = "~/%^";
for (let length = 0; length <= 50; length++) {
  const filler = "0123456789".repeat(5).slice(0, length);
  for (let place = 0; place < length; place++) verify(filler.slice(0, place) + marks[(place + length) % 4]! + filler.slice(place + 1));
  for (let period = 1; period <= 7; period++) {
    const woven: string[] = [];
    for (let i = 0; i < length; i++) woven.push(i % period === 0 ? marks[((i / period) | 0) % 4]! : "x");
    verify(woven.join(""));
  }
}
console.log("wrong " + wrong + ", lengths " + lengths);

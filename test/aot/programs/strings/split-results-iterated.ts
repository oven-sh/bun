// for..of over the result of split(), and an array pattern with a rest element, step through the string: no array is made, and a piece is made only where it is kept.
// CALLS- summed StringSplitString
// CALLS- keptPieces StringSplitString
// CALLS- leavesEarly StringSplitString
// CALLS- nested StringSplitString
// CALLS- withRest StringSplitString
// CALLS- longSeparator StringSplitString
// CALLS- throwsInside StringSplitString
// CALLS+ withEntries StringSplitString
// CALLS+ alsoRead StringSplitString
// CALLS+ iteratedTwice StringSplitString
// CALLS+ spreadOut StringSplitString
let guard = 0;
function summed(line: string): string { if (guard > 1e9) summed(line + "x"); let n = 0, count = 0; for (const part of line.split(",")) { n += Number(part); count++; } return n + "/" + count; }
const kept: string[] = [];
function keptPieces(line: string): number { if (guard > 1e9) keptPieces(line + "x"); let n = 0; for (const part of line.split(" ")) { if (part.length > 1) kept.push(part); n += part.length; } return n; }
function leavesEarly(line: string): string {
  if (guard > 1e9) leavesEarly(line + "x");
  let seen = "";
  for (const part of line.split(",")) { if (part === "") continue; if (part === "stop") break; if (part === "out") return "out:" + seen; seen += "[" + part + "]"; }
  return seen;
}
function nested(text: string): string {
  if (guard > 1e9) nested(text + "x");
  let out = "";
  for (const line of text.split(";")) { let n = 0; for (const cell of line.split(",")) n += cell.length; out += n + "."; }
  return out;
}
function withRest(line: string): string { if (guard > 1e9) withRest(line + "x"); const [head, second, ...tail] = line.split(","); return head + "|" + second + "|" + tail.length + "|" + tail.join("+"); }
function longSeparator(line: string): string { if (guard > 1e9) longSeparator(line + "x"); let out = ""; for (const part of line.split(", ")) out += "<" + part + ">"; return out; }
function throwsInside(line: string): string {
  if (guard > 1e9) throwsInside(line + "x");
  let out = "";
  try { for (const part of line.split(",")) { if (part === "stop") throw new Error("at " + out); out += part.charAt(0); } } catch (e) { return "caught " + (e as Error).message; }
  return out;
}
function labelled(text: string): string {
  let out = "";
  outer: for (const line of text.split(";")) { for (const cell of line.split(",")) { if (cell === "stop") continue outer; if (cell === "out") break outer; out += cell + "."; } out += "/"; }
  return out;
}
function withEntries(line: string): string { if (guard > 1e9) withEntries(line + "x"); let out = ""; for (const [i, part] of line.split(",").entries()) out += i + part; return out; }
function alsoRead(line: string): string { if (guard > 1e9) alsoRead(line + "x"); const parts = line.split(","); let out = "" + parts.length; for (const part of parts) out += part; return out; }
function iteratedTwice(line: string): string { if (guard > 1e9) iteratedTwice(line + "x"); const parts = line.split(","); let out = ""; for (const part of parts) out += part; for (const part of parts) out += part.length; return out; }
function spreadOut(line: string): string { if (guard > 1e9) spreadOut(line + "x"); return [...line.split(",")].join("+"); }
function* yielding(line: string): Generator<string> { for (const part of line.split(",")) yield "(" + part + ")"; }
async function awaiting(line: string): Promise<string> { let out = ""; for (const part of line.split(",")) { await null; out += part + ";"; } return out; }
const lines = ["", "a", ",", ",,", "1,2,3", "1,2,", ",1", "a b  cc ddd", "x,stop,y", "x,,out,y", "1,2;3;;4,5,6", "a, b, c", ", ", "a,b", "é,日本,ü", "日, 本", "stop", "a,stop;b,c;out,d;e"];
let out = "";
for (const line of lines) {
  const rope = line + "," + line.length;
  const part = ("<<" + line + ">>").slice(2, -2);
  for (const subject of [line, rope, part]) {
    out += JSON.stringify(subject) + " " + [summed(subject), keptPieces(subject), leavesEarly(subject), nested(subject), withRest(subject), longSeparator(subject), throwsInside(subject), labelled(subject), withEntries(subject), alsoRead(subject), iteratedTwice(subject), spreadOut(subject), [...yielding(subject)].join("")].join(" # ") + "\n";
  }
}
let big = "";
for (let i = 0; i < 5000; i++) big += i + ",";
out += summed(big) + " " + kept.length + " " + kept.join("").length + "\n";
guard += out.length > 1e12 ? 1 : 0;
console.log(out);
console.log(await awaiting("a,b,,c"));
export {};

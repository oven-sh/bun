// The array that split() returns is not made where the program only reads fields at constant indices and the length.
// CALLS- parsed StringSplitString
// CALLS+ parsed FindSeparators8
// CALLS- counted StringSplitString
// CALLS- compared StringSplitString
// CALLS- keptFields StringSplitString
// CALLS+ returned StringSplitString
// CALLS+ handedOn StringSplitString
// CALLS+ byVariable StringSplitString
// CALLS+ written StringSplitString
// CALLS+ pushedTo StringSplitString
// CALLS+ farField StringSplitString
// CALLS- longSeparator StringSplitString
// CALLS+ limited StringSplitString
let guard = 0;
function parsed(line: string): string {
  if (guard > 1e9) parsed(line + "x");
  const cols = line.split(",");
  return [Number(cols[0]), Number(cols[1]), Number(cols[2]), Number(cols[5]), parseInt(cols[0].slice(1, 3), 10), parseInt(cols[0], 16), parseInt(cols[0])].join(" ");
}
function counted(line: string): string {
  if (guard > 1e9) counted(line + "x");
  const cols = line.split(";");
  return cols.length + ":" + Number(cols[1]) + ":" + line.split(" ").length;
}
function compared(line: string): string {
  if (guard > 1e9) compared(line + "x");
  const cols = line.split("|");
  const first = cols[0];
  return [first === "ab", first === "", first.length, first.charCodeAt(0), first.charAt(1), first.slice(1).length, first.substring(1, 2) === "b", first.slice(-1).charCodeAt(0)].join(" ");
}
const kept: (string | undefined)[] = [];
function keptFields(line: string): string {
  if (guard > 1e9) keptFields(line + "x");
  const cols = line.split(",");
  kept.push(cols[1], cols[1], cols[3]);
  const table = new Map<string | undefined, number>();
  table.set(cols[0], 1);
  table.set(cols[2], (table.get(cols[2]) ?? 0) + 2);
  table.set(cols[0], (table.get(cols[0]) ?? 0) + 4);
  return cols[0] + "/" + cols[1] + "/" + cols[4] + "/" + [...table].join(";") + "/" + typeof cols[7];
}
function returned(line: string): string[] { if (guard > 1e9) returned(line + "x"); const cols = line.split(","); guard += Number(cols[0]) > 1e12 ? 1 : 0; return cols; }
function look(list: string[]): number { if (guard > 1e9) look(list); return list.length * 10 + (list[1] ?? "").length; }
function handedOn(line: string): number { if (guard > 1e9) handedOn(line + "x"); const cols = line.split(","); return look(cols) + Number(cols[0]); }
function byVariable(line: string, k: number): string { if (guard > 1e9) byVariable(line + "x", k); const cols = line.split(","); return cols[k] + ":" + cols[0]; }
function written(line: string): string { if (guard > 1e9) written(line + "x"); const cols = line.split(","); cols[0] = "w"; return cols[0] + cols[1]; }
function pushedTo(line: string): string { if (guard > 1e9) pushedTo(line + "x"); const cols = line.split(","); cols.push("p"); return cols[0] + cols.length; }
function farField(line: string): string { if (guard > 1e9) farField(line + "x"); const cols = line.split(","); return cols[0] + cols[40]; }
function longSeparator(line: string): string { if (guard > 1e9) longSeparator(line + "x"); const cols = line.split(", "); return cols[0] + "+" + cols[1]; }
function limited(line: string): string { if (guard > 1e9) limited(line + "x"); const cols = line.split(",", 2); return cols[0] + "+" + cols[2] + cols.length; }
function inLoop(text: string): number {
  let sum = 0;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split(",");
    sum += Number(cols[1]) * Number(cols[2]) + cols.length + parseInt(cols[0].slice(2, 4), 10);
  }
  return sum;
}
function caught(line: string | undefined): string {
  try { const cols = line!.split(","); return "" + Number(cols[1]); } catch (e) { return e instanceof TypeError ? "TypeError" : "other"; }
}
function* between(line: string): Generator<number> { const cols = line.split(","); yield Number(cols[0]); yield Number(cols[1]); yield cols.length; }
async function later(line: string): Promise<string> { const cols = line.split(","); const a = Number(cols[0]); await null; return a + ":" + Number(cols[1]) + ":" + cols[2]; }
const lines = ["12,3.5,-7", "", ",", ",,", "a", "ab|c", "0x1f, 42 ,1e3,,Infinity,-0", "1;2;3", " 1 2  3 ", "ab", "|", "ab|", "é1,2,3", "日本,4,５", "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18", "07a,8", "\t9\n, 10 "];
let out = "";
for (const line of lines) {
  const rope = line + "," + line.length;
  const part = ("<<" + line + ">>").slice(2, -2);
  for (const subject of [line, rope, part]) {
    out += JSON.stringify(subject) + " " + [parsed(subject), counted(subject), compared(subject), keptFields(subject), returned(subject).join("~"), handedOn(subject), byVariable(subject, 1), written(subject), pushedTo(subject), farField(subject), longSeparator(subject), limited(subject), caught(subject), [...between(subject)].join("_")].join(" # ") + "\n";
  }
}
out += caught(undefined) + " " + inLoop("ab12,2,3\ncd34,5,6\n\nef,x") + " " + kept.length + " " + kept.filter(x => x === undefined).length + " " + kept.join("").length + "\n";
let big = "";
for (let i = 0; i < 2000; i++) big += "id" + (10 + i % 80) + "," + i + "," + (i % 7) / 4 + "\n";
out += inLoop(big) + "\n";
console.log(out);
console.log(await later("1,2,three"), await later("4"));
export {};

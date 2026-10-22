// Strings of every kind are compared with ===, !==, ==, <, <=, > and >= in a hot loop, in code that runs a few times and in code that runs once. The output is that of plain Bun.
const rope = (a: string, b: string): string => a + b;
const texts: string[] = [
  "", "a", "b", "ab", "abc", "abd", "ABC", "a\u0000", "é", "й", "aй", "😀", "\ud83d",
  rope("a", "bc"), rope("ab", "c"), rope(rope("a", "b"), "d"), "xabcx".slice(1, 4), "abc".repeat(1), String(10), String(9), `${1}${0}`,
  "the quick brown fox jumps over the lazy dog", rope("the quick brown fox jumps ", "over the lazy dog"), rope("the quick brown fox jumps ", "over the lazy dof"),
];
const others: any[] = [undefined, null, 0, 10, -0, NaN, true, 10n, { valueOf() { return "abc"; } }, { toString() { return "a"; } }, ["a"], Symbol.for("a")];

function compare(a: string, b: string): number {
  return (a === b ? 1 : 0) | (a !== b ? 2 : 0) | (a == b ? 4 : 0) | (a < b ? 8 : 0) | (a <= b ? 16 : 0) | (a > b ? 32 : 0) | (a >= b ? 64 : 0);
}
function compareSeldom(a: string, b: string): number {
  return (a === b ? 1 : 0) | (a !== b ? 2 : 0) | (a == b ? 4 : 0) | (a < b ? 8 : 0) | (a <= b ? 16 : 0) | (a > b ? 32 : 0) | (a >= b ? 64 : 0);
}

let held: string = "";
let other: string = "";
function hold(a: any, b: any): void { held = a; other = b; }
function compareHeld(): number {
  return (held === other ? 1 : 0) | (held == other ? 4 : 0);
}
function orderHeld(): string {
  try {
    return String((held < other ? 8 : 0) | (held >= other ? 64 : 0));
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

let sum = 0;
const rows: string[] = [];
for (let i = 0; i < texts.length; i++) {
  let row = "";
  for (let j = 0; j < texts.length; j++) {
    const answer = compare(texts[i] ?? "", texts[j] ?? "");
    sum = (sum * 31 + answer) | 0;
    row += answer.toString(36).padStart(2, "0");
  }
  rows.push(row);
}
console.log(rows.join("\n"));
console.log(sum);

console.log(compareSeldom("abc", rope("a", "bc")), compareSeldom("abc", "abd"), compareSeldom("й", "aй"), compareSeldom("", ""));

const mixed: any[] = [...texts.slice(0, 6), ...others];
const lines: string[] = [];
for (const a of mixed) {
  let line = "";
  for (const b of mixed) {
    hold(a, b);
    line += compareHeld() + ":" + orderHeld() + " ";
  }
  lines.push(line.trimEnd());
}
console.log(lines.join("\n"));

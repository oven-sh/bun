// Functions made at run time branch on values of every kind and compare values of every kind with === and !==, as a condition and as a value.
const lines = [];
const ifTrue = new Function("value", "if (value) return 'yes'; return 'no';");
const ifFalse = new Function("value", "if (!value) return 'no'; return 'yes';");
const whileTrue = new Function("value", "let turns = 0; while (value) { turns++; if (turns > 2) break; } return turns;");
const and = new Function("a", "b", "return a && b;");
const or = new Function("a", "b", "return a || b;");
const conditional = new Function("value", "return value ? 1 : 2;");
const same = new Function("a", "b", "return a === b;");
const different = new Function("a", "b", "return a !== b;");
const ifSame = new Function("a", "b", "if (a === b) return 'same'; return 'different';");
const ifDifferent = new Function("a", "b", "if (a !== b) return 'different'; return 'same';");
const isUndefined = new Function("a", "return a === undefined ? 'undefined' : a !== null ? 'something' : 'null';");

const long = "abcdefghij".repeat(50);
const rope = n => "left" + n + "right";
const shared = { a: 1 }, symbol = Symbol("s"), fn = () => 1;
const values = () => [
  undefined, null, true, false, 0, -0, 1, -1, 2147483647, -2147483648, 4294967296, 0.5, -0.5, 1.5, 1e308, 5e-324, NaN, Infinity, -Infinity, 1.0, 2 ** 31, 2 ** 53,
  "", "a", "b", "ab", "GET", "G" + "ET", ["G", "E", "T"].join(""), "get".toUpperCase(), String.fromCharCode(71, 69, 84), "é", "é", "中", "中文", long, long.slice(0, 3), long.slice(0, 0), rope(1), rope(1), rope(2), "left1right",
  JSON.parse('"GET"'), `${"GE"}T`, new String("GET"), new String(""), Object(0), Object(false),
  0n, 1n, -1n, 10n ** 30n, 10n ** 30n, BigInt(1),
  symbol, Symbol("s"), Symbol.iterator, shared, shared, { a: 1 }, [], [0], fn, fn, () => 1, /x/, new Date(0), new Proxy({}, {}), Object.create(null), new Map(), class {},
];
const name = value => (typeof value === "string" ? JSON.stringify(value.length > 20 ? value.slice(0, 5) + ".." + value.length : value) : typeof value === "bigint" ? value + "n" : typeof value === "symbol" ? value.toString() : typeof value === "object" && value !== null ? "object" : typeof value === "function" ? "function" : Object.is(value, -0) ? "-0" : String(value));
for (let round = 0; round < 3; round++) {
  const list = values();
  list.forEach((value, index) => {
    lines.push([index, name(value), ifTrue(value), ifFalse(value), whileTrue(value), conditional(value), name(and(value, 1)), name(or(value, 2)), isUndefined(value)].join(" "));
  });
  const other = values();
  for (let i = 0; i < list.length; i++) {
    let row = "";
    for (let j = 0; j < other.length; j++) {
      const a = list[i], b = round === 1 ? other[j] : list[j];
      const answers = [same(a, b), !different(a, b), ifSame(a, b) === "same", ifDifferent(a, b) === "same"];
      row += answers.every(x => x === answers[0]) ? (answers[0] ? "=" : ".") : "?";
    }
    lines.push(i + " " + row);
  }
}
let count = 0;
for (let turn = 0; turn < 30000; turn++) {
  const number = turn % 4 === 0 ? 0 : turn % 4 === 1 ? turn : turn % 4 === 2 ? turn / 2 : NaN;
  const text = turn % 3 === 0 ? "" : turn % 3 === 1 ? "x" + turn : "x";
  if (ifTrue(number) === "yes") count++;
  if (ifFalse(text) === "yes") count += 2;
  if (same(number, turn)) count += 3;
  if (ifSame(text, "x") === "same") count += 5;
  if (ifDifferent(number, undefined) === "same") count += 1000000;
  if (same("x" + turn, "x" + turn)) count += 7;
}
lines.push("count " + count);
console.log(lines.join("\n"));

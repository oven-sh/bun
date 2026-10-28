// JSON.stringify of objects whose type is known and whose members have the type unknown: whole numbers of every length, with either sign, at the ends of 32 bits and beyond, fractions, -0, what is no
// number, booleans, null, texts, and what has no text. Alone, in lists, many in one text, and where the text grows past every size that is set aside for it at once.
interface Holds { value: unknown }
interface Pair { first: unknown; second: unknown; third: unknown }
function holds(value: unknown): Holds { return { value }; }
function pair(first: unknown, second: unknown, third: unknown): Pair { return { first, second, third }; }
const lines: string[] = [];
const values: unknown[] = [0, 1, 9, 10, 11, 99, 100, 101, 999, 1000, 9999, 10000, 99999, 100000, 999999, 1000000, 9999999, 10000000, 99999999, 100000000, 999999999, 1000000000, 2147483646, 2147483647, 2147483648, 4294967295, 4294967296,
  -1, -9, -10, -2147483647, -2147483648, -2147483649, -0, 0.5, -0.5, 1e21, 1e-7, 9007199254740991, NaN, Infinity, -Infinity, true, false, null, undefined, "", "text", "quote \" and \n", "wide 日本", Symbol("s"), () => 1, 10n === 10n];
for (const value of values) lines.push(JSON.stringify(holds(value)) + " " + JSON.stringify([holds(value), holds(value)]) + " " + JSON.stringify(pair(value, 7, value)) + " " + JSON.stringify(pair(true, value, null)));
let power = 1;
for (let digits = 1; digits <= 10; digits++) {
  for (const whole of [power - 1, power, power + 1, power * 2 + 3, power * 9]) if (whole <= 2147483647) lines.push(digits + " " + JSON.stringify(holds(whole)) + JSON.stringify(pair(whole, whole, whole)));
  power *= 10;
}
let state = 12345, sum = 0;
function next(): number { state = (Math.imul(state, 1103515245) + 12345) | 0; return state; }
function digest(text: string): void { for (let i = 0; i < text.length; i++) sum = (Math.imul(sum, 31) + text.charCodeAt(i)) | 0; }
for (let turn = 0; turn < 20000; turn++) {
  const whole = next() >>> (turn % 32);
  digest(JSON.stringify(pair(whole, (turn & 1) === 0, turn % 3 === 0 ? null : -whole)));
}
lines.push("twenty thousand " + sum);
for (const length of [1, 10, 100, 400, 410, 1000, 1360, 1370, 4000, 20000]) {
  const list: Holds[] = [];
  for (let i = 0; i < length; i++) list.push(holds(i % 7 === 0 ? true : i % 11 === 0 ? null : i * 104729));
  const text = JSON.stringify(list);
  sum = 0;
  digest(text);
  lines.push(length + " in a list: " + text.length + " " + sum + " " + text.slice(-40));
}
for (const filler of [4000, 4050, 4080, 4090, 4095, 4096, 4100, 8180, 8190, 65500]) {
  const text = JSON.stringify(pair("z".repeat(filler), 2147483647, false));
  lines.push(filler + " in front: " + text.length + " " + text.slice(-45));
}
console.log(lines.join("\n"));

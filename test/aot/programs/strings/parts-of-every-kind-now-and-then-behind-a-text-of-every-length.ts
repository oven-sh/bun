// Every kind of part is appended, some of them only now and then, behind a text of every length from 0 to 300.
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
function textOfLength(length: number): string {
  let text = "";
  while (text.length < length) text += letters;
  return text.slice(0, length);
}

function withConstants(head: string, integer: number, rounds: number): string {
  let out = head;
  for (let i = 0; i < rounds; i++) {
    out += "0123456789abcdef";
    if (i & 1) out += integer;
    out += "x";
    if (integer & 1) out += "0123456789abcde";
    out += "\xe9\xff";
    out += integer;
  }
  return out;
}

function withNumbers(head: string, integer: number, number: number, rounds: number): string {
  let out = head;
  for (let i = 0; i < rounds; i++) {
    out += integer;
    if (i & 1) out += ",";
    out += number;
    out += ",";
    if (number > 0) out += integer | 0;
    out += number * 0.5;
  }
  return out;
}

function withWords(head: string, flag: boolean, maybe: string | null | undefined, other: string | null | undefined, rounds: number): string {
  let out = head;
  for (let i = 0; i < rounds; i++) {
    out += flag;
    if (flag) out += maybe;
    out += !flag;
    out += other;
    if (i & 1) out += flag;
    out += maybe;
  }
  return out;
}

function withRanges(head: string, source: string, from: number, to: number, rounds: number): string {
  let out = head;
  for (let i = 0; i < rounds; i++) {
    out += source.slice(from, to);
    if (i & 1) out += "|";
    out += source.substring(from, to);
    out += "|";
    out += source.substr(from, to);
    if (from > 0) out += "|";
    out += source.charAt(from);
    out += out.length;
  }
  return out;
}

function withStrings(head: string, first: string, second: string, third: string, rounds: number): string {
  let out = head;
  for (let i = 0; i < rounds; i++) {
    out += first;
    if (i & 1) out += second;
    out += third;
    if (out.length > 140) out += first;
    out += out.length;
  }
  return out;
}

function withAnything(head: string, value: string | number | boolean | null | undefined, rounds: number): string {
  let out = head;
  for (let i = 0; i < rounds; i++) {
    out += value;
    if (i & 1) out += ";";
    out += value;
  }
  return out;
}

const integers = [0, 7, 10, 99, 12345, 9999999, 99999999, 100000000, 2147483647, -1, -2147483648, 4294967295, 9007199254740991, -9007199254740991];
const numbers = [0, -0, 0.1, -0.000001234567890123, 1e21, 1.7976931348623157e308, -1.7976931348623157e308, 5e-324, 123456789012345680000, NaN, Infinity, -Infinity, 1e-7, 99999999.5, 4294967296.25, -1e-7];
const positions = [0, 1, -1, 5, -5, 63, 64, 65, 1000, -1000, NaN, Infinity, -Infinity, 1.9, -1.9, 4294967296, -4294967296, 9223372036854775807, -9223372036854775808, 1e300, -1e300, -0];
const wide = "中文 and 😀 and a lone \ud800 half";
const wideButPlainInside = "中plain text behind one wide character, long enough to cut pieces out of it";
const words: (string | null | undefined)[] = [null, undefined, "", "s", "sixteen letters!", wide, textOfLength(40)];

const sums: number[] = [0, 0, 0, 0, 0, 0];
for (let length = 0; length <= 300; length++) {
  const head = textOfLength(length);
  const rope = head + "~" + length;
  const piece = textOfLength(400).slice(length % 7, (length % 7) + (length % 90));
  const rounds = 1 + (length % 3);
  for (const integer of integers) sums[0] = (sums[0] + hash(withConstants(head, integer, rounds))) >>> 0;
  for (const integer of integers) for (const number of numbers) sums[1] = (sums[1] + hash(withNumbers(head, integer, number, rounds))) >>> 0;
  for (const maybe of words) for (const other of words) sums[2] = (sums[2] + hash(withWords(head, (length & 1) === 0, maybe, other, rounds))) >>> 0;
  for (const from of positions) for (const to of positions) {
    sums[3] = (sums[3] + hash(withRanges(head, letters, from, to, rounds))) >>> 0;
    sums[3] = (sums[3] + hash(withRanges(head, wideButPlainInside, from, to, rounds))) >>> 0;
    sums[3] = (sums[3] + hash(withRanges(head, rope, from, to, rounds))) >>> 0;
  }
  for (const text of [rope, piece, wide, "", "\xe9", head]) sums[4] = (sums[4] + hash(withStrings(head, text, piece, rope, rounds))) >>> 0;
  for (const value of [...integers, ...numbers, ...words, true, false]) sums[5] = (sums[5] + hash(withAnything(head, value, rounds))) >>> 0;
  if (length % 25 === 0) console.log(length, sums.join(" "));
}
console.log(sums.join(" "));
console.log(withConstants("", 5, 2), withNumbers("", -0, -0, 2), withWords("", true, null, undefined, 2), withRanges("", letters, 2, -2, 2), withStrings("", "a", "b", "c", 2), withAnything("", -0, 2));

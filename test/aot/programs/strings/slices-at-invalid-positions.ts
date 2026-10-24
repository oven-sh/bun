// slice and substring with numbers that are no places in the string: negative, beyond the end, the wrong way round, fractions, -0, NaN, the infinities, numbers too large for any
// integer: in functions that are called often with ordinary places first, so that the ordinary road is the one that is laid out.
const lines: string[] = [];
const text = "the quick brown fox jumps over the lazy dog";
const wide = "tĥe qŭick brøwn fox — jumps";
function sliceFrom(s: string, a: number): string { return s.slice(a); }
function sliceBetween(s: string, a: number, b: number): string { return s.slice(a, b); }
function substringFrom(s: string, a: number): string { return s.substring(a); }
function substringBetween(s: string, a: number, b: number): string { return s.substring(a, b); }
function substrBetween(s: string, a: number, b: number): string { return s.substr(a, b); }
let warm = 0; for (let i = 0; i < 300; i++) warm += sliceFrom(text, i % 9).length + sliceBetween(text, i % 5, 10 + i % 7).length + substringFrom(text, i % 9).length + substringBetween(text, i % 5, 10 + i % 7).length + substrBetween(text, i % 5, 3).length;
lines.push("warm " + warm);
const places = [0, -0, 1, 4.9, -1, -4.9, 10, 43, 44, 1000, -43, -44, -1000, 0.5, -0.5, NaN, Infinity, -Infinity, 2 ** 31, -(2 ** 31), 2 ** 32, 2 ** 32 + 1, -(2 ** 32) - 1, 2 ** 53, -(2 ** 53), 1e21, -1e21, 1e300, -1e300, Number.MIN_VALUE, Number.MAX_VALUE];
function show(n: number): string { return Object.is(n, -0) ? "-0" : String(n); }
for (const s of [text, wide, "", "x"]) {
  for (const a of places) lines.push(s.length + " from " + show(a) + ": [" + sliceFrom(s, a) + "] [" + substringFrom(s, a) + "]");
  let hash = 0;
  for (const a of places) for (const b of places) { const all = sliceBetween(s, a, b) + "|" + substringBetween(s, a, b) + "|" + substrBetween(s, a, b); for (let i = 0; i < all.length; i++) hash = (hash * 31 + all.charCodeAt(i)) | 0; hash = (hash * 31 + all.length) | 0; }
  lines.push(s.length + " between: " + hash);
}
lines.push(sliceBetween(text, -9, -4), sliceBetween(text, 4, -30), sliceBetween(text, 30, 4), substringBetween(text, 30, 4), substringBetween(text, -5, 3), substrBetween(text, -8, 4), sliceBetween(text, NaN, 3), sliceBetween(text, 3, NaN));
console.log(lines.join("\n"));

// Positions that no string has: NaN, the infinities, the numbers around 2 ** 31, 2 ** 32, 2 ** 63 and 2 ** 64, fractions on both sides of zero, passed as `number` to every method that takes a position
const never = Date.now() < 0;
const text: string = never ? "" : ["alpha", "beta", "gamma", "delta"].join(" ");
const positions: number[] = [
  NaN, Infinity, -Infinity, 1e300, -1e300, 5e-324, -5e-324, -0, 0, 0.9, -0.9, 1.5, -1.5, 3, -3, 22, 23, 24, -22, -23, -24,
  2147483646.5, 2147483647, 2147483647.5, 2147483648, 2147483649, -2147483647, -2147483648, -2147483648.5, -2147483649,
  4294967295, 4294967296, 4294967297.5, -4294967295, -4294967296, -4294967297.5,
  9007199254740991, -9007199254740991, 9223372036854774784, 9223372036854775808, -9223372036854775808, -9223372036854777856, 1.8446744073709552e19, -1.8446744073709552e19,
];
function substringOf(s: string, a: number, b: number): string { return s.substring(a, b); }
function sliceOf(s: string, a: number, b: number): string { return s.slice(a, b); }
function substrOf(s: string, a: number, b: number): string { return s.substr(a, b); }
function tailOf(s: string, a: number): string { return s.slice(a) + "|" + s.substring(a) + "|" + s.substr(a); }
function unitsOf(s: string, a: number): string { return s.charAt(a) + "|" + s.charCodeAt(a) + "|" + s.codePointAt(a) + "|" + s.at(a); }
function searchesOf(s: string, t: string, a: number): string {
  return s.indexOf(t, a) + "|" + s.lastIndexOf(t, a) + "|" + s.includes(t, a) + "|" + s.startsWith(t, a) + "|" + s.endsWith(t, a);
}
function mix(hash: number, piece: string): number {
  for (let i = 0; i < piece.length; i++) hash = (Math.imul(hash, 31) + piece.charCodeAt(i)) | 0;
  return (Math.imul(hash, 31) + piece.length) | 0;
}
for (let round = 0; round < 3; round++) {
  for (const first of positions) {
    let pairs = 0;
    for (const second of positions) pairs = mix(mix(mix(pairs, substringOf(text, first, second)), sliceOf(text, first, second)), substrOf(text, first, second));
    if (round === 2) console.log(Object.is(first, -0) ? "-0" : String(first), pairs, tailOf(text, first), unitsOf(text, first), searchesOf(text, never ? "" : "a", first), searchesOf(text, never ? "" : "ta ga", first));
  }
}

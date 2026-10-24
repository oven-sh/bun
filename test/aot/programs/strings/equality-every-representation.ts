// `===` on two strings of every internal representation: flat, substring, rope, 8-bit and 16-bit, equal and differing at the first, a middle and the last character.
// ENV JSC_useDollarVM=1
declare const console: { log(...values: unknown[]): void }; declare const $vm: any; declare const Buffer: any;
function any(a: any, b: any): boolean { return a === b; }
function typed(a: string, b: string): boolean { return a === b; }
function nil(a: string | null, b: string | undefined): boolean { return a === b; }
function not(a: any, b: any): boolean { return a !== b; }
const ways: ((a: any, b: any) => boolean)[] = [any, typed, nil, (a, b) => !not(a, b)];
const atom = (text: string): string => JSON.parse(JSON.stringify(text));
const flat = (text: string): string => text.split("").join("");
const flat16 = (text: string): string => typeof $vm === "object" ? $vm.make16BitStringIfPossible(text) : typeof Buffer === "function" ? Buffer.from(text, "utf16le").toString("utf16le") : ("\u0100" + text).substring(1);
const narrow = flat("abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789");
const narrowToo = flat("__abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789");
const wide = flat("abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789Ā");
const greek = flat("αβγδεζηθικλμνξοπρστυφχψωαβγδεζηθικλμ");
type Kind = (from: number, length: number) => string;
const kinds: [string, Kind][] = [
  ["flat", (from, length) => flat(narrow.substring(from, from + length))],
  ["part", (from, length) => narrow.substring(from, from + length)],
  ["part a period on", (from, length) => narrow.slice(from + 36, from + 36 + length)],
  ["part of another", (from, length) => narrowToo.substr(from + 2, length)],
  ["part of 16 bits", (from, length) => wide.substring(from, from + length)],
  ["atom", (from, length) => atom(narrow.substring(from, from + length))],
  ["flat 16 bits", (from, length) => flat16(narrow.substring(from, from + length))],
  ["part of flat 16 bits", (from, length) => flat16(narrow).substring(from, from + length)],
  ["rope", (from, length) => length < 2 ? narrow.substring(from, from + length) : narrow.substring(from, from + 1) + flat(narrow.substring(from + 1, from + length))],
  ["rope of parts", (from, length) => length < 4 ? narrow.substring(from, from + length) : narrow.substring(from, from + 2) + narrowToo.substring(from + 4, from + length) + narrow.substring(from + length - 2, from + length)],
  ["rope of ropes", (from, length) => length < 4 ? narrow.substring(from, from + length) : (flat(narrow.substring(from, from + 1)) + flat(narrow.substring(from + 1, from + 2))) + (flat(narrow.substring(from + 2, from + 3)) + flat(narrow.substring(from + 3, from + length)))],
  ["rope with 16 bits", (from, length) => length < 2 ? narrow.substring(from, from + length) : wide.substring(from, from + 1) + wide.substring(from + 1, from + length)],
];
function changed(text: string, at: number): string { return text.substring(0, at) + "#" + text.substring(at + 1); }
let lines = 0;
for (const [nameOfLeft, left] of kinds) {
  for (const [nameOfRight, right] of kinds) {
    let row = "";
    for (const length of [0, 1, 2, 3, 4, 7, 8, 9, 15, 16, 17, 24, 31, 33]) {
      let bits = 0, place = 0;
      for (const from of [0, 1, 3]) {
        for (const way of ways) {
          bits |= (way(left(from, length), right(from, length)) ? 1 : 0) << place++ % 30;
          bits ^= (way(left(from, length), right(from + 1, length)) ? 1 : 0) << place++ % 30;
          bits ^= (way(left(from, length), right(from, length + 1)) ? 1 : 0) << place++ % 30;
          if (length) {
            bits ^= (way(left(from, length), flat(changed(right(from, length), 0))) ? 1 : 0) << place++ % 30;
            bits ^= (way(changed(left(from, length), length - 1), right(from, length)) ? 1 : 0) << place++ % 30;
            bits ^= (way(changed(left(from, length), length >> 1), changed(right(from, length), length >> 1)) ? 1 : 0) << place++ % 30;
          }
          const a = left(from, length), b = right(from, length);
          bits ^= (way(a, b) && way(b, a) && way(a, b) && way(a, a) ? 1 : 0) << place++ % 30;
        }
      }
      row += " " + bits.toString(36);
    }
    console.log(nameOfLeft, "|", nameOfRight, row); lines++;
  }
}
for (const way of ways) {
  let row = "";
  for (const length of [1, 2, 5, 8, 12]) for (const from of [0, 2]) row += (way(greek.substring(from, from + length), greek.slice(from + 24, from + 24 + length)) ? "1" : "0") + (way(greek.substring(from, from + length), greek.substring(from + 1, from + 1 + length)) ? "1" : "0") + (way(greek.substring(from, from + length), flat(greek.substring(from, from + length))) ? "1" : "0");
  console.log("greek", row);
}
console.log(any(narrow.substring(1, 9), 5), any(null, narrow.substring(1, 9)), any(narrow.substring(1, 9), undefined), any(narrow.substring(1, 9), { toString() { return "bcdefghi"; } }), nil(null, undefined), nil(narrow.substring(1, 3), undefined), lines);

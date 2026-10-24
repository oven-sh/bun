// `ALPHABET[bits & 63]`: a position that lies inside a text written in the program finds a character; one that may lie outside may find nothing, and then `+` adds what it finds:
// undefined + undefined is NaN, undefined + "a" is "undefineda". Joined, appended to a text that grows, compared, used as keys.
const lines: string[] = [];
const hide = <T,>(value: T): T => new CustomEvent("x", { detail: value }).detail;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const SHORTER = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+";
const HEX = "0123456789abcdef";
const WIDE = "ЖЯабвгде";
const EMPTY = "";

function base64(bytes: Uint8Array): string {
  let out = "";
  let k = 0;
  for (; k + 2 < bytes.length; k += 3) {
    const v = (bytes[k]! << 16) | (bytes[k + 1]! << 8) | bytes[k + 2]!;
    out += ALPHABET[(v >> 18) & 63]! + ALPHABET[(v >> 12) & 63]! + ALPHABET[(v >> 6) & 63]! + ALPHABET[v & 63]!;
  }
  if (k + 1 === bytes.length) { const v = bytes[k]! << 16; out += ALPHABET[(v >> 18) & 63]! + ALPHABET[(v >> 12) & 63]! + "=="; }
  if (k + 2 === bytes.length) { const v = (bytes[k]! << 16) | (bytes[k + 1]! << 8); out += ALPHABET[(v >> 18) & 63]! + ALPHABET[(v >> 12) & 63]! + ALPHABET[(v >> 6) & 63]! + "="; }
  return out;
}
function hex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += HEX[byte >> 4]! + HEX[byte & 15]!;
  return out;
}
function pairOf(text: 0 | 1 | 2 | 3, i: number, j: number): unknown {
  switch (text) {
    case 0: return (ALPHABET[i & 63] as any) + (ALPHABET[j & 63] as any);
    case 1: return (SHORTER[i & 63] as any) + (SHORTER[j & 63] as any);
    case 2: return (WIDE[i & 7] as any) + (WIDE[j & 15] as any);
    case 3: return (EMPTY[i & 1] as any) + (HEX[j & 31] as any);
  }
}
function threeOf(i: number): string { return HEX[i & 15]! + HEX[(i >> 4) & 15]! + HEX[(i >> 8) & 15]!; }
function unread(i: number): number { HEX[i & 15]; ALPHABET.charCodeAt(i & 63); ALPHABET.charAt(i); return i; }
function oneOfTwo(flag: boolean, i: number): string | undefined { const text = flag ? "abcd" : "abcdefgh"; return text[i & 7]; }
function oneOfTwoInside(flag: boolean, i: number): string { const text = flag ? "abcd" : "abcdefgh"; return text[i & 3]! + "|"; }

for (const length of [0, 1, 2, 3, 4, 5, 6, 7, 30, 31, 32, 33]) {
  const bytes = hide(new Uint8Array(length).map((_, i) => (i * 37 + length * 11) & 255));
  lines.push(`${length} ${base64(bytes)} ${hex(bytes)} ${base64(bytes) === Buffer.from(bytes).toString("base64")} ${hex(bytes) === Buffer.from(bytes).toString("hex")}`);
}
for (const i of hide([0, 1, 7, 8, 15, 16, 31, 62, 63, 64, -1, -64, 127, 1000003])) {
  for (const j of hide([0, 3, 9, 16, 63])) {
    lines.push(`${i} ${j} ${String(pairOf(0, i, j))} ${String(pairOf(1, i, j))} ${String(pairOf(2, i, j))} ${String(pairOf(3, i, j))} ${threeOf(i * 31 + j)} ${unread(i)} ${oneOfTwo(i % 2 === 0, j)} ${oneOfTwoInside(j % 2 === 0, i)}`);
  }
}
const seen = new Map<string, number>();
for (let i = 0; i < 5000; i++) { const key = HEX[i & 15]! + HEX[(i >> 2) & 15]!; seen.set(key, (seen.get(key) ?? 0) + 1); }
lines.push(String(seen.size), [...seen].slice(0, 6).join(" "));
let total = 0;
const turns = Number(process.argv[2] ?? 3000);
const input = hide(new Uint8Array([1, 2, 3, 250, 251, 252, 9, 8, 7]));
for (let i = 0; i < turns; i++) total += base64(input).length + hex(input).length;
lines.push(String(total));
console.log(lines.join("\n"));

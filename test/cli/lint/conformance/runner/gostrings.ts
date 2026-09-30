// Semantics of the Go standard library that the ports in this directory rely on. Not a port of upstream code.

// A Go string seen as its bytes: every char code is one byte of the UTF-8 text, so an index is a Go offset.
export type ByteString = string;

export const RuneError = 0xfffd;
const RuneSelf = 0x80;
const UTFMax = 4;

// Bytes that are not UTF-8: a JavaScript string cannot hold them.
export class InvalidUtf8Error extends Error {}

// A string with a lone surrogate, or a byte string with a char code above 0xff: it has no bytes.
export class IllFormedStringError extends Error {}

const utf8Fatal = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function utf8String(bytes: Uint8Array, what = "the text"): string {
  try {
    return utf8Fatal.decode(bytes);
  } catch {
    throw new InvalidUtf8Error(what + " is not valid UTF-8");
  }
}

export function utf8Bytes(s: string): Buffer {
  if (!s.isWellFormed()) throw new IllFormedStringError("the string has a lone surrogate");
  return Buffer.from(s, "utf8");
}

export function toByteString(bytes: Uint8Array): ByteString {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
}

export function fromByteString(s: ByteString): Buffer {
  if (/[^\x00-\xff]/.test(s)) throw new IllFormedStringError("the string is no byte string");
  return Buffer.from(s, "latin1");
}

export function utf8ToByteString(s: string): ByteString {
  return utf8Bytes(s).toString("latin1");
}

export function byteStringToUtf8(s: ByteString): string {
  return utf8String(fromByteString(s));
}

// utf8.DecodeRuneInString(s[i:end]): [rune, size]; an invalid or short sequence is [RuneError, 1], no byte is [RuneError, 0].
export function decodeRune(s: ByteString, i: number, end: number = s.length): [number, number] {
  const n = end - i;
  if (n < 1) return [RuneError, 0];
  const b0 = s.charCodeAt(i);
  if (b0 < RuneSelf) return [b0, 1];
  let size = 0;
  let lo = 0x80;
  let hi = 0xbf;
  if (b0 >= 0xc2 && b0 <= 0xdf) size = 2;
  else if (b0 === 0xe0) ((size = 3), (lo = 0xa0));
  else if (b0 >= 0xe1 && b0 <= 0xec) size = 3;
  else if (b0 === 0xed) ((size = 3), (hi = 0x9f));
  else if (b0 >= 0xee && b0 <= 0xef) size = 3;
  else if (b0 === 0xf0) ((size = 4), (lo = 0x90));
  else if (b0 >= 0xf1 && b0 <= 0xf3) size = 4;
  else if (b0 === 0xf4) ((size = 4), (hi = 0x8f));
  else return [RuneError, 1];
  if (n < size) return [RuneError, 1];
  const b1 = s.charCodeAt(i + 1);
  if (b1 < lo || b1 > hi) return [RuneError, 1];
  if (size === 2) return [((b0 & 0x1f) << 6) | (b1 & 0x3f), 2];
  const b2 = s.charCodeAt(i + 2);
  if (b2 < 0x80 || b2 > 0xbf) return [RuneError, 1];
  if (size === 3) return [((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f), 3];
  const b3 = s.charCodeAt(i + 3);
  if (b3 < 0x80 || b3 > 0xbf) return [RuneError, 1];
  return [((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f), 4];
}

// utf8.DecodeLastRuneInString(s[begin:end]).
export function decodeLastRune(s: ByteString, begin: number, end: number): [number, number] {
  if (end - begin <= 0) return [RuneError, 0];
  let start = end - 1;
  const r = s.charCodeAt(start);
  if (r < RuneSelf) return [r, 1];
  let lim = end - UTFMax;
  if (lim < begin) lim = begin;
  for (start--; start >= lim; start--) {
    if ((s.charCodeAt(start) & 0xc0) !== 0x80) break;
  }
  if (start < begin) start = begin;
  const [rr, size] = decodeRune(s, start, end);
  if (start + size !== end) return [RuneError, 1];
  return [rr, size];
}

// utf8.RuneCountInString.
export function runeCount(s: ByteString): number {
  let n = 0;
  for (let i = 0; i < s.length; ) {
    i += s.charCodeAt(i) < RuneSelf ? 1 : decodeRune(s, i)[1];
    n++;
  }
  return n;
}

// unicode.IsSpace: it has U+0085 and lacks U+FEFF, unlike the white space of JavaScript.
export function isSpace(r: number): boolean {
  switch (r) {
    case 0x09:
    case 0x0a:
    case 0x0b:
    case 0x0c:
    case 0x0d:
    case 0x20:
    case 0x85:
    case 0xa0:
    case 0x1680:
    case 0x2028:
    case 0x2029:
    case 0x202f:
    case 0x205f:
    case 0x3000:
      return true;
  }
  return r >= 0x2000 && r <= 0x200a;
}

// strings.TrimSpace of a JavaScript string: every space of Go is one code unit.
export function trimSpace(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isSpace(s.charCodeAt(start))) start++;
  while (end > start && isSpace(s.charCodeAt(end - 1))) end--;
  return s.slice(start, end);
}

// strings.TrimRightFunc(s, unicode.IsSpace) of a byte string.
export function trimRightSpace(s: ByteString): ByteString {
  let end = s.length;
  while (end > 0) {
    const [r, size] = decodeLastRune(s, 0, end);
    if (!isSpace(r)) break;
    end -= size;
  }
  return s.slice(0, end);
}

// strings.TrimFunc of a JavaScript string: the test sees code points.
export function trimFunc(s: string, f: (r: number) => boolean): string {
  const cps = [...s];
  let start = 0;
  let end = cps.length;
  while (start < end && f(cps[start].codePointAt(0)!)) start++;
  while (end > start && f(cps[end - 1].codePointAt(0)!)) end--;
  return cps.slice(start, end).join("");
}

export function trimSuffix(s: string, suffix: string): string {
  return s.endsWith(suffix) ? s.slice(0, s.length - suffix.length) : s;
}

// strconv.Atoi: an optional sign and decimal digits in the range of a 64-bit int; undefined stands for the error.
export function atoi(s: string): number | undefined {
  if (!/^[+-]?[0-9]+$/.test(s)) return undefined;
  const n = BigInt(s);
  if (n < -(2n ** 63n) || n > 2n ** 63n - 1n) return undefined;
  return Number(n);
}

// Go's regexp classes in the syntax of JavaScript, whose own \s is Unicode and whose . and flag m also see CR, U+2028 and U+2029.
export const RE2 = {
  SPACE: "[\\t\\n\\f\\r ]",
  NOT_SPACE: "[^\\t\\n\\f\\r ]",
  WORD: "[0-9A-Za-z_]",
  DIGIT: "[0-9]",
  DOT: "[^\\n]",
  LINE_START: "(?<![^\\n])",
  LINE_END: "(?![^\\n])",
} as const;

// regexp `\S` ReplaceAllString(s, " ") of a byte string: Go's \s is [\t\n\f\r ], every other rune becomes one space.
export function replaceNonWhitespace(s: ByteString): ByteString {
  let out = "";
  for (let i = 0; i < s.length; ) {
    const c = s.charCodeAt(i);
    if (c < RuneSelf) {
      out += c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20 ? s[i] : " ";
      i++;
    } else {
      i += decodeRune(s, i)[1];
      out += " ";
    }
  }
  return out;
}

// fmt "%*s" and "%*d" for ASCII text: right-aligned in a field of the given width, padded with spaces.
export function padLeft(s: string, width: number): string {
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

// strings.Compare: the order of the UTF-8 bytes, which is the order of the code points. A byte string compares by its bytes.
export function compareStrings(a: string, b: string): -1 | 0 | 1 {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let x = a.charCodeAt(i);
    let y = b.charCodeAt(i);
    if (x === y) continue;
    // A surrogate is a part of a code point above U+FFFF: it sorts after U+E000 to U+FFFF.
    if (x >= 0xd800 && y >= 0xd800) {
      x += x < 0xe000 ? 0x2000 : -0x800;
      y += y < 0xe000 ? 0x2000 : -0x800;
    }
    return x < y ? -1 : 1;
  }
  return a.length < b.length ? -1 : 1;
}

// Runs [lo, hi, step, delta]: a rune r of lo..hi with (r - lo) % step == 0 maps to r + delta.
function lookup(runs: readonly number[], r: number): number {
  let low = 0;
  let high = runs.length / 4 - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const at = middle * 4;
    if (r < runs[at]) high = middle - 1;
    else if (r > runs[at + 1]) low = middle + 1;
    else return (r - runs[at]) % runs[at + 2] === 0 ? r + runs[at + 3] : r;
  }
  return r;
}

// unicode.ToLower: the simple mapping of one rune, from the table of Go and not from the Unicode data of the runtime.
export function unicodeToLower(r: number): number {
  if (r < RuneSelf) return r >= 0x41 && r <= 0x5a ? r + 0x20 : r;
  return lookup(LOWER_RUNS, r);
}

// The smallest rune of the orbit of r under unicode.SimpleFold: two runes fold together when their keys are equal.
export function foldKey(r: number): number {
  if (r < RuneSelf) return r >= 0x61 && r <= 0x7a ? r - 0x20 : r;
  return lookup(FOLD_RUNS, r);
}

export function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) >= RuneSelf) return false;
  return true;
}

// strings.ToLower of a JavaScript string: one code point at a time, no rule of context and no mapping to two code points.
export function toLower(s: string): string {
  if (isAscii(s)) return s.toLowerCase();
  let out = "";
  for (let i = 0; i < s.length; ) {
    const c = s.codePointAt(i)!;
    out += String.fromCodePoint(unicodeToLower(c));
    i += c > 0xffff ? 2 : 1;
  }
  return out;
}

// strings.EqualFold of two JavaScript strings.
export function equalFold(a: string, b: string): boolean {
  if (a === b) return true;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i)!;
    const y = b.codePointAt(j)!;
    if (x !== y && foldKey(x) !== foldKey(y)) return false;
    i += x > 0xffff ? 2 : 1;
    j += y > 0xffff ? 2 : 1;
  }
  return i === a.length && j === b.length;
}

// Generated from go1.26.0 (Unicode 15.0.0): 1433 runes in 182 runs, 1454 runes in 210 runs.
const LOWER_RUNS: readonly number[] = [
  0x41, 0x5a, 1, 32, 0xc0, 0xd6, 1, 32, 0xd8, 0xde, 1, 32, 0x100, 0x12e, 2, 1, 0x130, 0x130, 1, -199, 0x132, 0x136, 2,
  1, 0x139, 0x147, 2, 1, 0x14a, 0x176, 2, 1, 0x178, 0x178, 1, -121, 0x179, 0x17d, 2, 1, 0x181, 0x181, 1, 210, 0x182,
  0x184, 2, 1, 0x186, 0x186, 1, 206, 0x187, 0x187, 1, 1, 0x189, 0x18a, 1, 205, 0x18b, 0x18b, 1, 1, 0x18e, 0x18e, 1, 79,
  0x18f, 0x18f, 1, 202, 0x190, 0x190, 1, 203, 0x191, 0x191, 1, 1, 0x193, 0x193, 1, 205, 0x194, 0x194, 1, 207, 0x196,
  0x196, 1, 211, 0x197, 0x197, 1, 209, 0x198, 0x198, 1, 1, 0x19c, 0x19c, 1, 211, 0x19d, 0x19d, 1, 213, 0x19f, 0x19f, 1,
  214, 0x1a0, 0x1a4, 2, 1, 0x1a6, 0x1a6, 1, 218, 0x1a7, 0x1a7, 1, 1, 0x1a9, 0x1a9, 1, 218, 0x1ac, 0x1ac, 1, 1, 0x1ae,
  0x1ae, 1, 218, 0x1af, 0x1af, 1, 1, 0x1b1, 0x1b2, 1, 217, 0x1b3, 0x1b5, 2, 1, 0x1b7, 0x1b7, 1, 219, 0x1b8, 0x1b8, 1, 1,
  0x1bc, 0x1bc, 1, 1, 0x1c4, 0x1c4, 1, 2, 0x1c5, 0x1c5, 1, 1, 0x1c7, 0x1c7, 1, 2, 0x1c8, 0x1c8, 1, 1, 0x1ca, 0x1ca, 1,
  2, 0x1cb, 0x1db, 2, 1, 0x1de, 0x1ee, 2, 1, 0x1f1, 0x1f1, 1, 2, 0x1f2, 0x1f4, 2, 1, 0x1f6, 0x1f6, 1, -97, 0x1f7, 0x1f7,
  1, -56, 0x1f8, 0x21e, 2, 1, 0x220, 0x220, 1, -130, 0x222, 0x232, 2, 1, 0x23a, 0x23a, 1, 10795, 0x23b, 0x23b, 1, 1,
  0x23d, 0x23d, 1, -163, 0x23e, 0x23e, 1, 10792, 0x241, 0x241, 1, 1, 0x243, 0x243, 1, -195, 0x244, 0x244, 1, 69, 0x245,
  0x245, 1, 71, 0x246, 0x24e, 2, 1, 0x370, 0x372, 2, 1, 0x376, 0x376, 1, 1, 0x37f, 0x37f, 1, 116, 0x386, 0x386, 1, 38,
  0x388, 0x38a, 1, 37, 0x38c, 0x38c, 1, 64, 0x38e, 0x38f, 1, 63, 0x391, 0x3a1, 1, 32, 0x3a3, 0x3ab, 1, 32, 0x3cf, 0x3cf,
  1, 8, 0x3d8, 0x3ee, 2, 1, 0x3f4, 0x3f4, 1, -60, 0x3f7, 0x3f7, 1, 1, 0x3f9, 0x3f9, 1, -7, 0x3fa, 0x3fa, 1, 1, 0x3fd,
  0x3ff, 1, -130, 0x400, 0x40f, 1, 80, 0x410, 0x42f, 1, 32, 0x460, 0x480, 2, 1, 0x48a, 0x4be, 2, 1, 0x4c0, 0x4c0, 1, 15,
  0x4c1, 0x4cd, 2, 1, 0x4d0, 0x52e, 2, 1, 0x531, 0x556, 1, 48, 0x10a0, 0x10c5, 1, 7264, 0x10c7, 0x10c7, 1, 7264, 0x10cd,
  0x10cd, 1, 7264, 0x13a0, 0x13ef, 1, 38864, 0x13f0, 0x13f5, 1, 8, 0x1c90, 0x1cba, 1, -3008, 0x1cbd, 0x1cbf, 1, -3008,
  0x1e00, 0x1e94, 2, 1, 0x1e9e, 0x1e9e, 1, -7615, 0x1ea0, 0x1efe, 2, 1, 0x1f08, 0x1f0f, 1, -8, 0x1f18, 0x1f1d, 1, -8,
  0x1f28, 0x1f2f, 1, -8, 0x1f38, 0x1f3f, 1, -8, 0x1f48, 0x1f4d, 1, -8, 0x1f59, 0x1f5f, 2, -8, 0x1f68, 0x1f6f, 1, -8,
  0x1f88, 0x1f8f, 1, -8, 0x1f98, 0x1f9f, 1, -8, 0x1fa8, 0x1faf, 1, -8, 0x1fb8, 0x1fb9, 1, -8, 0x1fba, 0x1fbb, 1, -74,
  0x1fbc, 0x1fbc, 1, -9, 0x1fc8, 0x1fcb, 1, -86, 0x1fcc, 0x1fcc, 1, -9, 0x1fd8, 0x1fd9, 1, -8, 0x1fda, 0x1fdb, 1, -100,
  0x1fe8, 0x1fe9, 1, -8, 0x1fea, 0x1feb, 1, -112, 0x1fec, 0x1fec, 1, -7, 0x1ff8, 0x1ff9, 1, -128, 0x1ffa, 0x1ffb, 1,
  -126, 0x1ffc, 0x1ffc, 1, -9, 0x2126, 0x2126, 1, -7517, 0x212a, 0x212a, 1, -8383, 0x212b, 0x212b, 1, -8262, 0x2132,
  0x2132, 1, 28, 0x2160, 0x216f, 1, 16, 0x2183, 0x2183, 1, 1, 0x24b6, 0x24cf, 1, 26, 0x2c00, 0x2c2f, 1, 48, 0x2c60,
  0x2c60, 1, 1, 0x2c62, 0x2c62, 1, -10743, 0x2c63, 0x2c63, 1, -3814, 0x2c64, 0x2c64, 1, -10727, 0x2c67, 0x2c6b, 2, 1,
  0x2c6d, 0x2c6d, 1, -10780, 0x2c6e, 0x2c6e, 1, -10749, 0x2c6f, 0x2c6f, 1, -10783, 0x2c70, 0x2c70, 1, -10782, 0x2c72,
  0x2c72, 1, 1, 0x2c75, 0x2c75, 1, 1, 0x2c7e, 0x2c7f, 1, -10815, 0x2c80, 0x2ce2, 2, 1, 0x2ceb, 0x2ced, 2, 1, 0x2cf2,
  0x2cf2, 1, 1, 0xa640, 0xa66c, 2, 1, 0xa680, 0xa69a, 2, 1, 0xa722, 0xa72e, 2, 1, 0xa732, 0xa76e, 2, 1, 0xa779, 0xa77b,
  2, 1, 0xa77d, 0xa77d, 1, -35332, 0xa77e, 0xa786, 2, 1, 0xa78b, 0xa78b, 1, 1, 0xa78d, 0xa78d, 1, -42280, 0xa790,
  0xa792, 2, 1, 0xa796, 0xa7a8, 2, 1, 0xa7aa, 0xa7aa, 1, -42308, 0xa7ab, 0xa7ab, 1, -42319, 0xa7ac, 0xa7ac, 1, -42315,
  0xa7ad, 0xa7ad, 1, -42305, 0xa7ae, 0xa7ae, 1, -42308, 0xa7b0, 0xa7b0, 1, -42258, 0xa7b1, 0xa7b1, 1, -42282, 0xa7b2,
  0xa7b2, 1, -42261, 0xa7b3, 0xa7b3, 1, 928, 0xa7b4, 0xa7c2, 2, 1, 0xa7c4, 0xa7c4, 1, -48, 0xa7c5, 0xa7c5, 1, -42307,
  0xa7c6, 0xa7c6, 1, -35384, 0xa7c7, 0xa7c9, 2, 1, 0xa7d0, 0xa7d0, 1, 1, 0xa7d6, 0xa7d8, 2, 1, 0xa7f5, 0xa7f5, 1, 1,
  0xff21, 0xff3a, 1, 32, 0x10400, 0x10427, 1, 40, 0x104b0, 0x104d3, 1, 40, 0x10570, 0x1057a, 1, 39, 0x1057c, 0x1058a, 1,
  39, 0x1058c, 0x10592, 1, 39, 0x10594, 0x10595, 1, 39, 0x10c80, 0x10cb2, 1, 64, 0x118a0, 0x118bf, 1, 32, 0x16e40,
  0x16e5f, 1, 32, 0x1e900, 0x1e921, 1, 34,
];

const FOLD_RUNS: readonly number[] = [
  0x61, 0x7a, 1, -32, 0xe0, 0xf6, 1, -32, 0xf8, 0xfe, 1, -32, 0x101, 0x12f, 2, -1, 0x133, 0x137, 2, -1, 0x13a, 0x148, 2,
  -1, 0x14b, 0x177, 2, -1, 0x178, 0x178, 1, -121, 0x17a, 0x17e, 2, -1, 0x17f, 0x17f, 1, -300, 0x183, 0x185, 2, -1,
  0x188, 0x188, 1, -1, 0x18c, 0x18c, 1, -1, 0x192, 0x192, 1, -1, 0x199, 0x199, 1, -1, 0x1a1, 0x1a5, 2, -1, 0x1a8, 0x1a8,
  1, -1, 0x1ad, 0x1ad, 1, -1, 0x1b0, 0x1b0, 1, -1, 0x1b4, 0x1b6, 2, -1, 0x1b9, 0x1b9, 1, -1, 0x1bd, 0x1bd, 1, -1, 0x1c5,
  0x1c5, 1, -1, 0x1c6, 0x1c6, 1, -2, 0x1c8, 0x1c8, 1, -1, 0x1c9, 0x1c9, 1, -2, 0x1cb, 0x1cb, 1, -1, 0x1cc, 0x1cc, 1, -2,
  0x1ce, 0x1dc, 2, -1, 0x1dd, 0x1dd, 1, -79, 0x1df, 0x1ef, 2, -1, 0x1f2, 0x1f2, 1, -1, 0x1f3, 0x1f3, 1, -2, 0x1f5,
  0x1f5, 1, -1, 0x1f6, 0x1f6, 1, -97, 0x1f7, 0x1f7, 1, -56, 0x1f9, 0x21f, 2, -1, 0x220, 0x220, 1, -130, 0x223, 0x233, 2,
  -1, 0x23c, 0x23c, 1, -1, 0x23d, 0x23d, 1, -163, 0x242, 0x242, 1, -1, 0x243, 0x243, 1, -195, 0x247, 0x24f, 2, -1,
  0x253, 0x253, 1, -210, 0x254, 0x254, 1, -206, 0x256, 0x257, 1, -205, 0x259, 0x259, 1, -202, 0x25b, 0x25b, 1, -203,
  0x260, 0x260, 1, -205, 0x263, 0x263, 1, -207, 0x268, 0x268, 1, -209, 0x269, 0x269, 1, -211, 0x26f, 0x26f, 1, -211,
  0x272, 0x272, 1, -213, 0x275, 0x275, 1, -214, 0x280, 0x280, 1, -218, 0x283, 0x283, 1, -218, 0x288, 0x288, 1, -218,
  0x289, 0x289, 1, -69, 0x28a, 0x28b, 1, -217, 0x28c, 0x28c, 1, -71, 0x292, 0x292, 1, -219, 0x371, 0x373, 2, -1, 0x377,
  0x377, 1, -1, 0x399, 0x399, 1, -84, 0x39c, 0x39c, 1, -743, 0x3ac, 0x3ac, 1, -38, 0x3ad, 0x3af, 1, -37, 0x3b1, 0x3b8,
  1, -32, 0x3b9, 0x3b9, 1, -116, 0x3ba, 0x3bb, 1, -32, 0x3bc, 0x3bc, 1, -775, 0x3bd, 0x3c1, 1, -32, 0x3c2, 0x3c2, 1,
  -31, 0x3c3, 0x3cb, 1, -32, 0x3cc, 0x3cc, 1, -64, 0x3cd, 0x3ce, 1, -63, 0x3d0, 0x3d0, 1, -62, 0x3d1, 0x3d1, 1, -57,
  0x3d5, 0x3d5, 1, -47, 0x3d6, 0x3d6, 1, -54, 0x3d7, 0x3d7, 1, -8, 0x3d9, 0x3ef, 2, -1, 0x3f0, 0x3f0, 1, -86, 0x3f1,
  0x3f1, 1, -80, 0x3f3, 0x3f3, 1, -116, 0x3f4, 0x3f4, 1, -92, 0x3f5, 0x3f5, 1, -96, 0x3f8, 0x3f8, 1, -1, 0x3f9, 0x3f9,
  1, -7, 0x3fb, 0x3fb, 1, -1, 0x3fd, 0x3ff, 1, -130, 0x430, 0x44f, 1, -32, 0x450, 0x45f, 1, -80, 0x461, 0x481, 2, -1,
  0x48b, 0x4bf, 2, -1, 0x4c2, 0x4ce, 2, -1, 0x4cf, 0x4cf, 1, -15, 0x4d1, 0x52f, 2, -1, 0x561, 0x586, 1, -48, 0x13f8,
  0x13fd, 1, -8, 0x1c80, 0x1c80, 1, -6254, 0x1c81, 0x1c81, 1, -6253, 0x1c82, 0x1c82, 1, -6244, 0x1c83, 0x1c84, 1, -6242,
  0x1c85, 0x1c85, 1, -6243, 0x1c86, 0x1c86, 1, -6236, 0x1c87, 0x1c87, 1, -6181, 0x1c90, 0x1cba, 1, -3008, 0x1cbd,
  0x1cbf, 1, -3008, 0x1e01, 0x1e95, 2, -1, 0x1e9b, 0x1e9b, 1, -59, 0x1e9e, 0x1e9e, 1, -7615, 0x1ea1, 0x1eff, 2, -1,
  0x1f08, 0x1f0f, 1, -8, 0x1f18, 0x1f1d, 1, -8, 0x1f28, 0x1f2f, 1, -8, 0x1f38, 0x1f3f, 1, -8, 0x1f48, 0x1f4d, 1, -8,
  0x1f59, 0x1f5f, 2, -8, 0x1f68, 0x1f6f, 1, -8, 0x1f88, 0x1f8f, 1, -8, 0x1f98, 0x1f9f, 1, -8, 0x1fa8, 0x1faf, 1, -8,
  0x1fb8, 0x1fb9, 1, -8, 0x1fba, 0x1fbb, 1, -74, 0x1fbc, 0x1fbc, 1, -9, 0x1fbe, 0x1fbe, 1, -7289, 0x1fc8, 0x1fcb, 1,
  -86, 0x1fcc, 0x1fcc, 1, -9, 0x1fd8, 0x1fd9, 1, -8, 0x1fda, 0x1fdb, 1, -100, 0x1fe8, 0x1fe9, 1, -8, 0x1fea, 0x1feb, 1,
  -112, 0x1fec, 0x1fec, 1, -7, 0x1ff8, 0x1ff9, 1, -128, 0x1ffa, 0x1ffb, 1, -126, 0x1ffc, 0x1ffc, 1, -9, 0x2126, 0x2126,
  1, -7549, 0x212a, 0x212a, 1, -8415, 0x212b, 0x212b, 1, -8294, 0x214e, 0x214e, 1, -28, 0x2170, 0x217f, 1, -16, 0x2184,
  0x2184, 1, -1, 0x24d0, 0x24e9, 1, -26, 0x2c30, 0x2c5f, 1, -48, 0x2c61, 0x2c61, 1, -1, 0x2c62, 0x2c62, 1, -10743,
  0x2c63, 0x2c63, 1, -3814, 0x2c64, 0x2c64, 1, -10727, 0x2c65, 0x2c65, 1, -10795, 0x2c66, 0x2c66, 1, -10792, 0x2c68,
  0x2c6c, 2, -1, 0x2c6d, 0x2c6d, 1, -10780, 0x2c6e, 0x2c6e, 1, -10749, 0x2c6f, 0x2c6f, 1, -10783, 0x2c70, 0x2c70, 1,
  -10782, 0x2c73, 0x2c73, 1, -1, 0x2c76, 0x2c76, 1, -1, 0x2c7e, 0x2c7f, 1, -10815, 0x2c81, 0x2ce3, 2, -1, 0x2cec,
  0x2cee, 2, -1, 0x2cf3, 0x2cf3, 1, -1, 0x2d00, 0x2d25, 1, -7264, 0x2d27, 0x2d27, 1, -7264, 0x2d2d, 0x2d2d, 1, -7264,
  0xa641, 0xa649, 2, -1, 0xa64a, 0xa64a, 1, -35266, 0xa64b, 0xa64b, 1, -35267, 0xa64d, 0xa66d, 2, -1, 0xa681, 0xa69b, 2,
  -1, 0xa723, 0xa72f, 2, -1, 0xa733, 0xa76f, 2, -1, 0xa77a, 0xa77c, 2, -1, 0xa77d, 0xa77d, 1, -35332, 0xa77f, 0xa787, 2,
  -1, 0xa78c, 0xa78c, 1, -1, 0xa78d, 0xa78d, 1, -42280, 0xa791, 0xa793, 2, -1, 0xa797, 0xa7a9, 2, -1, 0xa7aa, 0xa7aa, 1,
  -42308, 0xa7ab, 0xa7ab, 1, -42319, 0xa7ac, 0xa7ac, 1, -42315, 0xa7ad, 0xa7ad, 1, -42305, 0xa7ae, 0xa7ae, 1, -42308,
  0xa7b0, 0xa7b0, 1, -42258, 0xa7b1, 0xa7b1, 1, -42282, 0xa7b2, 0xa7b2, 1, -42261, 0xa7b5, 0xa7c3, 2, -1, 0xa7c4,
  0xa7c4, 1, -48, 0xa7c5, 0xa7c5, 1, -42307, 0xa7c6, 0xa7c6, 1, -35384, 0xa7c8, 0xa7ca, 2, -1, 0xa7d1, 0xa7d1, 1, -1,
  0xa7d7, 0xa7d9, 2, -1, 0xa7f6, 0xa7f6, 1, -1, 0xab53, 0xab53, 1, -928, 0xab70, 0xabbf, 1, -38864, 0xff41, 0xff5a, 1,
  -32, 0x10428, 0x1044f, 1, -40, 0x104d8, 0x104fb, 1, -40, 0x10597, 0x105a1, 1, -39, 0x105a3, 0x105b1, 1, -39, 0x105b3,
  0x105b9, 1, -39, 0x105bb, 0x105bc, 1, -39, 0x10cc0, 0x10cf2, 1, -64, 0x118c0, 0x118df, 1, -32, 0x16e60, 0x16e7f, 1,
  -32, 0x1e922, 0x1e943, 1, -34,
];

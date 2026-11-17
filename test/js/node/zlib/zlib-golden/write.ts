// Writes DEFLATE, zlib and gzip streams without any help from the code under test.
// https://www.rfc-editor.org/rfc/rfc1951 https://www.rfc-editor.org/rfc/rfc1950 https://www.rfc-editor.org/rfc/rfc1952
import { random } from "./inputs";

export class Bits {
  #bytes = Buffer.alloc(256);
  #length = 0;
  #held = 0;
  #count = 0;

  #reserve(more: number) {
    if (this.#length + more > this.#bytes.length) this.#bytes = Buffer.concat([this.#bytes], 2 * (this.#length + more));
  }

  /** The least significant bit first. At most 16. */
  put(value: number, count: number) {
    this.#reserve(2);
    this.#held |= value << this.#count;
    for (this.#count += count; this.#count >= 8; this.#count -= 8) {
      this.#bytes[this.#length++] = this.#held;
      this.#held >>>= 8;
    }
    return this;
  }

  code(code: Code) {
    return this.put(code.reversed, code.bits);
  }

  align() {
    return this.put(0, -this.#count & 7);
  }

  bytes(bytes: Uint8Array) {
    this.#reserve(bytes.length);
    this.#bytes.set(bytes, this.#length);
    this.#length += bytes.length;
    return this;
  }

  /** In bits. */
  get length() {
    return 8 * this.#length + this.#count;
  }

  end() {
    return Buffer.from(this.align().#bytes.subarray(0, this.#length));
  }
}

/** Unlike everything else, a code is written with its most significant bit first. */
type Code = { reversed: number; bits: number };

/** The code of each symbol that has a length. */
export function codesOf(lengths: number[]) {
  const symbols = lengths.flatMap((bits, symbol) => (bits ? [symbol] : []));
  const codes: Code[] = [];
  let [code, codeBits] = [0, 0];
  for (const symbol of symbols.sort((a, b) => lengths[a] - lengths[b] || a - b)) {
    const bits = lengths[symbol];
    code <<= bits - codeBits;
    codeBits = bits;
    let reversed = 0;
    for (let i = 0; i < bits; i++) reversed = (reversed << 1) | ((code >> i) & 1);
    codes[symbol] = { reversed, bits };
    code++;
  }
  return codes;
}

/** Lengths for so many symbols, of which those in `some` have one. */
export function lengths(count: number, some: Record<number, number>) {
  return Array.from({ length: count }, (_, symbol) => some[symbol] ?? 0);
}

function ranges(count: number, perGroup: number, first: number) {
  const all: { base: number; extra: number }[] = [];
  for (let i = 0, base = first; i < count; i++) {
    const extra = Math.max(0, Math.floor(i / perGroup) - 1);
    all.push({ base, extra });
    base += 1 << extra;
  }
  return all;
}
const lengthRanges = [...ranges(28, 4, 3), { base: 258, extra: 0 }];
const distanceRanges = ranges(30, 2, 1);

export const END = 256;
/** `long258` writes a length of 258 as symbol 284 with all of its extra bits set. */
export type Match = { length: number; distance: number; long258?: boolean };
export type Token = number | Match;

function indexOfRange(all: { base: number }[], max: number) {
  const indices = new Uint8Array(max + 1);
  all.forEach(({ base }, i) => indices.fill(i, base));
  return indices;
}
const [lengthIndices, distanceIndices] = [indexOfRange(lengthRanges, 258), indexOfRange(distanceRanges, 32768)];
const lengthIndex = (match: Match) => (match.long258 ? 27 : lengthIndices[match.length]);
const distanceIndex = (match: Match) => distanceIndices[match.distance];

/** Without the end of the block. */
export function putTokens(bits: Bits, tokens: Token[], literalCodes: Code[], distanceCodes: Code[]) {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (typeof token === "number") {
      bits.code(literalCodes[token]);
      continue;
    }
    const l = lengthIndex(token);
    const d = distanceIndex(token);
    bits.code(literalCodes[END + 1 + l]).put(token.length - lengthRanges[l].base, lengthRanges[l].extra);
    bits.code(distanceCodes[d]).put(token.distance - distanceRanges[d].base, distanceRanges[d].extra);
  }
  return bits;
}

export const [STORED, FIXED, DYNAMIC] = [0, 1, 2];
export const header = (bits: Bits, type: number, last: boolean) => bits.put(+last, 1).put(type, 2);

export function stored(bits: Bits, data: Uint8Array, last: boolean) {
  return header(bits, STORED, last)
    .align()
    .put(data.length, 16)
    .put(~data.length & 0xffff, 16)
    .bytes(data);
}

export const fixedLiteralCodes = codesOf(
  Array.from({ length: 288 }, (_, s) => (s < 144 ? 8 : s < 256 ? 9 : s < 280 ? 7 : 8)),
);
export const fixedDistanceCodes = codesOf(Array(32).fill(5));

export function fixed(bits: Bits, tokens: Token[], last: boolean) {
  header(bits, FIXED, last);
  return putTokens(bits, tokens, fixedLiteralCodes, fixedDistanceCodes).code(fixedLiteralCodes[END]);
}

export const codeLengthOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** `codeLengthLengths` is by symbol. So many of them are written as `sent` says. */
export function dynamicCounts(bits: Bits, literals: number, distances: number, codeLengthLengths: number[], sent = 19) {
  bits
    .put(literals - 257, 5)
    .put(distances - 1, 5)
    .put(sent - 4, 4);
  for (const symbol of codeLengthOrder.slice(0, sent)) bits.put(codeLengthLengths[symbol] ?? 0, 3);
  return bits;
}

/** The header of a dynamic block in the plainest way: four bits for each length. */
export function dynamicHeader(bits: Bits, literalLengths: number[], distanceLengths: number[], last: boolean) {
  const plain = Array(16).fill(4);
  dynamicCounts(header(bits, DYNAMIC, last), literalLengths.length, distanceLengths.length, plain);
  const codes = codesOf(plain);
  for (const length of [...literalLengths, ...distanceLengths]) bits.code(codes[length]);
  return bits;
}

export function dynamic(bits: Bits, literals: number[], distances: number[], tokens: Token[], last: boolean) {
  const literalCodes = codesOf(literals);
  dynamicHeader(bits, literals, distances, last);
  return putTokens(bits, tokens, literalCodes, codesOf(distances)).code(literalCodes[END]);
}

type Next = ReturnType<typeof random>;

/** The lengths of a complete code for `symbols`, of any shape from even to as lopsided as `max` allows. */
function randomCode(next: Next, symbols: number[], max: number) {
  const depths = [1, 1];
  const lopsided = next(4);
  while (depths.length < symbols.length) {
    let leaf = next(4) < lopsided ? depths.length - 1 : next(depths.length);
    while (depths[leaf] === max) leaf = (leaf + 1) % depths.length;
    depths.push(++depths[leaf]);
  }
  const some: Record<number, number> = {};
  for (const symbol of symbols) some[symbol] = depths.splice(next(depths.length), 1)[0];
  return some;
}

function withSpares(next: Next, used: Set<number>, count: number) {
  for (let spares = next(3) ? next(4) : next(count); spares--;) used.add(next(count));
  while (used.size < 2) used.add(next(count));
  return [...used];
}

function randomDynamic(next: Next, bits: Bits, tokens: Token[], last: boolean) {
  const matches = tokens.filter(token => typeof token !== "number");
  const usedLiterals = new Set([END, ...tokens.map(t => (typeof t === "number" ? t : END + 1 + lengthIndex(t)))]);
  const usedDistances = new Set(matches.map(distanceIndex));
  const literalCode = randomCode(next, withSpares(next, usedLiterals, 286), 15);
  // A distance code may be a single bit for one symbol, or be missing.
  const distanceCode =
    usedDistances.size < 2 && next(2)
      ? Object.fromEntries([...usedDistances].map(symbol => [symbol, 1]))
      : randomCode(next, withSpares(next, usedDistances, 30), 15);
  const atLeast = (code: object, min: number) => Math.max(min, ...Object.keys(code).map(symbol => +symbol + 1));
  const between = (min: number, max: number) => min + next(max - min + 1);
  const literals = lengths(between(atLeast(literalCode, 257), 286), literalCode);
  const distances = lengths(between(atLeast(distanceCode, 1), 30), distanceCode);

  const all = [...literals, ...distances];
  const runs: [symbol: number, extra: number, extraBits: number][] = [];
  for (let at = 0; at < all.length;) {
    let same = 1;
    while (all[at + same] === all[at]) same++;
    const [symbol, min, extraBits] =
      all[at] === 0 && same >= 11 && next(8)
        ? [18, 11, 7]
        : all[at] === 0 && same >= 3 && next(4)
          ? [17, 3, 3]
          : at > 0 && all[at - 1] === all[at] && same >= 3 && next(4)
            ? [16, 3, 2]
            : [all[at], 1, 0];
    const most = Math.min(same, min + (1 << extraBits) - 1);
    const run = next(3) ? most : between(min, most);
    runs.push([symbol, run - min, extraBits]);
    at += run;
  }
  const codeLengthCode = lengths(19, randomCode(next, withSpares(next, new Set(runs.map(run => run[0])), 19), 7));
  const needed = Math.max(4, 1 + codeLengthOrder.findLastIndex(symbol => codeLengthCode[symbol]));
  dynamicCounts(header(bits, DYNAMIC, last), literals.length, distances.length, codeLengthCode, between(needed, 19));
  const codeLengthCodes = codesOf(codeLengthCode);
  for (const [symbol, extra, extraBits] of runs) bits.code(codeLengthCodes[symbol]).put(extra, extraBits);
  const literalCodes = codesOf(literals);
  putTokens(bits, tokens, literalCodes, codesOf(distances)).code(literalCodes[END]);
}

/**
 * A valid raw stream that makes use of what the format allows, whether or not a compressor would, and what it stands
 * for: about `size` bytes, with matches from up to `window` bytes back, where `dictionary` comes first.
 */
export function randomStream(seed: number, size: number, window = 32768, dictionary: Uint8Array = Buffer.alloc(0)) {
  const next = random(seed);
  const plain = Buffer.alloc(dictionary.length + size + 258);
  plain.set(dictionary);
  const [bits, end] = [new Bits(), dictionary.length + size];
  let at = dictionary.length;
  for (let last = false; !last;) {
    const blockEnd = Math.min(end, at + (next(4) ? next(1 + (size >> 1)) : next(8)));
    const [type, alphabet, matchOdds, longest] = [next(5), 1 + next(next(2) ? 256 : 12), next(8), next(3)];
    if (type === STORED) {
      const start = at;
      while (at < Math.min(blockEnd, start + 65535)) plain[at++] = next(alphabet);
      last = at >= end && next(3) > 0;
      stored(bits, plain.subarray(start, at), last);
      continue;
    }
    const tokens: Token[] = [];
    while (at < blockEnd) {
      if (at === 0 || next(8) >= matchOdds) {
        tokens.push((plain[at++] = 255 - next(alphabet)));
        continue;
      }
      const reach = Math.min(at, window);
      const distance = next(6) ? 1 + next(Math.min(reach, 1 << next(16))) : reach - next(Math.min(reach, 3));
      const length = next(16) ? 3 + next([8, 40, 256][longest]) : 258;
      tokens.push({ length, distance, long258: length === 258 && next(2) === 0 });
      plain.fill(Buffer.from(plain.subarray(at - distance, Math.min(at, at - distance + length))), at, at + length);
      at += length;
    }
    last = at >= end && next(3) > 0;
    if (type === FIXED) fixed(bits, tokens, last);
    else randomDynamic(next, bits, tokens, last);
  }
  return { raw: bits.end(), plain: plain.subarray(dictionary.length, at) };
}

export function adler32(data: Uint8Array) {
  let [a, b] = [1, 0];
  for (let i = 0; i < data.length; i++) b = (b + (a = (a + data[i]) % 65521)) % 65521;
  return ((b << 16) | a) >>> 0;
}

const crcTable = Int32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n;
});

export function crc32(data: Uint8Array, crc = 0) {
  crc = ~crc;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 255] ^ (crc >>> 8);
  return ~crc >>> 0;
}

export const le = (value: number, size: number) => be(value, size).reverse();
export function be(value: number, size: number) {
  const out = Buffer.alloc(size);
  out.writeUIntBE(value, 0, size);
  return out;
}

/** The two bytes that start a zlib stream, with the check bits that fit the others. */
export function zlibHeader(methodAndWindow: number, flags = 0) {
  return Buffer.from([methodAndWindow, flags + ((31 - ((methodAndWindow * 256 + flags) % 31)) % 31)]);
}

export function inZlib(raw: Uint8Array, plain: Uint8Array, windowBits = 15, dictionary?: Uint8Array) {
  const start = zlibHeader(((windowBits - 8) << 4) | 8, dictionary ? 0x20 : 0);
  return Buffer.concat([start, ...(dictionary ? [be(adler32(dictionary), 4)] : []), raw, be(adler32(plain), 4)]);
}

export type GzipFields = { text?: boolean; extra?: Uint8Array; name?: string; comment?: string; headerCrc?: boolean };

export function gzipHeader({ text, extra, name, comment, headerCrc }: GzipFields = {}) {
  const flags =
    (text ? 1 : 0) | (headerCrc ? 2 : 0) | (extra ? 4 : 0) | (name != null ? 8 : 0) | (comment != null ? 16 : 0);
  const fields = Buffer.concat([
    Buffer.from([0x1f, 0x8b, 8, flags, 0x78, 0x56, 0x34, 0x12, 2, 11]),
    ...(extra ? [le(extra.length, 2), extra] : []),
    ...[name, comment].filter(it => it != null).map(it => Buffer.from(`${it}\0`, "latin1")),
  ]);
  return headerCrc ? Buffer.concat([fields, le(crc32(fields) & 0xffff, 2)]) : fields;
}

export const inGzip = (raw: Uint8Array, plain: Uint8Array, fields?: GzipFields) =>
  Buffer.concat([gzipHeader(fields), raw, le(crc32(plain), 4), le(plain.length, 4)]);

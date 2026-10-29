// Pure-JS port of `Wyhash11` (the legacy 32-byte-round, 5-prime wyhash variant
// in src/wyhash/lib.rs). `Wyhash11::hash(0, bytes)` keys the lockfile string
// interning pool (`semver::string::Buf`), so two different strings whose bytes
// collide under this function share one pool slot. Use this to confirm a
// collision holds before a test relies on it. This is a different algorithm
// from `Bun.hash.wyhash` (the final4 variant); do not substitute one for the
// other.

const MASK = (1n << 64n) - 1n;
const M128 = (1n << 128n) - 1n;
const P = [0xa0761d6478bd642fn, 0xe7037ed1a0b428dbn, 0x8ebc6af09c88c6e3n, 0x589965cc75374cc3n, 0x1d8e4e27c47d124fn];

function rd(n: number, d: Uint8Array, o: number): bigint {
  let r = 0n;
  for (let i = 0; i < n; i++) r |= BigInt(d[o + i]) << BigInt(8 * i);
  return r;
}
// read_8bytes_swapped: the two 32-bit halves are swapped relative to a plain LE u64.
const rd8sw = (d: Uint8Array, o: number) => ((rd(4, d, o) << 32n) | rd(4, d, o + 4)) & MASK;

function mum(a: bigint, b: bigint): bigint {
  const r = ((a & MASK) * (b & MASK)) & M128;
  return ((r >> 64n) ^ r) & MASK;
}
const mix0 = (a: bigint, b: bigint, s: bigint) => mum((a ^ s ^ P[0]) & MASK, (b ^ s ^ P[1]) & MASK);
const mix1 = (a: bigint, b: bigint, s: bigint) => mum((a ^ s ^ P[2]) & MASK, (b ^ s ^ P[3]) & MASK);

function byteWord(k: Uint8Array, o: number, len: number): bigint {
  // Reproduces the `read4<<N | read2<<M | read1` tail assembly for 1..=7 bytes.
  switch (len) {
    case 1:
      return rd(1, k, o);
    case 2:
      return rd(2, k, o);
    case 3:
      return (rd(2, k, o) << 8n) | rd(1, k, o + 2);
    case 4:
      return rd(4, k, o);
    case 5:
      return (rd(4, k, o) << 8n) | rd(1, k, o + 4);
    case 6:
      return (rd(4, k, o) << 16n) | rd(2, k, o + 4);
    case 7:
      return (rd(4, k, o) << 24n) | (rd(2, k, o + 4) << 8n) | rd(1, k, o + 6);
    default:
      throw new Error("byteWord: len must be 1..=7, got " + len);
  }
}

function finalSeed(seed: bigint, k: Uint8Array, o: number, len: number): bigint {
  if (len === 0) return seed;
  if (len <= 7) return mix0(byteWord(k, o, len), P[4], seed);
  if (len === 8) return mix0(rd8sw(k, o), P[4], seed);
  if (len <= 15) return mix0(rd8sw(k, o), byteWord(k, o + 8, len - 8), seed);
  if (len === 16) return mix0(rd8sw(k, o), rd8sw(k, o + 8), seed);
  // 17..=31: head over the first 16 bytes, tail over the remainder.
  const head = mix0(rd8sw(k, o), rd8sw(k, o + 8), seed);
  const remLen = len - 16;
  const tail =
    remLen <= 7
      ? mix1(byteWord(k, o + 16, remLen), P[4], seed)
      : mix1(rd8sw(k, o + 16), remLen === 8 ? P[4] : byteWord(k, o + 24, remLen - 8), seed);
  return (head ^ tail) & MASK;
}

export function wyhash11(seed: bigint | number, bytes: Uint8Array): bigint {
  let s = BigInt(seed) & MASK;
  const len = bytes.length;
  const aligned = len - (len % 32);
  let off = 0;
  while (off < aligned) {
    s =
      (mix0(rd(8, bytes, off), rd(8, bytes, off + 8), s) ^ mix1(rd(8, bytes, off + 16), rd(8, bytes, off + 24), s)) &
      MASK;
    off += 32;
  }
  const finalLen = len - aligned;
  const s2 = finalSeed(s, bytes, aligned, finalLen);
  const msgLen = BigInt(aligned + finalLen);
  return mum((s2 ^ msgLen) & MASK, P[4]);
}

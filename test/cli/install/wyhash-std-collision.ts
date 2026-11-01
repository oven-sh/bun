// Helper for constructing Zig std.hash.Wyhash (== `Bun.hash.wyhash` == the
// `bun.hash` seed-0 function used to key the folder-resolution dedupe map)
// collisions at runtime. Two inputs that share a prefix aligned to a 48-byte
// round boundary and an identical tail, differing only in a "free" 8-byte word,
// hash identically because one round lane is driven to a zero operand. Callers
// must self-verify the returned pair against `Bun.hash.wyhash` before relying
// on it. Ported from the reporter's proof of concept for
// https://github.com/oven-sh/bun/issues/32741.

const MASK = (1n << 64n) - 1n;
const M128 = (1n << 128n) - 1n;
const SECRET = [0xa0761d6478bd642fn, 0xe7037ed1a0b428dbn, 0x8ebc6af09c88c6e3n, 0x589965cc75374cc3n];

function mumLoHi(a: bigint, b: bigint) {
  const x = (a * b) & M128;
  return { lo: x & MASK, hi: (x >> 64n) & MASK };
}
function mix(a: bigint, b: bigint): bigint {
  const { lo, hi } = mumLoHi(a & MASK, b & MASK);
  return (lo ^ hi) & MASK;
}
function read(n: number, data: Uint8Array, off: number): bigint {
  let r = 0n;
  for (let i = 0; i < n; i++) r |= BigInt(data[off + i]) << BigInt(8 * i);
  return r;
}
function initState0(seed: bigint): bigint {
  seed &= MASK;
  return (seed ^ mix((seed ^ SECRET[0]) & MASK, SECRET[1])) & MASK;
}
function wyhashStd(seed: bigint, bytes: Uint8Array): bigint {
  seed = BigInt(seed) & MASK;
  const len = bytes.length;
  const s0 = initState0(seed);
  const state = [s0, s0, s0];
  let a = 0n;
  let b = 0n;
  if (len <= 16) {
    if (len >= 4) {
      const end = len - 4;
      const quarter = (len >> 3) << 2;
      a = ((read(4, bytes, 0) << 32n) | read(4, bytes, quarter)) & MASK;
      b = ((read(4, bytes, end) << 32n) | read(4, bytes, end - quarter)) & MASK;
    } else if (len > 0) {
      a = ((BigInt(bytes[0]) << 16n) | (BigInt(bytes[len >> 1]) << 8n) | BigInt(bytes[len - 1])) & MASK;
      b = 0n;
    }
  } else {
    let i = 0;
    if (len >= 48) {
      while (i + 48 < len) {
        for (let j = 0; j < 3; j++) {
          const av = read(8, bytes, i + 16 * j);
          const bv = read(8, bytes, i + 16 * j + 8);
          state[j] = mix((av ^ SECRET[j + 1]) & MASK, (bv ^ state[j]) & MASK);
        }
        i += 48;
      }
      state[0] = (state[0] ^ state[1] ^ state[2]) & MASK;
    }
    let k = i;
    while (k + 16 < len) {
      state[0] = mix((read(8, bytes, k) ^ SECRET[1]) & MASK, (read(8, bytes, k + 8) ^ state[0]) & MASK);
      k += 16;
    }
    a = read(8, bytes, len - 16);
    b = read(8, bytes, len - 8);
  }
  a = (a ^ SECRET[1]) & MASK;
  b = (b ^ state[0]) & MASK;
  const { lo, hi } = mumLoHi(a, b);
  return mix((lo ^ SECRET[0] ^ BigInt(len)) & MASK, (hi ^ SECRET[1]) & MASK);
}
function roundsOver(seed: bigint, bytes: Uint8Array, count: number): bigint[] {
  const s0 = initState0(BigInt(seed) & MASK);
  const state = [s0, s0, s0];
  for (let r = 0; r < count; r++) {
    const off = r * 48;
    for (let j = 0; j < 3; j++) {
      const av = read(8, bytes, off + 16 * j);
      const bv = read(8, bytes, off + 16 * j + 8);
      state[j] = mix((av ^ SECRET[j + 1]) & MASK, (bv ^ state[j]) & MASK);
    }
  }
  return state;
}

const enc = (s: string) => new TextEncoder().encode(s);
const u64le = (v: bigint) => {
  const b = new Uint8Array(8);
  for (let i = 0; i < 8; i++) b[i] = Number((v >> BigInt(8 * i)) & 0xffn);
  return b;
};

// Build two byte arrays of the form `${prefixStr}<steerable bytes>${suffixStr}`
// that collide under std.Wyhash(seed). The steerable region stays within
// `charset` so it remains a valid path component.
export function constructStdCollision(opts: {
  seed?: bigint;
  prefixStr: string;
  suffixStr: string;
  charset?: string;
  freeA?: string;
  freeB?: string;
  padFillCh?: string;
  maxSteer?: number;
}): { bytes1: Uint8Array; bytes2: Uint8Array; str1: string; str2: string; hash: bigint } {
  const {
    seed = 0n,
    prefixStr,
    suffixStr,
    // A wider charset means the derived kill word lands in-set sooner, so the
    // search needs fewer iterations. Every char here is valid in a `file:` dep
    // folder name (verified) and round-trips through a JS string.
    charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_=+,.~@!()[]{}^&$;'",
    freeA = "AAAAAAAA",
    freeB = "BBBBBBBB",
    padFillCh = "x",
    maxSteer = 5_000_000,
  } = opts;
  if (freeA.length !== 8 || freeB.length !== 8) throw new Error("free words must be 8 bytes");
  const csBytes = [...charset].map(c => c.charCodeAt(0));
  const inSet = new Uint8Array(256);
  for (const b of csBytes) inSet[b] = 1;
  const padCode = padFillCh.charCodeAt(0);
  const prefix = enc(prefixStr);
  const suffix = enc(suffixStr);
  const basePad = (48 - (prefix.length % 48)) % 48;
  const lane12 = enc("klmnopqrstuvwxyzABCDEFGHIJKLMNOP");
  const steerTail = enc("qrstuvwxyzABCDEFGHIJKLMNOPqrstuv");

  // `prefix + pad` is aligned to a 48-byte boundary, so its rounds are fixed
  // across the search. Process them once and vary only the steer round whose
  // lane-0 output (state[0]) becomes the required "kill" word.
  const baseBlock = new Uint8Array(prefix.length + basePad);
  baseBlock.set(prefix, 0);
  baseBlock.fill(padCode, prefix.length);
  const baseState0 = roundsOver(seed, baseBlock, baseBlock.length / 48)[0];

  // Lane 0 of the steer round reads two words: the first one is the search
  // counter, written in base charset.length, the second one is fixed. About one
  // in (256 / charset.length) ** 8 candidates (~9000 tries) yields an in-charset
  // kill word, and BigInt arithmetic is slow in debug builds of JavaScriptCore,
  // so the loop below spends as few BigInt operations per candidate as it can:
  // the counter word is updated incrementally from these per-digit tables
  // instead of being re-read from bytes, and the lane is mixed inline.
  const steer = new Uint8Array(48);
  for (let i = 8; i < 16; i++) steer[i] = csBytes[(i * 7) % csBytes.length];
  steer.set(steerTail, 16);
  const fixedWord = (read(8, steer, 8) ^ baseState0) & MASK;
  const digits = new Uint32Array(8);
  // step[i][k]: what adding one to digit i (now k - 1) adds to the counter word;
  // wrap[i]: what resetting digit i from its highest value to 0 adds.
  const step = Array.from({ length: 8 }, (_, i) =>
    csBytes.map((b, k) => (k === 0 ? 0n : BigInt(b - csBytes[k - 1]) << BigInt(8 * i))),
  );
  const wrap = Array.from({ length: 8 }, (_, i) => BigInt(csBytes[0] - csBytes[csBytes.length - 1]) << BigInt(8 * i));
  let counterWord = 0n;
  for (let i = 0; i < 8; i++) counterWord |= BigInt(csBytes[0]) << BigInt(8 * i);

  for (let tries = 0; tries < maxSteer; tries++) {
    if (tries > 0) {
      let i = 0;
      while (true) {
        if (++digits[i] < csBytes.length) {
          counterWord += step[i][digits[i]];
          break;
        }
        digits[i] = 0;
        counterWord += wrap[i];
        if (++i === 8) throw new Error("search space exhausted");
      }
    }
    // state[0] after the steer round (== mix(counterWord ^ SECRET[1], fixedWord));
    // it is the kill word the control lane needs, so it must be in-charset.
    const product = (counterWord ^ SECRET[1]) * fixedWord;
    const state0 = (product & MASK) ^ (product >> 64n);
    const low = Number(state0 & 0xffffffffn);
    const high = Number(state0 >> 32n);
    if (
      !(
        inSet[low & 0xff] &&
        inSet[(low >>> 8) & 0xff] &&
        inSet[(low >>> 16) & 0xff] &&
        inSet[low >>> 24] &&
        inSet[high & 0xff] &&
        inSet[(high >>> 8) & 0xff] &&
        inSet[(high >>> 16) & 0xff] &&
        inSet[high >>> 24]
      )
    ) {
      continue;
    }
    const killBytes = u64le(state0);
    for (let i = 0; i < 8; i++) steer[i] = csBytes[digits[i]];

    const preBlock = new Uint8Array(baseBlock.length + 48);
    preBlock.set(baseBlock, 0);
    preBlock.set(steer, baseBlock.length);
    const total = preBlock.length + 48 + suffix.length;
    const build = (free: string) => {
      const out = new Uint8Array(total);
      out.set(preBlock, 0);
      out.set(enc(free), preBlock.length);
      out.set(killBytes, preBlock.length + 8);
      out.set(lane12, preBlock.length + 16);
      out.set(suffix, preBlock.length + 48);
      return out;
    };
    const b1 = build(freeA);
    const b2 = build(freeB);
    if (wyhashStd(seed, b1) === wyhashStd(seed, b2) && Buffer.compare(Buffer.from(b1), Buffer.from(b2)) !== 0) {
      return {
        bytes1: b1,
        bytes2: b2,
        str1: new TextDecoder().decode(b1),
        str2: new TextDecoder().decode(b2),
        hash: wyhashStd(seed, b1),
      };
    }
  }
  throw new Error("failed to steer kill word in-charset within budget");
}

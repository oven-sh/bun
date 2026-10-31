// UTF-8 with ill-formed sequences, and what a WHATWG decoder gives for it.
// `toUTF16Alloc.test.ts` uses these in its own process. It also runs this file
// as a child for each simdutf kernel that the machine has.

// The UTF-8 decoder of https://encoding.spec.whatwg.org/#utf-8-decoder: one
// U+FFFD for each maximal subpart of an ill-formed sequence.
export function decodeReference(bytes: Uint8Array): { text: string; errors: number } {
  const units: number[] = [];
  let errors = 0;
  let codePoint = 0;
  let needed = 0;
  let lower = 0x80;
  let upper = 0xbf;
  const replace = () => {
    units.push(0xfffd);
    errors++;
  };
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (needed === 0) {
      if (byte <= 0x7f) {
        units.push(byte);
      } else if (byte >= 0xc2 && byte <= 0xdf) {
        needed = 1;
        codePoint = byte & 0x1f;
      } else if (byte >= 0xe0 && byte <= 0xef) {
        if (byte === 0xe0) lower = 0xa0;
        if (byte === 0xed) upper = 0x9f;
        needed = 2;
        codePoint = byte & 0xf;
      } else if (byte >= 0xf0 && byte <= 0xf4) {
        if (byte === 0xf0) lower = 0x90;
        if (byte === 0xf4) upper = 0x8f;
        needed = 3;
        codePoint = byte & 0x7;
      } else {
        replace();
      }
      continue;
    }
    if (byte < lower || byte > upper) {
      codePoint = needed = 0;
      lower = 0x80;
      upper = 0xbf;
      replace();
      // This byte is not part of the sequence: decode it again, as a first byte.
      i--;
      continue;
    }
    lower = 0x80;
    upper = 0xbf;
    codePoint = (codePoint << 6) | (byte & 0x3f);
    if (--needed === 0) {
      if (codePoint > 0xffff) {
        codePoint -= 0x10000;
        units.push(0xd800 + (codePoint >> 10), 0xdc00 + (codePoint & 0x3ff));
      } else {
        units.push(codePoint);
      }
      codePoint = 0;
    }
  }
  if (needed !== 0) replace();
  let text = "";
  for (let i = 0; i < units.length; i += 8192) text += String.fromCharCode.apply(null, units.slice(i, i + 8192));
  return { text, errors };
}

// Seeded, so that a failure names an input that can be built again.
export function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const illFormed = [
  [0xff], // never valid
  [0xf8], // lead of a 5-byte form
  [0x80], // continuation byte with no lead
  [0xbf, 0xbf, 0xbf, 0xbf, 0xbf],
  [0xc0, 0xaf], // overlong, 2 bytes
  [0xc1, 0xbf],
  [0xe0, 0x80, 0xaf], // overlong, 3 bytes
  [0xf0, 0x80, 0x80, 0xaf], // overlong, 4 bytes
  [0xed, 0xa0, 0x80], // surrogates
  [0xed, 0xbf, 0xbf],
  [0xf4, 0x90, 0x80, 0x80], // above U+10FFFF
  [0xc3], // sequences that end early
  [0xe4, 0xb8],
  [0xe4],
  [0xf0, 0x9f, 0x98],
  [0xf0, 0x9f],
  [0xf0],
  [0xff, 0x7f], // the last ASCII byte after each kind of sequence
  [0xc3, 0xa9, 0x7f],
].map(bytes => ({ bytes: Buffer.from(bytes), text: decodeReference(Uint8Array.from(bytes)).text }));

// One character of each encoded length. None starts with a continuation
// byte, so the text around an ill-formed sequence does not change what the
// sequence decodes to.
export const wellFormed = ["a", "é", "世", "😀"];

// `count` copies of `text`. Built as UTF-16, so that the decoder under test has no part in it.
export function repeat(text: string, count: number) {
  return Buffer.alloc(Buffer.byteLength(text, "utf16le") * count, text, "utf16le").toString("utf16le");
}

export function randomInput(random: () => number, length: number, errorRate: number): Buffer {
  const bytes: number[] = [];
  const width = Math.floor(random() * 5); // 4: all of them
  while (bytes.length < length) {
    if (random() < errorRate) bytes.push(...illFormed[Math.floor(random() * illFormed.length)].bytes);
    const w = width === 4 || random() < 0.2 ? Math.floor(random() * 4) : width;
    if (w === 0) bytes.push(0x20 + Math.floor(random() * 0x60));
    else if (w === 1) {
      const cp = 0x80 + Math.floor(random() * 0x780);
      bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (w === 2) {
      let cp = 0x800 + Math.floor(random() * 0xf800);
      // Not a surrogate, and not U+FEFF: some APIs drop a leading byte order mark.
      if ((cp >= 0xd800 && cp <= 0xdfff) || cp === 0xfeff) cp = 0x4e16;
      bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      const cp = 0x10000 + Math.floor(random() * 0x100000);
      bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
  }
  return Buffer.from(bytes);
}

// On a difference the message names the first unit that differs, not megabytes of text.
export function expectSameText(text: string, expected: string, what: string) {
  if (text === expected) return;
  let i = 0;
  while (i < text.length && i < expected.length && text.charCodeAt(i) === expected.charCodeAt(i)) i++;
  const unit = (s: string) => (i < s.length ? "0x" + s.charCodeAt(i).toString(16) : "the end");
  throw new Error(
    `${what}: unit ${i} is ${unit(text)}, expected ${unit(expected)} (${text.length} units, expected ${expected.length})`,
  );
}

export type Decoders = Record<string, (input: Buffer) => string>;

// Each ill-formed sequence at each offset of the 64-byte blocks that simdutf
// reads, in text of `character`. Returns how many inputs it checked.
export function checkEachBlockOffset(character: string, decoders: Decoders) {
  const width = Buffer.byteLength(character);
  const after = Math.ceil(600 / width);
  let checked = 0;
  for (const bad of illFormed) {
    // 70 bytes of text in front reach each offset of a block.
    for (let before = 0; before * width < 70; before++) {
      const input = Buffer.concat([
        Buffer.alloc(before * width, character),
        bad.bytes,
        Buffer.alloc(after * width, character),
      ]);
      const expected = repeat(character, before) + bad.text + repeat(character, after);
      for (const [name, decode] of Object.entries(decoders)) {
        expectSameText(
          decode(input),
          expected,
          `${name}, [${[...bad.bytes].map(b => b.toString(16))}] after ${before} of ${character}`,
        );
      }
      checked++;
    }
  }
  return checked;
}

// Seeded random text with ill-formed sequences. Returns how many inputs it checked.
export function checkRandom(
  seeds: number,
  decoders: Decoders,
  fatal?: (input: Buffer, errors: number, expected: string, what: string) => void,
) {
  for (let seed = 1; seed <= seeds; seed++) {
    const random = mulberry32(seed);
    const length = random() < 0.1 ? Math.floor(random() * 20000) : Math.floor(random() * 1200);
    const errorRate = [0, 0.0005, 0.005, 0.05, 0.5][Math.floor(random() * 5)];
    let input = randomInput(random, length, errorRate);
    // A cut at either end leaves a sequence with no lead or with no tail.
    if (random() < 0.3) input = input.subarray(Math.floor(random() * 4));
    if (random() < 0.3) input = input.subarray(0, Math.max(0, input.length - Math.floor(random() * 4)));
    const { text: expected, errors } = decodeReference(input);
    for (const [name, decode] of Object.entries(decoders)) {
      expectSameText(decode(input), expected, `${name}, seed ${seed}`);
    }
    fatal?.(input, errors, expected, `seed ${seed}`);
  }
  return seeds;
}

if (import.meta.main) {
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  const decoders: Decoders = {
    "Buffer#toString": input => input.toString("utf8"),
    "TextDecoder": input => decoder.decode(input),
  };
  let checked = 0;
  for (const character of wellFormed) checked += checkEachBlockOffset(character, decoders);
  checked += checkRandom(80, decoders);
  console.log(JSON.stringify({ checked }));
}

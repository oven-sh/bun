// What `Bun.Image` does with a JPEG file and what it makes of pixels, in a form that can be recorded and compared.
// Shared by record.ts and the tests of the JPEG codec.
import { deflateSync, gunzipSync } from "node:zlib";

export type DecodeCase = {
  name: string;
  /** What the damage to the copies depends on. A file keeps it when others come or go. */
  seed: number;
  /** The file, in base64. */
  data: string;
  /** One line for the file and one for each damaged copy of it. See `observeDecode`. */
  expected?: string[];
};

export async function load<T>(path: string): Promise<T> {
  return JSON.parse(gunzipSync(await Bun.file(path).bytes()).toString());
}

export async function store(path: string, value: unknown) {
  await Bun.write(path, Bun.gzipSync(Buffer.from(JSON.stringify(value)), { level: 9 }));
}

export function hash(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 10);
}

/** Much less work for a debug build than `inflateSync` of node:zlib. */
const inflate = (pieces: Uint8Array[]) => Bun.inflateSync(Buffer.concat(pieces), { windowBits: 15 });

/** The pixels and the ICC profile of an 8-bit RGBA PNG, without the help of `Bun.Image`. */
export function readPng(png: Uint8Array): { width: number; height: number; rgba: Uint8Array; icc?: Uint8Array } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const idat: Uint8Array[] = [];
  let icc: Uint8Array | undefined;
  for (let at = 8; at < png.length; at += 12 + view.getUint32(at)) {
    const data = png.subarray(at + 8, at + 8 + view.getUint32(at));
    if (view.getUint32(at + 4) === 0x49444154) idat.push(data);
    // iCCP: a name, a zero, the compression method, the profile.
    if (view.getUint32(at + 4) === 0x69434350) icc = inflate([data.subarray(data.indexOf(0) + 2)]);
  }
  const raw = inflate(idat);
  const stride = width * 4;
  const rgba = new Uint8Array(stride * height);
  for (let y = 0, p = 0; y < height; y++) {
    const filter = raw[p++];
    const row = y * stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? rgba[row + i - 4] : 0;
      const up = y > 0 ? rgba[row - stride + i] : 0;
      const corner = y > 0 && i >= 4 ? rgba[row - stride + i - 4] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - corner;
        const a = Math.abs(estimate - left);
        const b = Math.abs(estimate - up);
        const c = Math.abs(estimate - corner);
        predicted = a <= b && a <= c ? left : b <= c ? up : corner;
      }
      rgba[row + i] = (raw[p++] + predicted) & 255;
    }
  }
  return { width, height, rgba, icc };
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "latin1");
  chunk.set(data, 8);
  chunk.writeUInt32BE(Bun.hash.crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

export function pngOfPixels(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 1 })),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

/** xorshift32 */
export function random(seed: number): (below: number) => number {
  let state = seed | 1;
  return below => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % below;
  };
}

async function outcome(run: () => Promise<string>): Promise<string> {
  try {
    return await run();
  } catch (error: any) {
    return String(error.code);
  }
}

const pngOf = (image: Bun.Image) => image.png({ compressionLevel: 1 }).bytes();

function describe(png: Uint8Array): string {
  const { width, height, rgba, icc } = readPng(png);
  return `${width}x${height}:${hash(rgba)},icc:${icc ? `${icc.length}:${hash(icc)}` : "none"}`;
}

/** `Decoder::scalable` of src/jpeg: 8 bits, not lossless, sampled in a way that TurboJPEG has a name for. */
function scalable(file: Uint8Array): boolean {
  for (let at = 2; at + 4 <= file.length;) {
    const marker = file[at + 1];
    if (file[at] !== 0xff || marker === 0xff) at++;
    else if (marker <= 0x01 || (marker >= 0xd0 && marker <= 0xd9)) at += 2;
    else if (marker < 0xc0 || marker > 0xcf || marker === 0xc4 || marker === 0xc8 || marker === 0xcc)
      at += 2 + ((file[at + 2] << 8) | file[at + 3]);
    else {
      const [first, ...others] = Array.from({ length: file[at + 9] }, (_, i) => file[at + 11 + 3 * i]);
      // The fourth component of CMYK and YCCK is sampled like the first.
      const all = (chroma: number) => others.every((sampling, i) => sampling === (i === 2 ? first : chroma));
      return (
        marker !== 0xc3 &&
        file[at + 4] === 8 &&
        (others.length === 0 ||
          ([0x11, 0x21, 0x22, 0x12, 0x41, 0x14].includes(first) && all(0x11)) ||
          (first === 0x22 && (all(0x12) || all(0x21))) ||
          ((first >> 4) * (first & 15) <= 3 && all(first)))
      );
    }
  }
  return false;
}

/**
 * `metadata()`, then the pixels and the ICC profile at each of `eighths`, of which the first is 8. A resize to exactly
 * what the decoder gives at M/8 of the size is left to the decoder alone. What the decoder does not scale is left to
 * the resize kernel, whose pixels are not for this test to pin: "resized" stands for what it makes of the full size.
 */
export async function observeDecode(file: Uint8Array, eighths: number[]): Promise<string> {
  let size: { width: number; height: number } | undefined;
  const results = [
    await outcome(async () => {
      size = await new Bun.Image(file).metadata();
      return `${size.width}x${size.height}`;
    }),
  ];
  // What has no size fails before the scale matters.
  if (!size) eighths = [8];
  const resized = !scalable(file);
  if (resized) eighths = eighths.slice(0, 2);
  let full: Uint8Array | undefined;
  for (const m of eighths) {
    results.push(
      await outcome(async () => {
        const image = new Bun.Image(file, { autoOrient: false });
        if (m === 8) return describe((full = await pngOf(image)));
        const to = [Math.ceil((size!.width * m) / 8), Math.ceil((size!.height * m) / 8), { fit: "fill" }] as const;
        const scaled = describe(await pngOf(image.resize(...to)));
        if (resized && full && scaled === describe(await pngOf(new Bun.Image(full).resize(...to)))) return "resized";
        return scaled;
      }),
    );
  }
  return results.join(" ");
}

/** Copies of `file` with damage that depends on `seed` alone. */
export function damaged(file: Uint8Array, seed: number, count: number): Uint8Array[] {
  const below = random(seed * 2654435761);
  const special = [0x00, 0x01, 0x7f, 0x80, 0xc0, 0xc2, 0xc4, 0xd0, 0xd7, 0xd9, 0xda, 0xdb, 0xdd, 0xff];
  return Array.from({ length: count }, () => {
    let copy = Buffer.from(file);
    // Past SOI, or it is no JPEG to `Bun.Image`.
    const at = () => 3 + below(copy.length - 3);
    for (let n = 1 + below(3); n > 0; n--) {
      switch (below(6)) {
        case 0:
          copy[at()] ^= 1 << below(8);
          break;
        case 1:
          copy[at()] = special[below(special.length)];
          break;
        case 2:
          copy = copy.subarray(0, at());
          break;
        case 3: {
          const from = at();
          copy = Buffer.concat([copy.subarray(0, from), copy.subarray(from + 1 + below(4))]);
          break;
        }
        case 4: {
          const from = at();
          copy = Buffer.concat([
            copy.subarray(0, from),
            Buffer.from([0xff, special[below(special.length)]]),
            copy.subarray(from),
          ]);
          break;
        }
        default:
          copy[at()] = below(256);
      }
      if (copy.length < 8) break;
    }
    return copy;
  });
}

/** How a file of the decoding fixture is looked at: itself at every scale, each damaged copy at full size and one other. */
export async function observeDecodeCase(file: Uint8Array, seed: number): Promise<string[]> {
  const copies = damaged(file, seed, 3);
  return Promise.all([
    observeDecode(file, [8, 7, 6, 5, 4, 3, 2, 1]),
    ...copies.map((copy, i) => observeDecode(copy, [8, 1 + ((seed + i) % 7)])),
  ]);
}

export type EncodeCase = {
  kind: number;
  width: number;
  height: number;
  quality: number;
  progressive: boolean;
  /** Whether alpha, which a JPEG has no place for, is random. Otherwise it is 255. */
  alpha: boolean;
};

/**
 * Gray blocks of one AC coefficient each, in 15 places that come up 4, 5, 8, 13, 21, ... times. That makes the optimal
 * Huffman table of a progressive scan a chain, whose longest code has 17 bits where 16 are allowed.
 */
function blocksForAChainOfCodes(): number[][] {
  const blocks: number[][] = [];
  const cosine = (at: number, frequency: number) => Math.cos(((2 * at + 1) * frequency * Math.PI) / 16);
  let [count, before] = [4, 3];
  // Places 6 to 20 of the zigzag order.
  for (const place of [3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40]) {
    const [u, v] = [place % 8, place >> 3];
    // A coefficient of 6. No sample comes near a half, so the last bit of a cosine does not matter.
    const amplitude = (6 / 4) * (u ? 1 : Math.SQRT1_2) * (v ? 1 : Math.SQRT1_2);
    const block = Array.from({ length: 64 }, (_, i) =>
      Math.round(128 + amplitude * cosine(i % 8, u) * cosine(i >> 3, v)),
    );
    for (let n = 0; n < count; n++) blocks.push(block);
    // More than all but the last count together, so that the tree is a chain however ties are broken.
    [count, before] = [Math.max(before, count) + 1, before + count];
  }
  return blocks;
}

/** Pixels that depend on the case alone. */
export function picture({ kind, width, height, quality, alpha }: EncodeCase): Uint8Array {
  const seed = (kind + 1) * 7919 + width * 31 + height * 131 + quality;
  const below = random(seed);
  const opacity = random(seed + 1);
  const rgba = new Uint8Array(width * height * 4);
  const period = 1 + below(12);
  const [red, green, blue] = [below(256), below(256), below(256)];
  const blocks = kind === 8 ? blocksForAChainOfCodes() : [];
  let p = 0;
  // Nothing is allocated for a pixel, which a debug build takes long to do.
  const put = (r: number, g: number, b: number) => {
    rgba[p++] = r;
    rgba[p++] = g;
    rgba[p++] = b;
    rgba[p++] = alpha ? opacity(256) : 255;
  };
  const putGray = (gray: number) => put(gray, gray, gray);
  // The rows of a flat picture are copies of the first.
  for (let y = 0; y < (kind === 1 ? 1 : height); y++) {
    for (let x = 0; x < width; x++) {
      if (kind === 0) put(below(256), below(256), below(256));
      else if (kind === 1) put(red, green, blue);
      else if (kind === 2)
        put(((x * 255) / width) | 0, ((y * 255) / height) | 0, (((x + y) * 255) / (width + height)) | 0);
      else if (kind === 3) putGray((((x / period) | 0) + ((y / period) | 0)) % 2 ? 255 : 0);
      else if (kind === 4) put(below(2) * 255, below(2) * 255, below(2) * 255);
      else if (kind === 5) put(125 + below(7), 125 + below(7), 125 + below(7));
      else if (kind === 6) put((x * period) & 255, (y * period) & 255, (x * y) & 255);
      else if (kind === 8) putGray(blocks[(y >> 3) * (width >> 3) + (x >> 3)]?.[(y % 8) * 8 + (x % 8)] ?? 128);
      else if (below(period * 20)) put(red, green, blue);
      else putGray(255);
    }
  }
  if (kind === 1) for (let y = 1; y < height; y++) rgba.copyWithin(y * width * 4, 0, width * 4);
  return rgba;
}

export async function observeEncode(c: EncodeCase): Promise<string> {
  const png = pngOfPixels(c.width, c.height, picture(c));
  return outcome(async () => {
    const jpeg = await new Bun.Image(png).jpeg({ quality: c.quality, progressive: c.progressive }).bytes();
    return `${jpeg.length}:${hash(jpeg)}`;
  });
}

export function encodeCases(): EncodeCase[] {
  const sizes = [
    [1, 1],
    [2, 2],
    [7, 9],
    [8, 8],
    [9, 7],
    [15, 17],
    [16, 16],
    [17, 15],
    [24, 8],
    [8, 24],
    [31, 33],
    [33, 31],
    [1, 40],
    [40, 1],
    [64, 48],
  ];
  const qualities = [1, 2, 10, 25, 49, 50, 51, 75, 80, 90, 95, 99, 100];
  const cases: EncodeCase[] = [];
  let n = 0;
  for (let kind = 0; kind < 8; kind++) {
    for (const [width, height] of sizes) {
      // Every quality and both modes come up for every kind and for every size, not for every pair of them.
      for (let i = 0; i < 3; i++, n++) {
        const [quality, progressive] = [qualities[n % qualities.length], n % 2 === 1];
        cases.push({ kind, width, height, quality, progressive, alpha: i === 2 });
      }
    }
  }
  // More than 32,767 blocks with nothing in them, which is as far as a run of them counts.
  cases.push({ kind: 1, width: 1480, height: 1480, quality: 80, progressive: true, alpha: false });
  cases.push({ kind: 2, width: 200, height: 150, quality: 85, progressive: false, alpha: false });
  cases.push({ kind: 5, width: 200, height: 150, quality: 100, progressive: true, alpha: false });
  cases.push({ kind: 8, width: 664, height: 656, quality: 100, progressive: true, alpha: false });
  return cases;
}

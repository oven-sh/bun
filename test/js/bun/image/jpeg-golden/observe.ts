// What `Bun.Image` does with a JPEG file and what it makes of pixels, in a form that can be recorded and compared.
// Shared by record.ts and jpeg-golden.test.ts.
import { deflateSync, gunzipSync, inflateSync } from "node:zlib";

export type DecodeCase = {
  name: string;
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

function hash(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 10);
}

/** The pixels of an 8-bit RGBA PNG, without the help of `Bun.Image`. */
export function pixelsOfPng(png: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const idat: Uint8Array[] = [];
  for (let at = 8; at < png.length; at += 12 + view.getUint32(at)) {
    if (view.getUint32(at + 4) === 0x49444154) idat.push(png.subarray(at + 8, at + 8 + view.getUint32(at)));
  }
  const raw = inflateSync(Buffer.concat(idat));
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
        const [a, b, c] = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - corner)];
        predicted = a <= b && a <= c ? left : b <= c ? up : corner;
      }
      rgba[row + i] = (raw[p++] + predicted) & 255;
    }
  }
  return { width, height, rgba };
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

async function decoded(image: Bun.Image): Promise<string> {
  const { width, height, rgba } = pixelsOfPng(await image.png({ compressionLevel: 1 }).bytes());
  return `${width}x${height}:${hash(rgba)}`;
}

/**
 * `metadata()`, then the pixels at each of `eighths`. A resize to exactly what the decoder gives at M/8 of the size is
 * left to the decoder alone.
 */
export async function observeDecode(file: Uint8Array, eighths: number[]): Promise<string> {
  let size: { width: number; height: number } | undefined;
  const results = [
    await outcome(async () => {
      size = await new Bun.Image(file).metadata();
      return `${size.width}x${size.height}`;
    }),
  ];
  for (const m of eighths) {
    results.push(
      await outcome(() => {
        const image = new Bun.Image(file, { autoOrient: false });
        if (m === 8 || !size) return decoded(image);
        return decoded(image.resize(Math.ceil((size.width * m) / 8), Math.ceil((size.height * m) / 8), { fit: "fill" }));
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
          copy = Buffer.concat([copy.subarray(0, from), Buffer.from([0xff, special[below(special.length)]]), copy.subarray(from)]);
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
export async function observeDecodeCase(file: Uint8Array, index: number): Promise<string[]> {
  const copies = damaged(file, index, 3);
  return Promise.all([
    observeDecode(file, [8, 7, 6, 5, 4, 3, 2, 1]),
    ...copies.map((copy, i) => observeDecode(copy, [8, 1 + ((index + i) % 7)])),
  ]);
}

export type EncodeCase = {
  kind: number;
  width: number;
  height: number;
  quality: number;
  progressive: boolean;
  expected?: string;
};

/** Pixels that depend on the case alone. */
export function picture({ kind, width, height, quality }: EncodeCase): Uint8Array {
  const below = random((kind + 1) * 7919 + width * 31 + height * 131 + quality);
  const rgba = new Uint8Array(width * height * 4);
  const period = 1 + below(12);
  const flat = [below(256), below(256), below(256)];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      let rgb: number[];
      if (kind === 0) rgb = [below(256), below(256), below(256)];
      else if (kind === 1) rgb = flat;
      else if (kind === 2) rgb = [((x * 255) / width) | 0, ((y * 255) / height) | 0, (((x + y) * 255) / (width + height)) | 0];
      else if (kind === 3) rgb = (((x / period) | 0) + ((y / period) | 0)) % 2 ? [255, 255, 255] : [0, 0, 0];
      else if (kind === 4) rgb = [below(2) * 255, below(2) * 255, below(2) * 255];
      else if (kind === 5) rgb = [125 + below(7), 125 + below(7), 125 + below(7)];
      else if (kind === 6) rgb = [(x * period) & 255, (y * period) & 255, (x * y) & 255];
      else rgb = below(period * 20) ? flat : [255, 255, 255];
      rgba.set(rgb, p);
      rgba[p + 3] = 255;
    }
  }
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
    [1, 1], [2, 2], [7, 9], [8, 8], [9, 7], [15, 17], [16, 16], [17, 15], [24, 8], [8, 24], [31, 33], [33, 31], [1, 40], [40, 1], [64, 48],
  ];
  const qualities = [1, 2, 10, 25, 49, 50, 51, 75, 80, 90, 95, 99, 100];
  const cases: EncodeCase[] = [];
  let n = 0;
  for (let kind = 0; kind < 8; kind++) {
    for (const [width, height] of sizes) {
      // Every quality and both modes come up for every kind and for every size, not for every pair of them.
      for (let i = 0; i < 3; i++, n++) {
        cases.push({ kind, width, height, quality: qualities[n % qualities.length], progressive: n % 2 === 1 });
      }
    }
  }
  // More than 32,767 blocks with nothing in them, which is as far as a run of them counts.
  cases.push({ kind: 1, width: 1480, height: 1480, quality: 80, progressive: true });
  cases.push({ kind: 2, width: 400, height: 300, quality: 85, progressive: false });
  cases.push({ kind: 5, width: 400, height: 300, quality: 100, progressive: true });
  return cases;
}

// What the WebP golden tests feed to `Bun.Image` and what they look at. Shared with record.ts.
import { createCipheriv } from "node:crypto";
import zlib from "node:zlib";

export function hash(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 16);
}

export async function load<T>(path: string): Promise<T[]> {
  return JSON.parse(Buffer.from(Bun.gunzipSync(await Bun.file(path).bytes())).toString());
}

export async function save(path: string, cases: unknown[]) {
  await Bun.write(path, Bun.gzipSync(Buffer.from(JSON.stringify(cases)), { level: 9 }));
}

// ── PNG, written and read here so that the tests depend on no PNG encoder's choices ──

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(Buffer.from(type, "latin1"), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodePng(width: number, height: number, rgba: Uint8Array, icc?: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    ...(icc ? [pngChunk("iCCP", Buffer.concat([Buffer.from("icc\0\0", "latin1"), zlib.deflateSync(icc)]))] : []),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 1 })),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

export function decodePng(png: Uint8Array): { width: number; height: number; rgba: Uint8Array; icc?: Uint8Array } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let width = 0;
  let height = 0;
  let icc: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = view.getUint32(offset);
    const type = Buffer.from(png.subarray(offset + 4, offset + 8)).toString("latin1");
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error("expected a plain RGBA8 PNG");
    } else if (type === "iCCP") {
      icc = zlib.inflateSync(data.subarray(data.indexOf(0) + 2));
    } else if (type === "IDAT") {
      idat.push(data);
    }
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = new Uint8Array(stride * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const row = y * stride;
    const up = row - stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? rgba[row + i - 4] : 0;
      const b = y > 0 ? rgba[up + i] : 0;
      const c = y > 0 && i >= 4 ? rgba[up + i - 4] : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      rgba[row + i] = raw[p++] + predicted;
    }
  }
  return { width, height, rgba, icc };
}

// ── Decoding ──

export type Decoded =
  | { width: number; height: number; rgba: string; icc?: string }
  /** The `code` of the error. */
  | { error: string };

export type DecodeCase = {
  /** The file, in base64. */
  data: string;
  metadata: { width: number; height: number; format: string } | { error: string };
  /** Left out if a damaged header announces an image too large to be worth the memory. */
  decoded?: Decoded;
};

export async function observeMetadata(file: Uint8Array): Promise<DecodeCase["metadata"]> {
  try {
    return await new Bun.Image(file).metadata();
  } catch (error: any) {
    return { error: String(error.code) };
  }
}

export async function observeDecode(file: Uint8Array): Promise<Decoded> {
  let png: Uint8Array;
  try {
    png = await new Bun.Image(file).png({ compressionLevel: 1 }).bytes();
  } catch (error: any) {
    return { error: String(error.code) };
  }
  const { width, height, rgba, icc } = decodePng(png);
  return { width, height, rgba: hash(rgba), icc: icc && hash(icc) };
}

// ── Encoding ──

/** An image that `synthesize` makes with integer arithmetic only, so it is the same everywhere. */
export type Spec = {
  seed: number;
  width: number;
  height: number;
  /**
   * 0 flat, 1 gradient, 2 random, 3 smooth, 4 random from a palette, 5 smooth from a palette, 6 like a photo, 7 periodic,
   * 8 black and white, 9 gray, 10 smooth with boxes on top, or "noise" for random bytes in all four channels.
   */
  color: number | "noise";
  /** 0 opaque, 1 transparent, 2 either of them, 3 gradient, 4 random, 5 four levels, 6 opaque but for one pixel. */
  alpha: number;
  /** Puts this many copies of the image side by side and on top of each other. */
  repeat?: [number, number];
};

export type EncodeCase = {
  image: Spec;
  options: { quality?: number; lossless?: boolean };
  /** Bytes of an ICC profile to attach, made from the seed. */
  icc?: number;
  size: number;
  hash: string;
  /** If the image `isLarge`: the hash of what the output is once decoded and encoded again without loss. */
  reencodedHash?: string;
  /** The results are those of libwebp 1.6.0 with 80bda3fd, and differ from those of 1.6.0. */
  fixed?: true;
};

/** The output is too large to be a case of decode.json.gz. */
export function isLarge({ width, height, repeat: [columns, rows] = [1, 1] }: Spec): boolean {
  return width * columns * height * rows > 1 << 15;
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** Smooth noise, 0 to 255: random values on a grid of `cell` pixels, interpolated. */
function field(next: () => number, width: number, height: number, cell: number): Uint8Array {
  const columns = Math.floor(width / cell) + 2;
  const rows = Math.floor(height / cell) + 2;
  const grid = Uint8Array.from({ length: columns * rows }, () => next() & 255);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const gy = Math.floor(y / cell);
    const fy = y % cell;
    for (let x = 0; x < width; x++) {
      const gx = Math.floor(x / cell);
      const fx = x % cell;
      const top = grid[gy * columns + gx] * (cell - fx) + grid[gy * columns + gx + 1] * fx;
      const bottom = grid[(gy + 1) * columns + gx] * (cell - fx) + grid[(gy + 1) * columns + gx + 1] * fx;
      out[y * width + x] = Math.floor((top * (cell - fy) + bottom * fy) / (cell * cell));
    }
  }
  return out;
}

/** Large images are made without a loop over the pixels, which takes seconds in a debug build. */
export function synthesize(spec: Spec): { width: number; height: number; rgba: Uint8Array } {
  const { seed, width, height, color, repeat: [columns, rows] = [1, 1] } = spec;
  if (color === "noise") {
    const key = Buffer.alloc(16);
    key.writeUInt32LE(seed);
    const rgba = createCipheriv("aes-128-ctr", key, Buffer.alloc(16)).update(Buffer.alloc(width * height * 4));
    return { width, height, rgba };
  }
  const tile = synthesizeTile({ ...spec, color });
  const rgba = new Uint8Array(tile.length * columns * rows);
  for (let y = 0; y < height * rows; y++) {
    const row = tile.subarray((y % height) * width * 4, ((y % height) + 1) * width * 4);
    for (let column = 0; column < columns; column++) rgba.set(row, (y * columns + column) * width * 4);
  }
  return { width: width * columns, height: height * rows, rgba };
}

function synthesizeTile({ seed, width, height, color, alpha }: Spec & { color: number }): Uint8Array {
  const next = random(seed);
  const rgba = new Uint8Array(width * height * 4);
  const cell = 2 + (next() % 30);
  const fields = [0, 1, 2, 3].map(() => field(next, width, height, cell));
  const detail = field(next, width, height, 2 + (next() % 3));
  const base = [next() & 255, next() & 255, next() & 255];
  const colors = [2, 3, 4, 5, 16, 17, 40, 200, 256, 300][next() % 10];
  const palette = Array.from({ length: colors }, () => [next() & 255, next() & 255, next() & 255]);
  const period = 2 + (next() % 23);
  const pattern = Array.from({ length: period * period }, () => [next() & 255, next() & 255, next() & 255]);
  const amplitude = 1 + (next() % 40);
  const boxes = Array.from({ length: 4 }, () => [
    next() % width,
    next() % height,
    1 + (next() % 40),
    1 + (next() % 40),
  ]);
  const lone = next() % (width * height);
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let pixel: number[];
      switch (color) {
        case 0:
          pixel = base;
          break;
        case 1:
          pixel = [
            Math.floor((x * 255) / width),
            Math.floor((y * 255) / height),
            Math.floor(((x + y) * 255) / (width + height)),
          ];
          break;
        case 2:
          pixel = [next() & 255, next() & 255, next() & 255];
          break;
        case 3:
          pixel = [fields[0][i], fields[1][i], fields[2][i]];
          break;
        case 4:
          pixel = palette[next() % colors];
          break;
        case 5:
          pixel = palette[Math.floor(((fields[0][i] + fields[1][i]) * colors) / 512)];
          break;
        case 6:
          pixel = [0, 1, 2].map(c =>
            clamp(fields[c][i] + (next() % amplitude) - (amplitude >> 1) + ((detail[i] - 128) >> 2)),
          );
          break;
        case 7:
          pixel = pattern[(y % period) * period + (x % period)];
          break;
        case 8:
          pixel =
            ((Math.floor(x / 3) ^ Math.floor(y / 5)) & 1) === 0 || (x * 7 + y * 13) % 11 === 0
              ? [0, 0, 0]
              : [255, 255, 255];
          break;
        case 9:
          pixel = [fields[0][i], fields[0][i], fields[0][i]];
          break;
        default: {
          pixel = [fields[0][i], fields[1][i], fields[2][i]];
          boxes.forEach(([bx, by, bw, bh], n) => {
            if (x >= bx && x < bx + bw && y >= by && y < by + bh) pixel = palette[n % colors];
          });
        }
      }
      let a = 255;
      if (alpha === 1) a = 0;
      else if (alpha === 2) a = fields[3][i] > 128 ? 255 : 0;
      else if (alpha === 3) a = Math.floor((x * 255) / width);
      else if (alpha === 4) a = next() & 255;
      else if (alpha === 5) a = [0, 64, 128, 255][fields[3][i] >> 6];
      else if (alpha === 6) a = i === lone ? 254 : 255;
      rgba[i * 4] = pixel[0];
      rgba[i * 4 + 1] = pixel[1];
      rgba[i * 4 + 2] = pixel[2];
      rgba[i * 4 + 3] = a;
    }
  }
  return rgba;
}

export function profile(seed: number, size: number): Uint8Array {
  const next = random(seed ^ 0x1cc);
  return Uint8Array.from({ length: size }, () => next() & 255);
}

export async function observeEncode({
  image,
  options,
  icc,
}: Pick<EncodeCase, "image" | "options" | "icc">): Promise<Pick<EncodeCase, "size" | "hash" | "reencodedHash">> {
  const { width, height, rgba } = synthesize(image);
  const png = encodePng(width, height, rgba, icc ? profile(image.seed, icc) : undefined);
  const out = await new Bun.Image(png).webp(options).bytes();
  const reencoded = isLarge(image) ? await new Bun.Image(out).webp({ lossless: true }).bytes() : undefined;
  return { size: out.length, hash: hash(out), reencodedHash: reencoded && hash(reencoded) };
}

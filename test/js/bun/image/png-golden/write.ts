// Writes any valid PNG file around samples that are chosen first, and says what RGBA those samples stand for.
// So what a test expects comes from the specification and not from a decoder.
//
// Thousands of files are made with this in a test, and a debug build runs JavaScript some fifty times slower. Hence
// the plain loops over typed arrays.

export const GRAY = 0;
export const RGB = 2;
export const INDEXED = 3;
export const GRAY_ALPHA = 4;
export const RGBA = 6;

/** Every color type with every bit depth it may have. */
export const formats = [
  [GRAY, 1],
  [GRAY, 2],
  [GRAY, 4],
  [GRAY, 8],
  [GRAY, 16],
  [RGB, 8],
  [RGB, 16],
  [INDEXED, 1],
  [INDEXED, 2],
  [INDEXED, 4],
  [INDEXED, 8],
  [GRAY_ALPHA, 8],
  [GRAY_ALPHA, 16],
  [RGBA, 8],
  [RGBA, 16],
] as const;

export const channelsOf = (colorType: number) => [1, 0, 3, 1, 2, 0, 4][colorType];

/** Of each pass of Adam7: the first column and row, then the steps between columns and rows. */
const adam7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];
const notInterlaced = [[0, 0, 1, 1]];

export const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Writes a chunk into `file` at `at` and returns where it ends. */
function putChunk(file: Uint8Array, at: number, type: string, data: ArrayLike<number>) {
  const length = data.length;
  file[at] = length >>> 24;
  file[at + 1] = length >>> 16;
  file[at + 2] = length >>> 8;
  file[at + 3] = length;
  for (let i = 0; i < 4; i++) file[at + 4 + i] = type.charCodeAt(i);
  file.set(data, at + 8);
  const crc = Bun.hash.crc32(file.subarray(at + 4, at + 8 + length));
  file[at + 8 + length] = crc >>> 24;
  file[at + 9 + length] = crc >>> 16;
  file[at + 10 + length] = crc >>> 8;
  file[at + 11 + length] = crc;
  return at + 12 + length;
}

export function chunk(type: string, data: Uint8Array | number[] | string = []) {
  const body = typeof data === "string" ? Buffer.from(data, "latin1") : data;
  const out = Buffer.allocUnsafe(12 + body.length);
  putChunk(out, 0, type, body);
  return out;
}

const headerOf = (width: number, height: number, depth: number, colorType: number, interlace: number) => [
  width >>> 24,
  (width >>> 16) & 255,
  (width >>> 8) & 255,
  width & 255,
  height >>> 24,
  (height >>> 16) & 255,
  (height >>> 8) & 255,
  height & 255,
  depth,
  colorType,
  0,
  0,
  interlace,
];

export const ihdr = (width: number, height: number, depth: number, colorType: number, interlace = 0) =>
  chunk("IHDR", headerOf(width, height, depth, colorType, interlace));

export const iend = chunk("IEND");
export const png = (...chunks: Buffer[]) => Buffer.concat([signature, ...chunks]);

/** Bytes that are the same in every run. */
export const randomBytes = (seed: number) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 24;

export type Picture = {
  width: number;
  height: number;
  colorType: number;
  depth: number;
  /** Row by row, pixel by pixel, channel by channel. */
  samples: Uint16Array;
  /** The red, green and blue of each entry of PLTE. */
  palette?: Uint8Array;
  /** tRNS: the alpha of the first palette entries, or else the samples of the one transparent color. */
  transparency?: number[];
};

export type Layout = {
  interlaced?: boolean;
  /** The filter type of a row of a pass. None if left out. */
  filter?: (row: number, pass: number) => number;
  /** For the bits of a row's last byte that no pixel uses. */
  padding?: () => number;
  /** Chunks for the three places where there may be some. */
  beforePalette?: Uint8Array[];
  beforeData?: Uint8Array[];
  afterData?: Uint8Array[];
  /** From what `filteredLines` gives to a zlib stream. */
  deflate?: (lines: Uint8Array) => Uint8Array;
  /** The data of each IDAT. */
  split?: (stream: Uint8Array) => Uint8Array[];
};

/**
 * The 8-bit RGBA that the samples stand for, each row behind a zero: what Bun.Image writes at level 0.
 * https://www.w3.org/TR/png-3/#13Decoders: sample depth scaling, tRNS, and black for an index PLTE does not have.
 */
export function rgbaLinesOf({ width, height, colorType, depth, samples, palette, transparency }: Picture) {
  const out = Buffer.alloc(height * (1 + width * 4));
  const channels = channelsOf(colorType);
  const shift = depth === 16 ? 8 : 0;
  const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1;
  const colors = channels <= 2 ? 1 : 3;
  const hasAlpha = channels === 2 || channels === 4;
  const [t0, t1, t2] = transparency ?? [-1, -1, -1];
  let [at, to] = [0, 0];
  for (let y = 0; y < height; y++) {
    to++;
    for (let x = 0; x < width; x++, at += channels, to += 4) {
      if (colorType === INDEXED) {
        const index = samples[at];
        if (index * 3 < palette!.length) {
          out[to] = palette![index * 3];
          out[to + 1] = palette![index * 3 + 1];
          out[to + 2] = palette![index * 3 + 2];
        }
        out[to + 3] = transparency && index < transparency.length ? transparency[index] : 255;
        continue;
      }
      const r = samples[at];
      const g = colors === 1 ? r : samples[at + 1];
      const b = colors === 1 ? r : samples[at + 2];
      out[to] = (r >> shift) * scale;
      out[to + 1] = (g >> shift) * scale;
      out[to + 2] = (b >> shift) * scale;
      if (hasAlpha) out[to + 3] = samples[at + colors] >> shift;
      else out[to + 3] = r === t0 && (colors === 1 || (g === t1 && b === t2)) ? 0 : 255;
    }
  }
  return out;
}

/** The same without the zeros. */
export function rgbaOf(picture: Picture) {
  const lines = rgbaLinesOf(picture);
  const stride = picture.width * 4;
  const out = Buffer.alloc(picture.height * stride);
  for (let y = 0; y < picture.height; y++)
    out.set(lines.subarray(y * (1 + stride) + 1, (y + 1) * (1 + stride)), y * stride);
  return out;
}

/** https://www.w3.org/TR/png-3/#9Filter-type-4-Paeth */
export function paeth(a: number, b: number, c: number) {
  const pa = Math.abs(b - c);
  const pb = Math.abs(a - c);
  const pc = Math.abs(a + b - 2 * c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** What IDAT holds before it is compressed: of each pass, each row behind its filter type. */
export function filteredLines(picture: Picture, { interlaced, filter, padding }: Layout = {}) {
  const { width, height, colorType, depth, samples } = picture;
  const channels = channelsOf(colorType);
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const passes = interlaced ? adam7 : notInterlaced;
  let size = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const [columns, rows] = [Math.ceil((width - x0) / dx), Math.ceil((height - y0) / dy)];
    if (columns > 0 && rows > 0) size += rows * (1 + Math.ceil((columns * bitsPerPixel) / 8));
  }
  const out = new Uint8Array(size);
  let to = 0;
  for (let pass = 0; pass < passes.length; pass++) {
    const [x0, y0, dx, dy] = passes[pass];
    const [columns, rows] = [Math.ceil((width - x0) / dx), Math.ceil((height - y0) / dy)];
    if (columns <= 0 || rows <= 0) continue;
    const length = Math.ceil((columns * bitsPerPixel) / 8);
    const unused = 0xff >> ((columns * bitsPerPixel) % 8 || 8);
    let above = new Uint8Array(length);
    let row = new Uint8Array(length);
    for (let y = 0; y < rows; y++) {
      if (depth < 8) row.fill(0);
      for (let x = 0, i = 0; x < columns; x++) {
        let at = ((y0 + y * dy) * width + x0 + x * dx) * channels;
        for (let c = 0; c < channels; c++, at++, i++) {
          if (depth === 8) row[i] = samples[at];
          else if (depth === 16) {
            row[i * 2] = samples[at] >> 8;
            row[i * 2 + 1] = samples[at];
          } else row[(i * depth) >> 3] |= samples[at] << (8 - depth - ((i * depth) & 7));
        }
      }
      if (padding) row[length - 1] |= padding() & unused;
      const type = filter ? filter(y, pass) : 0;
      out[to++] = type;
      if (type === 0) out.set(row, to);
      else if (type === 2) for (let i = 0; i < length; i++) out[to + i] = row[i] - above[i];
      else {
        for (let i = 0; i < length; i++) {
          const a = i < bpp ? 0 : row[i - bpp];
          const b = above[i];
          if (type === 1) out[to + i] = row[i] - a;
          else if (type === 3) out[to + i] = row[i] - ((a + b) >> 1);
          else {
            out[to + i] = row[i] - paeth(a, b, i < bpp ? 0 : above[i - bpp]);
          }
        }
      }
      to += length;
      [above, row] = [row, above];
    }
  }
  return out;
}

/** A zlib stream of these pieces of deflate, which inflate to `data`. `window` is the CINFO field: 256 << window bytes. */
export function zlibStream(data: Uint8Array, pieces: Uint8Array[], window = 7) {
  let size = 6;
  for (const piece of pieces) size += piece.length;
  const out = Buffer.allocUnsafe(size);
  out[0] = (window << 4) | 8;
  out[1] = 31 - ((out[0] << 8) % 31);
  let at = 2;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.length;
  }
  const sum = Bun.hash.adler32(data);
  out[at] = sum >>> 24;
  out[at + 1] = sum >>> 16;
  out[at + 2] = sum >>> 8;
  out[at + 3] = sum;
  return out;
}

const deflate = (lines: Uint8Array) => zlibStream(lines, [Bun.deflateSync(lines)]);

export const iccp = (name: string, profile: Uint8Array | string, compress = deflate) =>
  chunk("iCCP", Buffer.concat([Buffer.from(`${name}\0\0`, "latin1"), compress(Buffer.from(profile))]));

/** The file, if `lines` is what `filteredLines` gives for it. For many files that differ in something else. */
export function writeAround(lines: Uint8Array, picture: Omit<Picture, "samples">, layout: Layout = {}) {
  const { width, height, colorType, depth, palette, transparency } = picture;
  const stream = (layout.deflate ?? deflate)(lines);
  const parts = layout.split ? layout.split(stream) : [stream];
  let trns: number[] | undefined = transparency;
  if (transparency && colorType !== INDEXED) {
    trns = [];
    for (const sample of transparency) trns.push(sample >> 8, sample & 255);
  }
  const { beforePalette = [], beforeData = [], afterData = [] } = layout;
  let size = 8 + 25 + 12 + (palette ? 12 + palette.length : 0) + (trns ? 12 + trns.length : 0);
  for (const list of [beforePalette, beforeData, afterData]) for (const other of list) size += other.length;
  for (const part of parts) size += 12 + part.length;

  const file = Buffer.allocUnsafe(size);
  file.set(signature);
  let at = putChunk(file, 8, "IHDR", headerOf(width, height, depth, colorType, layout.interlaced ? 1 : 0));
  const putAll = (list: Uint8Array[]) => {
    for (const other of list) {
      file.set(other, at);
      at += other.length;
    }
  };
  putAll(beforePalette);
  if (palette) at = putChunk(file, at, "PLTE", palette);
  if (trns) at = putChunk(file, at, "tRNS", trns);
  putAll(beforeData);
  for (const part of parts) at = putChunk(file, at, "IDAT", part);
  putAll(afterData);
  putChunk(file, at, "IEND", []);
  return file;
}

export const write = (picture: Picture, layout: Layout = {}) =>
  writeAround(filteredLines(picture, layout), picture, layout);

/** A picture of noise. Of a few values only if `few`, so that pixels repeat and tRNS has something to match. */
export function noise(
  [colorType, depth]: readonly [number, number],
  width: number,
  height: number,
  random: () => number,
  { few = false, paletteLength = 1 << Math.min(depth, 8), transparent = false } = {},
): Picture {
  const channels = channelsOf(colorType);
  const samples = new Uint16Array(width * height * channels);
  const max = (1 << depth) - 1;
  const one = () =>
    colorType === INDEXED ? random() % paletteLength : depth > 8 ? (random() << 8) | random() : random() & max;
  const values = [one(), one(), one()];
  for (let i = 0; i < samples.length; i++) samples[i] = few ? values[random() % 3] : one();
  const picture: Picture = { width, height, colorType, depth, samples };
  if (colorType === INDEXED) picture.palette = Uint8Array.from({ length: paletteLength * 3 }, random);
  if (transparent && colorType === INDEXED) {
    picture.transparency = Array.from({ length: 1 + (random() % paletteLength) }, random);
  } else if (transparent && (colorType === GRAY || colorType === RGB)) {
    // The color of a pixel that is there.
    const at = (random() % (width * height)) * channels;
    picture.transparency = [...samples.subarray(at, at + channels)];
  }
  return picture;
}

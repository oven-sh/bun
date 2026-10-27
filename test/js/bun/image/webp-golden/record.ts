// Fills in the expected results of decode.json.gz and encode.json.gz, and makes the .webp files, from the Bun that runs
// this script:
//
//   bun record.ts [--fresh] [--decode <directory of .webp files>]... [--encode <cases.jsonl>]...
//
// It records the cases that are already there again, unless --fresh drops them, and adds the new ones behind them. A line
// of cases.jsonl has the `image`, the `options` and maybe the `icc` of an `EncodeCase`. The results in the repository come
// from the last Bun that used libwebp (1.4.4, libwebp 1.6.0, Linux x64), and this script refuses to run on any other:
// what a later Bun records is what it does, not what it should do.
//
// The exception is the lossy encodes that are `fixed`. libwebp 1.6.0 counted the uses of one probability as those of another,
// which 80bda3fd, a later commit, corrects, and `bun_webp` has the correction. Their results come from `WebPEncodeRGBA`, and
// `WebPMuxAssemble` for a profile, of libwebp 1.6.0 with that commit. This script keeps them as they are, and a lossy
// encode that it adds may need the same.
//
// No case is a damaged lossy file whose coefficients overflow 16 bits: libwebp's SSE2 code and its C code decode
// those to different pixels. `bun_webp` does what the C code does, and webp-golden.test.ts has cases of its own for that.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  encodePng,
  load,
  observeDecode,
  observeEncode,
  observeMetadata,
  save,
  type DecodeCase,
  type EncodeCase,
} from "./observe";

if (
  Bun.revision !== "38afee6c84fcf48c0edb2466aa4b27d287a59c30" ||
  process.platform !== "linux" ||
  process.arch !== "x64"
) {
  throw new Error(
    `run this with the release build of Bun 1.4.4 for Linux x64, not ${Bun.version}+${Bun.revision} for ${process.platform} ${process.arch}`,
  );
}

const { values: args } = parseArgs({
  options: {
    fresh: { type: "boolean", default: false },
    decode: { type: "string", multiple: true, default: [] },
    encode: { type: "string", multiple: true, default: [] },
  },
});
const decodeFixture = join(import.meta.dir, "decode.json.gz");
const encodeFixture = join(import.meta.dir, "encode.json.gz");

// Sets, so that a case that is there already is not added again.
const files = new Set(args.fresh ? [] : (await load<DecodeCase>(decodeFixture)).map(c => c.data));
for (const directory of args.decode) {
  for (const name of readdirSync(directory).sort()) {
    files.add(Buffer.from(await Bun.file(join(directory, name)).bytes()).toString("base64"));
  }
}
const encodes = new Set<string>();
const fixed = new Map<string, EncodeCase>();
const keyOf = ({ image, options, icc }: EncodeCase) => JSON.stringify({ image, options, icc });
for (const c of await load<EncodeCase>(encodeFixture)) {
  if (!args.fresh) encodes.add(keyOf(c));
  if (c.fixed) fixed.set(keyOf(c), c);
}
for (const path of args.encode) {
  for (const line of (await Bun.file(path).text()).trim().split("\n")) encodes.add(keyOf(JSON.parse(line)));
}

const decoded: DecodeCase[] = [];
for (const data of files) {
  const file = Buffer.from(data, "base64");
  const metadata = await observeMetadata(file);
  const tooLarge = "width" in metadata && metadata.width * metadata.height > 1 << 16;
  decoded.push({ data, metadata, decoded: tooLarge ? undefined : await observeDecode(file) });
}
await save(decodeFixture, decoded);

const encoded: EncodeCase[] = [];
for (const json of encodes) {
  const input: Pick<EncodeCase, "image" | "options" | "icc"> = JSON.parse(json);
  encoded.push(fixed.get(json) ?? { ...input, ...(await observeEncode(input)) });
}
await save(encodeFixture, encoded);

/**
 * An image that takes the lossless encoder more than its 500 cost intervals (`insert_interval` in
 * backward_references_cost.rs), and whose file is another one if the costs that find no interval are dropped.
 *
 * `copies` consecutive pixels of `target` each have their longest match, of `length` pixels, in a copy of their own that
 * ends one pixel after the copy before. Each match adds an interval of one pixel. Between the copies and `target` is
 * something like text, which makes the encoder prefer the references that it found with the intervals.
 */
function intervalImage() {
  const [copies, length, spacer, period, width] = [769, 900, 300000, 30000, 4096];
  let state = 4n;
  const next = () => {
    state = BigInt.asUintN(64, state + 0x9e3779b97f4a7c15n);
    let z = state;
    z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
    z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94d049bb133111ebn);
    return z ^ (z >> 31n);
  };
  const below = (n: number) => Number(next() % BigInt(n));
  const palette = Array.from({ length: 256 }, () => {
    const color = below(1 << 24);
    return [color & 255, (color >> 8) & 255, color >> 16, 255];
  });
  // The text has colours of its own, or it would fill the hash chains of the colours of `target`.
  const symbol = () => 64 + below(192);
  const symbolOtherThan = (not: number) => {
    for (;;) {
      const value = symbol();
      if (value !== not) return value;
    }
  };
  const target = Array.from({ length: copies + length + 8 }, symbol);
  const pixels: number[] = [];
  for (let i = 0; i < copies; i++) {
    pixels.push(i === 0 ? symbol() : symbolOtherThan(target[i - 1]));
    pixels.push(...target.slice(i, i + length));
    pixels.push(symbolOtherThan(target[i + length]));
  }
  const phrases = Array.from({ length: 300 }, () => Array.from({ length: 2 + below(13) }, () => below(64)));
  const start = pixels.length;
  while (pixels.length < start + spacer) {
    pixels.push(...phrases[Math.floor((below(300) * below(300)) / 300)]);
    if (below(4) === 0) pixels.push(below(64));
  }
  pixels.length = start + spacer;
  for (let i = start + period; i < pixels.length; i++) pixels[i] = pixels[i - period];
  pixels.push(...target);
  while (pixels.length % width !== 0) pixels.push(symbol());
  return encodePng(width, pixels.length / width, Uint8Array.from(pixels.flatMap(pixel => palette[pixel])));
}
await Bun.write(
  join(import.meta.dir, "intervals.webp"),
  await new Bun.Image(intervalImage()).webp({ lossless: true }).bytes(),
);

/**
 * An image that is large enough for the lossless decoder to keep only its last rows. Each of the last 30 rows starts with a
 * copy of pixels that are as far back as a backward reference reaches. The pixel in front of it keeps the encoder from
 * starting the reference earlier. At this width, the encoders look that far back.
 *
 * The pixels differ in `channels`. With a `period`, the rest of the alpha plane repeats as many random levels, for which
 * the encoder takes a palette and nothing else, and the decoder keeps bytes rather than pixels.
 */
function farCopies(channels: number[], period?: number) {
  const [width, height, length, farthest] = [16383, 170, 40, (1 << 20) - 120];
  const rgba = new Uint8Array(width * height * 4).fill(255);
  let state = 1;
  const next = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) >>> 24;
  if (period !== undefined) {
    const levels = Array.from({ length: period }, next);
    for (let i = 0; i < width * height; i++) rgba[i * 4 + 3] = levels[i % period];
  }
  for (let y = height - 30; y < height; y++) {
    rgba[(y * width - 1) * 4 + 3] = 254;
    for (let x = 0; x < length; x++) {
      for (const channel of channels) {
        const value = next();
        for (const at of [y * width + x - farthest, y * width + x]) rgba[at * 4 + channel] = value;
      }
    }
  }
  return encodePng(width, height, rgba);
}
for (const [name, image, options] of [
  ["window.webp", farCopies([0, 1, 2]), { lossless: true }],
  ["window-alpha.webp", farCopies([3]), { quality: 20 }],
  ["window-alpha-palette.webp", farCopies([3], 300), { quality: 20 }],
] as const) {
  const file = await new Bun.Image(image).webp(options).bytes();
  await Bun.write(join(import.meta.dir, name), file);
  console.log(name, await observeDecode(file));
}
console.log(`recorded ${decoded.length} decodes and ${encoded.length} encodes with Bun ${Bun.version}`);

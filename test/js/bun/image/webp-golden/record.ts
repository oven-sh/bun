// Fills in the expected results of decode.json.gz and encode.json.gz, and makes intervals.webp, from the Bun that runs
// this script:
//
//   bun record.ts [--decode <directory of .webp files>]... [--encode <cases.jsonl>]...
//
// Without arguments it records the cases that are already there again. The results in the repository come from the
// last Bun that used libwebp (1.4.4, libwebp 1.6.0, Linux x64), and this script refuses to run on any other: what a
// later Bun records is what it does, not what it should do.
//
// No case is a damaged lossy file whose coefficients overflow 16 bits: libwebp's SSE2 code and its C code decode
// those to different pixels. `bun_webp` does what the C code does.
import { readdirSync } from "node:fs";
import { join } from "node:path";
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

if (Bun.revision !== "38afee6c84fcf48c0edb2466aa4b27d287a59c30") {
  throw new Error(`run this with the release build of Bun 1.4.4, not ${Bun.version}+${Bun.revision}`);
}

const decodeFixture = join(import.meta.dir, "decode.json.gz");
const encodeFixture = join(import.meta.dir, "encode.json.gz");

let files: Uint8Array[] = [];
let encodes: Omit<EncodeCase, "size" | "hash">[] = [];
for (let i = 2; i < process.argv.length; i += 2) {
  const value = process.argv[i + 1];
  if (process.argv[i] === "--decode") {
    for (const name of readdirSync(value).sort()) files.push(await Bun.file(join(value, name)).bytes());
  } else if (process.argv[i] === "--encode") {
    encodes.push(
      ...(await Bun.file(value).text())
        .trim()
        .split("\n")
        .map(line => JSON.parse(line)),
    );
  } else {
    throw new Error(`unknown argument ${process.argv[i]}`);
  }
}
if (files.length === 0) files = (await load<DecodeCase>(decodeFixture)).map(c => Buffer.from(c.data, "base64"));
if (encodes.length === 0) encodes = await load<EncodeCase>(encodeFixture);

const decoded: DecodeCase[] = [];
for (const file of files) {
  const metadata = await observeMetadata(file);
  const tooLarge = "width" in metadata && metadata.width * metadata.height > 1 << 16;
  decoded.push({
    data: Buffer.from(file).toString("base64"),
    metadata,
    ...(tooLarge ? {} : { decoded: await observeDecode(file) }),
  });
}
await save(decodeFixture, decoded);

const encoded: EncodeCase[] = [];
for (const { image, options, icc, again } of encodes) {
  encoded.push({ image, options, ...(icc ? { icc } : {}), ...(await observeEncode({ image, options, icc, again })) });
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
console.log(`recorded ${decoded.length} decodes and ${encoded.length} encodes with Bun ${Bun.version}`);

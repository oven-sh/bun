// Fills in the expected results of decode.json.gz and encode.json.gz from the Bun that runs this script:
//
//   bun record.ts [--decode <directory of .webp files>]... [--encode <cases.jsonl>]...
//
// Without arguments it records the cases that are already there again. The results in the repository come from the
// last Bun that used libwebp (1.4.4, libwebp 1.6.0, Linux x64).
//
// No case is a damaged lossy file whose coefficients overflow 16 bits: libwebp's SSE2 code and its C code decode
// those to different pixels. `bun_webp` does what the C code does.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  load,
  observeDecode,
  observeEncode,
  observeMetadata,
  save,
  type DecodeCase,
  type EncodeCase,
} from "./observe";

const decodeFixture = join(import.meta.dir, "decode.json.gz");
const encodeFixture = join(import.meta.dir, "encode.json.gz");

let files: Uint8Array[] = [];
let encodes: Pick<EncodeCase, "image" | "options" | "icc">[] = [];
for (let i = 2; i < process.argv.length; i += 2) {
  const value = process.argv[i + 1];
  if (process.argv[i] === "--decode") {
    for (const name of readdirSync(value).sort()) files.push(await Bun.file(join(value, name)).bytes());
  } else if (process.argv[i] === "--encode") {
    encodes.push(...(await Bun.file(value).text()).trim().split("\n").map(line => JSON.parse(line)));
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
for (const { image, options, icc } of encodes) {
  encoded.push({ image, options, ...(icc ? { icc } : {}), ...(await observeEncode({ image, options, icc })) });
}
await save(encodeFixture, encoded);
console.log(`recorded ${decoded.length} decodes and ${encoded.length} encodes with Bun ${Bun.version}`);

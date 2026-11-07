// Writes encoder.json.gz and decoder.json.gz with the results of the Bun that runs this script:
//
//   bun record.ts [--accept]
//
// The results in the repository come from the build named below (Linux x64), whose brotli is google/brotli 1.2.1.
import { join } from "node:path";
import { generateDecoderCases, generateEncoderCases, observeDecoder, observeEncoder } from "./cases";

const reference = "38afee6c8";

if (!Bun.revision.startsWith(reference) && !process.argv.includes("--accept")) {
  throw new Error(
    `This is Bun ${Bun.version}+${Bun.revision.slice(0, 9)}, so this would record the code under test. ` +
      `Run it with Bun 1.4.4+${reference}, or pass --accept after a change that is meant.`,
  );
}

const save = (name: string, cases: unknown[]) =>
  Bun.write(join(import.meta.dir, name), Bun.gzipSync(Buffer.from(JSON.stringify(cases)), { level: 9 }));

const encoder = generateEncoderCases();
for (const k of encoder) k.result = await observeEncoder(k);
await save("encoder.json.gz", encoder);

const decoder = await generateDecoderCases();
for (const k of decoder) k.result = await observeDecoder(k);
await save("decoder.json.gz", decoder);

console.log(`recorded ${encoder.length} + ${decoder.length} cases with Bun ${Bun.version}+${Bun.revision.slice(0, 9)}`);

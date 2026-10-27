// Writes encoder.json.gz and decoder.json.gz with the results of the Bun that runs this script:
//
//   bun record.ts [--accept]
//
// The results in the repository come from the last Bun that used the C library (1.4.4, Linux x64).
import { join } from "node:path";
import { generateDecoderCases, generateEncoderCases, observeDecoder, observeEncoder } from "./cases";

if (Bun.semver.order(Bun.version, "1.4.4") > 0 && !process.argv.includes("--accept")) {
  throw new Error(
    `Bun ${Bun.version} does not use the C library, so this would record the code under test. ` +
      "Run it with Bun 1.4.4, or pass --accept after a change that is meant.",
  );
}

const save = (name: string, cases: unknown[]) =>
  Bun.write(join(import.meta.dir, name), Bun.gzipSync(Buffer.from(JSON.stringify(cases)), { level: 9 }));

const encoder = generateEncoderCases(600, 1);
for (const k of encoder) k.result = await observeEncoder(k);
await save("encoder.json.gz", encoder);

const decoder = await generateDecoderCases(900, 2);
for (const k of decoder) k.result = observeDecoder(k);
await save("decoder.json.gz", decoder);

console.log(`recorded ${encoder.length} + ${decoder.length} cases with Bun ${Bun.version}`);

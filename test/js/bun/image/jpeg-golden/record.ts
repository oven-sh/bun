// Fills in the expected results from the Bun that runs this script, which has to be the last one that used
// libjpeg-turbo, on x86-64:
//
//   bunx bun@1.4.3 record.ts
import { join } from "node:path";
import { encodeCases, load, observeDecodeCase, observeEncode, store, type DecodeCase } from "./observe";

if (Bun.version !== "1.4.3" || process.arch !== "x64") {
  throw new Error(
    `Bun ${Bun.version} on ${process.arch} would record its own results. Run this with Bun 1.4.3 on x64.`,
  );
}

Bun.Image.backend = "bun";

const decodeFixture = join(import.meta.dir, "cases.json.gz");
const cases = await load<DecodeCase[]>(decodeFixture);
for (const [index, c] of cases.entries()) c.expected = await observeDecodeCase(Buffer.from(c.data, "base64"), index);
await store(decodeFixture, cases);

const encoded: string[] = [];
for (const c of encodeCases()) encoded.push(await observeEncode(c));
await store(join(import.meta.dir, "encoded.json.gz"), encoded);

console.log(`recorded ${cases.length} files and ${encoded.length} pictures with Bun ${Bun.version}`);

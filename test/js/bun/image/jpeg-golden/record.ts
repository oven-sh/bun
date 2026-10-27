// Fills in the expected results from the Bun that runs this script:
//
//   bun record.ts
//
// The results in the repository come from the last Bun that used libjpeg-turbo (1.4.4, x86-64).
import { join } from "node:path";
import { encodeCases, load, observeDecodeCase, observeEncode, store, type DecodeCase } from "./observe";

Bun.Image.backend = "bun";

const decodeFixture = join(import.meta.dir, "cases.json.gz");
const cases = await load<DecodeCase[]>(decodeFixture);
for (const [index, c] of cases.entries()) c.expected = await observeDecodeCase(Buffer.from(c.data, "base64"), index);
await store(decodeFixture, cases);

const encoded: string[] = [];
for (const c of encodeCases()) encoded.push(await observeEncode(c));
await store(join(import.meta.dir, "encoded.json.gz"), encoded);

console.log(`recorded ${cases.length} files and ${encoded.length} pictures with Bun ${Bun.version}`);

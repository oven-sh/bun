// Takes files out of cases.json.gz, puts files in, and fills in all expected results from the Bun that runs it:
//
//   bunx bun@1.4.4 record.ts [--accept] [--remove <name>]... [<file>]...
//
// A file gets the path that is given as its name, so run this from where that path is the name wanted.
// The results in the repository come from Bun 1.4.4 on x86-64, which used libjpeg-turbo 3.2.0, as 1.4.3 did, but for
// those that README.md lists.
import { join } from "node:path";
import { encodeCases, load, observeDecodeCase, observeEncode, store, type DecodeCase } from "./observe";

/** Bun 1.4.3 and 1.4.4. By their commits, because later builds call themselves 1.4.4 too. */
const withLibjpegTurbo = ["c6da4a4d3010e5553438c60f6bd76d981976867c", "38afee6c84fcf48c0edb2466aa4b27d287a59c30"];

const args = process.argv.slice(2);
if (!(withLibjpegTurbo.includes(Bun.revision) && process.arch === "x64") && !args.includes("--accept")) {
  throw new Error(
    `Bun ${Bun.version} (${Bun.revision.slice(0, 9)}) on ${process.arch} would record the code under test. ` +
      "Run this with the release of Bun 1.4.4 for x64, or pass --accept after a change that is meant.",
  );
}

Bun.Image.backend = "bun";

const decodeFixture = join(import.meta.dir, "cases.json.gz");
const cases = await load<DecodeCase[]>(decodeFixture);
while (args.length > 0) {
  const arg = args.shift()!;
  if (arg === "--accept") continue;
  const name = arg === "--remove" ? args.shift()! : arg;
  const at = cases.findIndex(c => c.name === name);
  if (arg === "--remove") {
    if (at < 0) throw new Error(`There is no file named ${name}.`);
    cases.splice(at, 1);
    continue;
  }
  const data = (await Bun.file(name).bytes()).toBase64();
  if (at < 0) cases.push({ name, seed: 1 + Math.max(...cases.map(c => c.seed)), data });
  else cases[at] = { name, seed: cases[at].seed, data };
}

let changed = 0;
/** Says so if `after` is not what was recorded `before`. */
function compare(name: string, before: string[] | undefined, after: string[]) {
  if (!before || before.join("\n") === after.join("\n")) return;
  changed++;
  console.log([name, ...before.map(line => `- ${line}`), ...after.map(line => `+ ${line}`)].join("\n"));
}

for (const c of cases) {
  const expected = await observeDecodeCase(Buffer.from(c.data, "base64"), c.seed);
  compare(c.name, c.expected, expected);
  c.expected = expected;
}
await store(decodeFixture, cases);

const encodeFixture = join(import.meta.dir, "encoded.json.gz");
const encodedBefore = await load<string[]>(encodeFixture);
const encoded: string[] = [];
for (const c of encodeCases()) {
  const expected = await observeEncode(c);
  if (encoded.length < encodedBefore.length) compare(JSON.stringify(c), [encodedBefore[encoded.length]], [expected]);
  encoded.push(expected);
}
await store(encodeFixture, encoded);

console.log(
  `recorded ${cases.length} files and ${encoded.length} pictures with Bun ${Bun.version}, ${changed} changed`,
);

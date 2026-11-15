// Under BUN_JSC_useZombieMode=1 a sweep overwrites dead cells, and leaves the pages alone that it gave back: BUN_JSC_poisonDecommittedMarkedBlockPages=1 fills those with 0xbd. The program reads its own words behind a full collection.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const program = `import { fullGC, jscDescribe } from "bun:jsc";
import { openSync, readSync } from "node:fs";
const fd = openSync("/proc/self/mem", "r");
const givenBack = 0xbdbdbdbdbdbdbdbdn;
const kinds = [["fractions", 12], ["objects", 12], ["fractions", 300], ["fractions", 40000], ["fields", 0]];
function make(kind, length) {
  let made;
  if (kind === "fields") made = { a: 1.5, b: "x", c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10 };
  else {
    made = [];
    for (let i = 0; i < length; i++) made.push(kind === "fractions" ? i + 0.5 : { i });
  }
  const text = jscDescribe(made);
  const address = kind === "fields" ? /0x[0-9a-f]+/.exec(text)[0] : /butterfly (0x[0-9a-f]+)/.exec(text)[1];
  return { address: BigInt(address), reference: new WeakRef(made), words: new BigUint64Array(4) };
}
function writeOverTheStack(depth) {
  const list = [0, 0, 0, 0, 0, 0, 0, 0];
  return depth ? writeOverTheStack(depth - 1) + list.length : 0;
}
const made = kinds.map(([kind, length]) => Array.from({ length: 8 }, () => make(kind, length)));
// One in 50 stays, and the last: every block stays, with pages that hold nothing alive.
kinds.push(["fractions", 12, "many"]);
made.push(Array.from({ length: 4000 }, () => make("fractions", 12)));
const kept = made.at(-1).filter((_, i) => i % 50 === 0 || i === 3999).map(({ reference }) => reference.deref());
await new Promise(resolve => setTimeout(resolve, 5));
writeOverTheStack(200);
fullGC();
for (const copies of made) for (const { address, words } of copies) readSync(fd, words, 0, 32, address);
for (let i = 0; i < kinds.length; i++) {
  const collected = made[i].filter(({ reference }) => reference.deref() === undefined);
  const overwritten = collected.filter(({ words }) => words.every(word => word === 0xbadbeef0n || word === givenBack));
  console.log(kinds[i].join(" "), collected.length > 0, overwritten.length === collected.length);
}
console.log(kept.length, "stay, some lay in a page that was given back", made.at(-1).some(({ words }) => words.every(word => word === givenBack)));
`;

test.skipIf(!isLinux || isASAN)(
  "under useZombieMode a sweep overwrites dead cells",
  async () => {
    using dir = tempDir("aot-zombie-mode", { "entry.js": program });
    const executable = join(String(dir), "entry");
    const build = await run(
      [bunExe(), "build", "--compile", "--aot", "entry.js", "--outfile", executable],
      String(dir),
    );
    expect({ stderr: build.exitCode ? build.stderr : "", exitCode: build.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    for (const command of [[bunExe(), "entry.js"], [executable]]) {
      const { stdout, exitCode } = await run(command, String(dir), {
        ...bunEnv,
        BUN_JSC_useZombieMode: "1",
        BUN_JSC_poisonDecommittedMarkedBlockPages: "1",
      });
      expect({ stdout, exitCode }).toEqual({
        stdout:
          "fractions 12 true true\nobjects 12 true true\nfractions 300 true true\nfractions 40000 true true\nfields 0 true true\nfractions 12 many true true\n81 stay, some lay in a page that was given back true\n",
        exitCode: 0,
      });
    }
  },
  240_000,
);

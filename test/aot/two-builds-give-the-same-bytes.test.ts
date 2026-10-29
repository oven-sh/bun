// Two builds of one program with --aot give the same executable, byte for byte. Nothing in the compiler may follow an address, a clock,
// the order in which threads finish or the folder that holds the program. The functions here keep more numbers alive across a loop than
// there are registers, so each of them moves several values between the stack and registers at the ends of its loop: the order of such
// moves once followed addresses.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported } from "./harness/commands";
import { withoutDebugInformation } from "./harness/without-debug-information";

const numberOfFunctions = 150;

function search(index: number): string {
  return `
function search${index}(code: number, map: readonly number[], a: number, b: number, c: number, d: number, e: number, f: number): number {
  let lo = ${index % 3}, hi = map.length, mid = 0;
  const s0 = a * b, s1 = b * c, s2 = c * d, s3 = d * e, s4 = e * f, s5 = f * a, s6 = a + c, s7 = b + d;
  while (lo + 1 < hi) {
    mid = lo + (hi - lo) / 2;
    mid -= mid % 2;
    if (map[mid] <= code && code <= map[mid + 1]) return s0 + s1 + s2 + s3 + s4 + s5 + s6 + s7 + mid;
    if (code < map[mid]) hi = mid;
    else lo = mid + 2;
  }
  return s0 - s1 + s2 - s3 + s4 - s5 + s6 - s7 + lo + hi + ${index};
}
total += search${index}(${index % 50}, map, 1.5, 2.5, 3.5, ${index}, 5.5, 6.5);
`;
}

const sources = {
  "entry.ts": `
const map = [1, 5, 9, 12, 20, 31, 40, 44];
let total = 0;
${Array.from({ length: numberOfFunctions }, (_, index) => search(index)).join("")}
console.log(total);
`,
};

const sourcesOfSeveralFiles = {
  "entry.ts": `
import name from "named";
import data from "./lib/data.json";
import { twice } from "./lib/twice";
const inner = require("./lib/inner.cjs");
console.log(twice(2), data.name, name, inner.file, import.meta.url, new Error("here").stack);
console.log(new Function("a", "return a * 2")(4), (0, eval)("(0, eval)('3 + 4')"));
console.log((await import("./lib/lazy.mjs")).default);
`,
  "lib/twice.ts": `export function twice(n: number) { return n * 2; }`,
  "lib/data.json": `{ "name": "data" }`,
  "lib/inner.cjs": `module.exports = { file: __filename };`,
  "lib/lazy.mjs": `export default "lazy";`,
  "node_modules/named/package.json": `{ "name": "named", "main": "index.js" }`,
  "node_modules/named/index.js": `module.exports = "named";`,
};

describe.skipIf(!!unsupported)("compile/aot/two-builds-give-the-same-bytes", () => {
  const folder = String(tempDir("aot-same-bytes", sources));
  const folders = ["aot-same-bytes-short", "aot-same-bytes-in-a-folder-with-a-longer-name"].map(name =>
    String(tempDir(name, sourcesOfSeveralFiles)),
  );
  afterAll(() => [folder, ...folders].forEach(each => rmSync(each, { recursive: true, force: true })));

  test("three builds of one program are equal", async () => {
    await slot(async () => {
      const executable = join(folder, isWindows ? "compiled.exe" : "compiled");
      const hashes: string[] = [];
      for (let build = 0; build < 3; build++) {
        built(
          await spawned(
            [
              bunExe(),
              "build",
              "--compile",
              ...withoutDebugInformation,
              "--aot",
              "./entry.ts",
              "--outfile",
              executable,
            ],
            folder,
            bunEnv,
          ),
        );
        hashes.push(Bun.hash(readFileSync(executable)).toString(16));
        rmSync(executable);
      }
      expect(hashes).toEqual([hashes[0], hashes[0], hashes[0]]);
    });
  }, 600_000);

  test("builds of one program in two folders are equal", async () => {
    await slot(async () => {
      const hashes: string[] = [];
      for (const each of folders) {
        const executable = join(each, isWindows ? "compiled.exe" : "compiled");
        built(
          await spawned(
            [
              bunExe(),
              "build",
              "--compile",
              ...withoutDebugInformation,
              "--aot",
              "./entry.ts",
              "--outfile",
              executable,
            ],
            each,
            bunEnv,
          ),
        );
        hashes.push(Bun.hash(readFileSync(executable)).toString(16));
      }
      expect(hashes[1]).toBe(hashes[0]);
    });
  }, 600_000);
});

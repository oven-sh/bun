// Two builds of one program with --aot give the same executable, byte for byte. Nothing in the compiler may follow an address, a clock
// or the order in which threads finish. The functions here keep more numbers alive across a loop than there are registers, so each of
// them moves several values between the stack and registers at the ends of its loop: the order of such moves once followed addresses.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported } from "./run-programs";

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

describe.skipIf(!!unsupported)("compile/aot/two-builds-give-the-same-bytes", () => {
  const folder = String(tempDir("aot-same-bytes", sources));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  test("three builds of one program are equal", async () => {
    await slot(async () => {
      const executable = join(folder, isWindows ? "compiled.exe" : "compiled");
      const hashes: string[] = [];
      for (let build = 0; build < 3; build++) {
        built(
          await spawned(
            [bunExe(), "build", "--compile", "--aot", "./entry.ts", "--outfile", executable],
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

  test("the order in which the allocator hands out memory changes nothing", async () => {
    await slot(async () => {
      const executable = join(folder, isWindows ? "compiled.exe" : "compiled");
      const hashes: string[] = [];
      for (const environment of [bunEnv, { ...bunEnv, MIMALLOC_HAND_OUT_LAST_FREED: "0" }]) {
        built(
          await spawned(
            [bunExe(), "build", "--compile", "--aot", "./entry.ts", "--outfile", executable],
            folder,
            environment,
          ),
        );
        hashes.push(Bun.hash(readFileSync(executable)).toString(16));
        rmSync(executable);
      }
      expect(hashes).toEqual([hashes[0], hashes[0]]);
    });
  }, 600_000);
});

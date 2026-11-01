import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const program = `const tables = [];
for (let t = 0; t < 40; t++) {
  class Row {
    id = 1;
    label = "a";
    note;
  }
  const table = new Row();
  const keys = [];
  for (let k = 0; k < 400; k++) keys.push("k" + t + "_" + k);
  for (let k = 0; k < 400; k++) table[keys[k]] = k;
  tables.push({ table, keys });
}
let sum = 0;
for (const { table, keys } of tables) {
  delete table.note;
  table.note = "late";
  for (let k = 0; k < 200; k++) delete table[keys[k]];
  sum += table.note.length + Object.keys(table).length;
}
console.log(sum);
`;

const withoutCollections = {
  ...bunEnv,
  BUN_GC_TIMER_DISABLE: "1",
  BUN_JSC_percentCPUPerMBForEdenTimer: "0",
  BUN_JSC_percentCPUPerMBForFullTimer: "0",
  BUN_JSC_smallHeapSize: "2000000000",
  BUN_JSC_largeHeapSize: "2000000000",
};

test("names made at run time: every run of one executable leaves as many first misses unfiled", async () => {
  using dir = tempDir("aot-the-same-first-misses", { "main.js": program });
  const folder = String(dir);
  const executable = join(folder, isWindows ? "main.exe" : "main");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable],
    folder,
    bunEnv,
  );
  expect(built.stderr + built.exitCode).toEndWith("0");
  const plain = await run([bunExe(), "main.js"], folder, bunEnv);
  const runs = await Promise.all(
    Array.from({ length: 12 }, async (_, index) => {
      const path = join(folder, `counts-${index}`);
      const { stdout, exitCode } = await run([executable], folder, {
        ...withoutCollections,
        BUN_JSC_aotCountsPath: path,
      });
      const unfiled = readFileSync(path, "utf8").match(/^(\d+)\tcounter:FirstMissesNotFiled$/m)?.[1];
      return { stdout, exitCode, unfiled };
    }),
  );
  expect(Number(runs[0].unfiled)).toBeGreaterThan(1000);
  expect(runs).toEqual(runs.map(() => ({ stdout: plain.stdout, exitCode: 0, unfiled: runs[0].unfiled })));
}, 120_000);

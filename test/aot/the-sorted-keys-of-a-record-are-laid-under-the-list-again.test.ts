import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// Object.keys() of records of one shape hands out lists over one shared storage. Sorted in default order, the sorted storage made the first time is laid under every later list:
// two shapes, a hundred turns. The engine shares the keys of a shape from the second asking on, so the first list of each shape has storage of its own, the second is sorted and remembered,
// and the 98 behind it take what was remembered. A list that was written has storage of its own and is sorted each time.
const program = [
  `"use strict";`,
  `const records = JSON.parse('[{"delta":1,"alpha":2,"charlie":3},{"b":1,"a":2}]');`,
  `let sum = 0;`,
  `for (let turn = 0; turn < 100; turn++) { for (const record of records) sum += Object.keys(record).sort()[0].length; const own = Object.keys(records[0]); own.push("z" + turn); sum += own.sort()[0].length; }`,
  `console.log(sum);`,
].join("\n");

test("the sorted keys of a record are laid under the list again", async () => {
  using dir = tempDir("aot-the-sorted-keys-of-a-record", { "main.cjs": program });
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable], String(dir));
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const counts = join(String(dir), "counts.txt");
  const ran = await run([executable], String(dir), { ...bunEnv, BUN_JSC_aotCountsPath: counts });
  expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({
    stdout: "1100\n",
    stderr: "",
    exitCode: 0,
  });
  const again = Number(
    readFileSync(counts, "utf8")
      .split("\n")
      .find(line => line.endsWith("counter:SortedStorageCacheHits"))
      ?.split("\t")[0] ?? -1,
  );
  expect(again).toBe(196);
}, 120_000);

import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// An instance has room for 32,768 answers at sites. `status` of a Response is a custom accessor of a host object: no site can hold an answer for it.
// More such sites than there is room, each entered once; behind them one ordinary loop over parsed records, entered again and again: its sites are filled, and the run time is asked no more.
const sites = 34_000;
const program = [
  `"use strict";`,
  `globalThis[process.argv[1]] = new Response(null, { status: 201 });`,
  `const held = { rows: [globalThis[process.argv[1]]] };`,
  ...Array.from(
    { length: sites },
    (_, i) => `function f${i}(rows) { let s = 0; for (const r of rows) s += r.status * 2; return s; }`,
  ),
  `const all = [${Array.from({ length: sites }, (_, i) => "f" + i).join(",")}];`,
  `let sum = 0; for (const f of all) sum = (sum + f(held.rows)) % 1000003;`,
  `const records = JSON.parse("[" + Array.from({ length: 100 }, (_, i) => '{"price":' + i + ',"count":' + (i % 7) + "}").join() + "]");`,
  `function total(rows) { let s = 0; for (const r of rows) s += r.price * r.count; return s; }`,
  `const turns = +process.argv[2]; for (let t = 0; t < turns; t++) sum = (sum + total(records)) % 1000003;`,
  `console.log(sum);`,
].join("\n");

// What the program prints: every site reads 201 and adds twice that, and every turn adds the price times the count of each record.
function printed(turns: number) {
  let ofATurn = 0;
  for (let i = 0; i < 100; i++) ofATurn += i * (i % 7);
  return `${(sites * 201 * 2 + turns * ofATurn) % 1000003}\n`;
}

test("sites that can never be filled take no room from the sites that can", async () => {
  using dir = tempDir("aot-sites-that-can-never-be-filled", { "main.cjs": program });
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  // The program imports no built-in module: Bun's library stays out of the build.
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "--no-builtin-modules", "main.cjs", "--outfile", executable],
    String(dir),
  );
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const counts = (turns: number) => join(String(dir), "counts-" + turns + ".txt");
  const ran = (turns: number) =>
    run([executable, String(turns)], String(dir), { ...bunEnv, BUN_JSC_aotCountsPath: counts(turns) });
  const [few, many] = await Promise.all([ran(20), ran(220)]);
  expect({ few, many }).toEqual({
    few: { stdout: printed(20), stderr: "", exitCode: 0 },
    many: { stdout: printed(220), stderr: "", exitCode: 0 },
  });
  // A line of the counts is a number, a tab and a name.
  const counted = (turns: number, name: string) =>
    Number(
      readFileSync(counts(turns), "utf8")
        .split("\n")
        .find(line => line.endsWith("\t" + name))
        ?.split("\t")[0],
    );
  // Every site asked to be filled, and two hundred more turns of the loop asked nothing more.
  const asked = counted(20, "operation:operationAOTFillSiteAnswers");
  expect(asked).toBeGreaterThanOrEqual(sites);
  expect(counted(220, "operation:operationAOTFillSiteAnswers") - asked).toBe(0);
  // None of them was given an answer of its own: the room that is taken stays far below their number.
  for (const turns of [20, 220]) expect(counted(turns, "counter:SiteCacheEntriesAllocated")).toBeLessThan(1000);
});

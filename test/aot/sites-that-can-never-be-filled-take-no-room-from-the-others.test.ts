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
  `const held = { rows: null }; held[process.argv.length > 99 ? "other" : "rows"] = [new Response(null, { status: 201 })];`,
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

test("sites that can never be filled take no room from the sites that can", async () => {
  using dir = tempDir("aot-sites-that-can-never-be-filled", { "main.cjs": program });
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable], String(dir));
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const fills = async (turns: number) => {
    const counts = join(String(dir), "counts-" + turns + ".txt");
    const ran = await run([executable, String(turns)], String(dir), { ...bunEnv, BUN_JSC_aotCountsPath: counts });
    expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const line = readFileSync(counts, "utf8")
      .split("\n")
      .find(line => line.endsWith("operation:operationAOTFillSiteAnswers"));
    return Number(line?.split("\t")[0] ?? 0);
  };
  const few = await fills(20);
  expect(few).toBeGreaterThanOrEqual(sites);
  expect((await fills(220)) - few).toBe(0);
}, 240_000);

import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// An instance has room for 32,768 answers at sites. More sites than that, each of which could be answered and each entered ONCE: none of them takes an answer: the tables by name hold one cell for all of them.
// Behind them one ordinary loop over parsed records, entered again and again: its two sites are given answers.
const sites = 34_000;
const program = [
  `"use strict";`,
  `const held = { rows: null }; held[process.argv.length > 99 ? "other" : "rows"] = [JSON.parse('{"status":201}')];`,
  ...Array.from(
    { length: sites },
    (_, i) => `function f${i}(rows) { let s = 0; for (const r of rows) s += r.status * 2; return s; }`,
  ),
  `const all = [${Array.from({ length: sites }, (_, i) => "f" + i).join(",")}];`,
  `let sum = 0; for (const f of all) sum = (sum + f(held.rows)) % 1000003;`,
  `const records = JSON.parse("[" + Array.from({ length: 100 }, (_, i) => '{"s' + (i % 5) + '":0,"price":' + i + ',"count":' + (i % 7) + "}").join() + "]");`,
  `function total(rows) { let s = 0; for (const r of rows) s += r.price * r.count; return s; }`,
  `for (let t = 0; t < 200; t++) sum = (sum + total(records)) % 1000003;`,
  `console.log(sum);`,
].join("\n");

test("sites that run once take no room from the sites that run often", async () => {
  using dir = tempDir("aot-sites-that-run-once", { "main.cjs": program });
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable], String(dir));
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const counts = join(String(dir), "counts.txt");
  const ran = await run([executable], String(dir), { ...bunEnv, BUN_JSC_aotCountsPath: counts });
  expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const given = Number(
    readFileSync(counts, "utf8")
      .split("\n")
      .find(line => line.endsWith("counter:AnswersGivenToSites"))
      ?.split("\t")[0] ?? -1,
  );
  expect(given).toBeGreaterThanOrEqual(2);
  expect(given).toBeLessThan(1000);
}, 240_000);

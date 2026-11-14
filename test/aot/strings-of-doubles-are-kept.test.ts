import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// A loop puts two fractions, null and a boolean into templates: each fraction is converted once, the others never.
const program = [
  `"use strict";`,
  `function line(marks, turns) { let text = ""; for (let turn = 0; turn < turns; turn++) text = \`\${text.slice(0, 9)}\${marks[turn % marks.length]}\`; return text; }`,
  `console.log(line([1.5, null, -0.25, true, "t"], 1000));`,
].join("\n");

test("the string of a double is found again", async () => {
  using dir = tempDir("aot-strings-of-doubles", { "main.cjs": program });
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable], String(dir));
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const counts = join(String(dir), "counts.txt");
  const ran = await run([executable], String(dir), { ...bunEnv, BUN_JSC_aotCountsPath: counts });
  expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({
    stdout: "1.5null-0t\n",
    stderr: "",
    exitCode: 0,
  });
  const converted = Number(
    readFileSync(counts, "utf8")
      .split("\n")
      .find(line => line.endsWith("counter:DoublesConvertedToStrings"))
      ?.split("\t")[0] ?? -1,
  );
  expect(converted).toBe(2);
}, 120_000);

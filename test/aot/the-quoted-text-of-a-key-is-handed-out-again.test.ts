import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// JSON.stringify of a key of a record: a short text that has its hash. The quoted text that was made the first time is handed out again: six keys, a hundred turns: six are made.
// A text that needs an escape is made anew each time.
const program = [
  `"use strict";`,
  `const record = JSON.parse('{"id":1,"name":"a","kind":"x","size":3,"path":"p","mode":"m"}');`,
  `const odd = JSON.parse('{"a\\\\b":1}');`,
  `let sum = 0;`,
  `for (let turn = 0; turn < 100; turn++) { for (const key of Object.keys(record)) sum += JSON.stringify(key).length; for (const key of Object.keys(odd)) sum += JSON.stringify(key).length; }`,
  `console.log(sum);`,
].join("\n");

test("the quoted text of a key is handed out again", async () => {
  using dir = tempDir("aot-the-quoted-text-of-a-key", { "main.cjs": program });
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable], String(dir));
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const counts = join(String(dir), "counts.txt");
  const ran = await run([executable], String(dir), { ...bunEnv, BUN_JSC_aotCountsPath: counts });
  expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({
    stdout: "3900\n",
    stderr: "",
    exitCode: 0,
  });
  const again = Number(
    readFileSync(counts, "utf8")
      .split("\n")
      .find(line => line.endsWith("counter:QuotedTextsHandedOutAgain"))
      ?.split("\t")[0] ?? -1,
  );
  expect(again).toBe(594);
}, 120_000);

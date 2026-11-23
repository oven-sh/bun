import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// `return step.apply(null, [n - 1, , acc + 1])` in a test file is a tail call as it is in an executable: the stack stays flat whatever the list holds.
// Each file of the folder is a test file of its own, built alone.
const folder = join(import.meta.dir, "tail-calls-with-lists-in-test-runs");

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--timeout=60000", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return { stdout, results, exitCode };
}

for (const file of readdirSync(folder).sort()) {
  test(file.replace(/\.fixture\.ts$/, ""), async () => {
    using dir = tempDir("tail-calls-with-lists-in-test-runs", {
      "one.test.ts": readFileSync(join(folder, file), "utf8"),
    });
    const plain = await runTests(String(dir));
    expect(plain.results.filter(result => result.startsWith("fail"))).toEqual([]);
    expect(plain.results).not.toEqual([]);
    expect(await runTests(String(dir), "--aot")).toEqual(plain);
  });
}

// `bun test --aot --parallel --timings` over layers runs the slow test files first, each a part that is soon built and runs long, and the quick ones last, in parts that take longer
// to build than to run. Builds followed the workers: a part for each worker without one, and two that lay ready. So the builders idled while the slow files ran, and at the end
// the workers waited for builds, and each that waited called for one more: up to twenty builders at once beside 24 workers, the highest memory of a large run.
// Two builders now go on while parts are left, however many lie ready, and what lies ready waits in a file.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

const quick = (name: string) => `import { test } from "bun:test";\ntest("${name}", () => {});\n`;
const names = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

test("every part is built while the first file runs", async () => {
  using dir = tempDir("aot-parts-are-built-while-the-slow-files-run", {
    "package.json": `{ "name": "p" }`,
    // It ends when it is told that the four parts are built.
    "slow.test.ts": `import { test } from "bun:test";
import { existsSync } from "node:fs";
test("slow", async () => {
  const until = Date.now() + 20_000;
  while (!existsSync("every-part-is-built") && Date.now() < until) await Bun.sleep(20);
  console.error("SLOW", existsSync("every-part-is-built") ? "was told" : "gave up");
}, 60_000);
`,
    ...Object.fromEntries(names.map(name => [`${name}.test.ts`, quick(name)])),
    "timings.json": JSON.stringify({
      version: 1,
      files: { "slow.test.ts": 5000, ...Object.fromEntries(names.map(name => [`${name}.test.ts`, 10])) },
    }),
  });
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", "--aot", "--parallel=1", "--timings=timings.json"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:2", BUN_JSC_logAOTPhaseTimes: "1" },
    stdout: "ignore",
    stderr: "pipe",
  });
  let stderr = "";
  const decoder = new TextDecoder();
  for await (const chunk of child.stderr) {
    stderr += decoder.decode(chunk, { stream: true });
    // slow | a b c d | e f g h | i j
    if (stderr.match(/^AOT part build \| test files \| wall /gm)?.length === 4)
      writeFileSync(join(String(dir), "every-part-is-built"), "");
  }
  expect({ slow: stderr.match(/^SLOW (.*)$/m)?.[1], exitCode: await child.exited }).toEqual({
    slow: "was told",
    exitCode: 0,
  });
}, 240_000);

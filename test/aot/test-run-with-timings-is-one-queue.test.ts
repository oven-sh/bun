import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const notesItsStart = (name: string) => `import { test } from "bun:test";
import { appendFileSync } from "node:fs";
appendFileSync(process.env.STARTED!, "${name}\\n");
test("${name}", async () => {
  await Bun.sleep(300);
});
`;

test("with --timings the two slowest files start first, though they lie in one folder", async () => {
  using dir = tempDir("aot-test-run-with-timings", {
    "a/one.test.ts": notesItsStart("one"),
    "a/two.test.ts": notesItsStart("two"),
    "b/three.test.ts": notesItsStart("three"),
    "b/four.test.ts": notesItsStart("four"),
    "b/five.test.ts": notesItsStart("five"),
    "timings.json": JSON.stringify({
      version: 1,
      files: {
        "a/one.test.ts": 135,
        "a/two.test.ts": 226,
        "b/three.test.ts": 67,
        "b/four.test.ts": 67,
        "b/five.test.ts": 67,
      },
    }),
  });
  const started = join(String(dir), "started.txt");
  const { stderr, exitCode } = await run(
    [bunExe(), "test", "--aot", "--parallel=2", "--timings=timings.json"],
    String(dir),
    { ...bunEnv, STARTED: started },
  );
  expect(stderr).toContain("5 pass");
  expect(exitCode).toBe(0);
  expect(readFileSync(started, "utf8").trim().split("\n").slice(0, 2).sort()).toEqual(["one", "two"]);
}, 120_000);

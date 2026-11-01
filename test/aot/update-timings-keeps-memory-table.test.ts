import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { raiseDefaultTimeout, test } from "./harness/default-timeout";
import { run } from "./harness/run";

raiseDefaultTimeout(60_000);

const testFile = `import { test } from "bun:test"; test("passes", () => {});`;

async function tableAfter(...flags: string[]) {
  using dir = tempDir("update-timings-keeps-memory", {
    "a.test.js": testFile,
    "b.test.js": testFile,
    "c.test.js": testFile,
    "d.test.js": testFile,
    "timings.json": JSON.stringify({
      version: 1,
      files: { "a.test.js": 10, "b.test.js": 10, "c.test.js": 10, "d.test.js": 10 },
      memory: { "a.test.js": 3000, "b.test.js": 40, "d.test.js": 1400 },
    }),
  });
  const { stderr, exitCode } = await run(
    [bunExe(), "test", "--timings=timings.json", "--update-timings", ...flags, "."],
    String(dir),
    bunEnv,
  );
  expect({ exitCode, output: exitCode ? stderr : "" }).toEqual({ exitCode: 0, output: "" });
  const table = JSON.parse(readFileSync(join(String(dir), "timings.json"), "utf8"));
  return { files: Object.keys(table.files).sort(), memory: table.memory };
}

test("--shard --update-timings without --aot keeps the memory entries of the files it ran", async () => {
  expect(await tableAfter("--shard=1/2")).toEqual({
    files: ["a.test.js", "b.test.js"],
    memory: { "a.test.js": 3000, "b.test.js": 40 },
  });
  expect(await tableAfter("--shard=2/2")).toEqual({
    files: ["c.test.js", "d.test.js"],
    memory: { "d.test.js": 1400 },
  });
});

test("so does --shard --parallel", async () => {
  expect(await tableAfter("--shard=1/2", "--parallel=2")).toEqual({
    files: ["a.test.js", "b.test.js"],
    memory: { "a.test.js": 3000, "b.test.js": 40 },
  });
});

test("without --shard the whole memory table is kept", async () => {
  expect(await tableAfter()).toEqual({
    files: ["a.test.js", "b.test.js", "c.test.js", "d.test.js"],
    memory: { "a.test.js": 3000, "b.test.js": 40, "d.test.js": 1400 },
  });
});

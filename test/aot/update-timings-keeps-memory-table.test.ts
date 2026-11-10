import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { raiseDefaultTimeout, test } from "./harness/default-timeout";
import { run } from "./harness/run";

raiseDefaultTimeout(60_000);

const testFile = `import { test } from "bun:test"; test("passes", () => {});`;

const files = { "a.test.js": 10, "b.test.js": 10, "c.test.js": 10, "d.test.js": 10 };
const ofCompiledRun = {
  version: 1,
  workers: 8,
  files,
  memory: { "a.test.js": 3000, "b.test.js": 40, "d.test.js": 1400 },
};

async function written(table: object, ...flags: string[]) {
  using dir = tempDir("update-timings-keeps-memory", {
    "a.test.js": testFile,
    "b.test.js": testFile,
    "c.test.js": testFile,
    "d.test.js": testFile,
    "timings.json": JSON.stringify(table),
  });
  const { stderr, exitCode } = await run(
    [bunExe(), "test", "--timings=timings.json", "--update-timings", ...flags, "."],
    String(dir),
    bunEnv,
  );
  expect({ exitCode, output: exitCode ? stderr : "" }).toEqual({ exitCode: 0, output: "" });
  return JSON.parse(readFileSync(join(String(dir), "timings.json"), "utf8"));
}

async function tableAfter(...flags: string[]) {
  const table = await written(ofCompiledRun, ...flags);
  return { files: Object.keys(table.files).sort(), memory: table.memory };
}

test("a plain run under --shard writes the times of the files it ran and nothing else, as it did before --aot", async () => {
  for (const flags of [["--shard=1/2"], ["--shard=1/2", "--parallel=2"]]) {
    const table = await written(ofCompiledRun, ...flags);
    expect({ flags, keys: Object.keys(table), files: Object.keys(table.files).sort() }).toEqual({
      flags,
      keys: ["version", "files"],
      files: ["a.test.js", "b.test.js"],
    });
  }
});

test("a compiled run under --shard keeps the memory entries of the files it ran", async () => {
  for (const shard of ["--shard=1/2", "--shard=2/2"]) {
    const { files, memory } = await tableAfter("--aot", shard);
    const kept = Object.entries(ofCompiledRun.memory).filter(([name]) => files.includes(name));
    expect({ shard, memory: memory ?? {} }).toEqual({ shard, memory: Object.fromEntries(kept) });
  }
});

test("without --shard the whole memory table is kept", async () => {
  expect(await tableAfter()).toEqual({
    files: ["a.test.js", "b.test.js", "c.test.js", "d.test.js"],
    memory: { "a.test.js": 3000, "b.test.js": 40, "d.test.js": 1400 },
  });
});

test("a plain run writes no number of workers", async () => {
  for (const flags of [[], ["--parallel=3"], ["--shard=1/2"], ["--shard=1/2", "--parallel=3"]]) {
    const { workers } = await written(ofCompiledRun, ...flags);
    expect({ flags, workers }).toEqual({ flags, workers: undefined });
  }
});

test("a compiled run without --parallel keeps the number of workers", async () => {
  expect((await written(ofCompiledRun, "--aot")).workers).toBe(8);
});

test("a compiled run under --parallel writes its own", async () => {
  expect((await written(ofCompiledRun, "--aot", "--parallel=2")).workers).toBe(2);
});

test("a table of plain bun test gets neither", async () => {
  expect(Object.keys(await written({ version: 1, files }, "--parallel=3"))).toEqual(["version", "files"]);
});

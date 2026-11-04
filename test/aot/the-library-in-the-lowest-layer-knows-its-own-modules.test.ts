import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

// The test files of a run are code that the build of the lowest layer does not see. They can name node:stream and not internal:streams/state, and that layer holds
// every module of Bun's own code that the run can load, so none runs from its text and names it either. So what the modules of the library read off each other's
// exports stays known: `state[kState]` in internal:streams/readable is a read of a slot, as in an executable, and no search under a key.
// The layer is built as `bun test --aot` builds it, alone, and the compiler's map says which operations a function is made of.
test("the modules of the library read each other's exports as in an executable", async () => {
  using dir = tempDir("aot-the-library-in-the-lowest-layer", {
    "a.test.ts": `
      import { test } from "bun:test";
      import { Readable } from "node:stream";
      test("a", async () => { for await (const chunk of Readable.from([1])) void chunk; });
      // It may be the name of any module, so the layer holds them all.
      test.skipIf(!process.env.NAME)("b", async () => { await import(process.env.NAME); });`,
  });
  const graph = join(String(dir), "graph");
  const map = join(String(dir), "map");
  writeFileSync(graph, join(String(dir), "a.test.ts") + "\0");
  const descriptor = openSync(graph, "r+");
  try {
    await using build = Bun.spawn({
      cmd: [bunExe(), "test", "--aot", "--aot-build-test-part=3,shared,packages"],
      cwd: String(dir),
      env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2", BUN_JSC_aotMapFilePath: map },
      stdio: ["ignore", "pipe", "pipe", descriptor],
    });
    const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
    expect({ stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  } finally {
    closeSync(descriptor);
  }
  const lines = readFileSync(map, "utf8").split("\n");
  const at = lines.findIndex(line => {
    const [kind, , , , , , , name, variant] = line.split("\t");
    return kind === "F" && name === "emitReadable_" && variant === "library";
  });
  expect(at).toBeGreaterThan(-1);
  const operations = lines[at + 1].split("\t");
  expect(operations[0]).toBe("O");
  expect(operations.filter(word => word === "ElemGet" || word === "ElemSet")).toEqual([]);
}, 120_000);

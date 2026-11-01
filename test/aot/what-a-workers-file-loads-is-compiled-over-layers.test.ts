import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

async function ran(starts: string, loads: string, flags: string[], words = "") {
  using dir = tempDir("aot-what-a-workers-file-loads", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "w.js": `postMessage(typeof (${loads}));\n`,
    "a.test.js": `import { test } from "bun:test";
import { join } from "node:path";
test("first", async () => {
  const worker = ${starts};
  console.log("SEEN", await new Promise(done => { worker.onmessage = event => done(event.data); }));
  worker.terminate();
});
`,
    "b.test.js": `import { test } from "bun:test";
test("second", () => {
  console.log("SEEN");
});
`,
  });
  const cwd = String(dir);
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--timeout=60000", ...flags], cwd, {
    ...bunEnv,
    BUN_DEBUG_TEST_AOT_WORDS: words,
    [runtimeEnvironment.countsPath]: join(cwd, "counts-%p"),
  });
  return {
    seen: (stdout + stderr).split("\n").filter(line => line.startsWith("SEEN")),
    exitCode,
    interpreted: readdirSync(cwd)
      .filter(name => name.startsWith("counts-"))
      .flatMap(name => readFileSync(join(cwd, name), "utf8").split("\n"))
      .filter(line => /\tcounter:Interpreted(Function|Global|Eval|Module)Code$/.test(line))
      .reduce((sum, line) => sum + Number(line.split("\t")[0]), 0),
  };
}

const byURL = `new Worker(new URL("./w.js", import.meta.url))`;

test.each([
  [byURL, `require("node:zlib").gzipSync("a")`],
  [byURL, `require("node:crypto").createHash("sha256").update("a").digest("hex")`],
  [byURL, `new (require("bun:sqlite").Database)(":memory:").query("select 1 as a").get()`],
  [byURL, `require("node:child_process").spawnSync("true").status`],
  [byURL, `Bun.$`],
  [`new Worker(join(import.meta.dir, "w.js"))`, `require("node:zlib").gzipSync("a")`],
])("%s: %s", async (starts, loads) => {
  const { seen } = await ran(starts, loads, []);
  expect(seen).toHaveLength(2);
  const compiled = { seen, exitCode: 0, interpreted: 0 };
  expect(await ran(starts, loads, ["--aot"], "TestRunLayers:2")).toEqual(compiled);
  expect(await ran(starts, loads, ["--aot", "--isolate"], "TestRunLayers:3")).toEqual(compiled);
});

// ESM a.ts statically imports CJS-detected b.ts (no import/export). b.ts's
// body runs inside JSModuleLoader::makeModule's SyntheticSourceProvider
// generator — during loadRequestedModules, before any record reaches
// Evaluating. A require() back into the graph from there used to call
// loadModuleSync on a record at Status::New, re-enter HostLoadImportedModule
// for b.ts (still Fetching), and double-evaluate the graph (release) / trip
// ModuleRegistryEntry::fetchComplete's m_status == Fetching assertion (debug).
// Now it must throw ERR_REQUIRE_CYCLE_MODULE, matching Node.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("require(esm) from a CJS body running at makeModule time throws ERR_REQUIRE_CYCLE_MODULE", async () => {
  // No "type":"module" — b.ts has no import/export so the transpiler tags it
  // CJS, which is what routes it through the synthetic-source generator path.
  using dir = tempDir("require-esm-cycle-cjs", {
    "a.ts": `
      import "./b.ts";
      export const value = "ok";
    `,
    "b.ts": `
      let code = "no-throw";
      try {
        const a = require("./a.ts");
        // pre-fix (release): graph double-evaluated, a.value reachable here.
        void a.value;
      } catch (e) {
        code = e.code ?? e.constructor.name;
      }
      module.exports = { code };
      console.log(code);
    `,
    "entry.ts": `
      import "./a.ts";
      console.log("done");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  // pre-fix release printed "done\nok" (double-eval); pre-fix debug crashed
  // before printing anything from b's catch.
  expect(stdout.trim()).toBe("ERR_REQUIRE_CYCLE_MODULE\ndone");
  expect(exitCode).toBe(0);
});

test("require(esm) cycle from CJS names the requested module", async () => {
  using dir = tempDir("require-esm-cycle-cjs-message", {
    "a.ts": `
      import "./b.ts";
      export const value = 1;
    `,
    "b.ts": `
      try {
        require("./a.ts");
      } catch (e) {
        console.log(e.code, e.message.includes("a.ts"));
      }
    `,
    "entry.ts": `import "./a.ts";`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("ERR_REQUIRE_CYCLE_MODULE true");
  expect(exitCode).toBe(0);
});

test("require(esm) on a fresh module from a CJS body still works (only the cycle throws)", async () => {
  // b.ts is CJS reached via the same synthetic-source path; it require()s an
  // ESM that is *not* on the in-flight load graph. The Status::New check must
  // not over-match: c.ts has no registry entry yet, so loadModuleSync drives
  // it normally.
  using dir = tempDir("require-esm-cycle-cjs-fresh", {
    "a.ts": `
      import "./b.ts";
      export const value = "a";
    `,
    "b.ts": `
      const c = require("./c.ts");
      console.log(c.value);
    `,
    "c.ts": `
      export const value = "c-ok";
    `,
    "entry.ts": `
      import "./a.ts";
      console.log("done");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("c-ok\ndone");
  expect(exitCode).toBe(0);
});

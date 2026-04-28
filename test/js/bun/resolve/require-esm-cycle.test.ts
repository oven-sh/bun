// require(esm) on a module that is already on the InnerModuleEvaluation stack
// (status == Evaluating) used to fall through to loadModuleSync and return the
// namespace object before the body ran, exposing TDZ let/const/class exports.
// Now it must throw ERR_REQUIRE_CYCLE_MODULE — unless ExecuteModule has already
// run for that record (an SCC sibling whose body completed but whose status
// only flips to Evaluated once the SCC root pops), in which case the namespace
// is fully populated and is still returned.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("require(esm) on a module mid-evaluation throws ERR_REQUIRE_CYCLE_MODULE", async () => {
  using dir = tempDir("require-esm-cycle-throw", {
    "a.mjs": `
      import "./b.mjs";
      export const value = "ok";
    `,
    "b.mjs": `
      import { createRequire } from "node:module";
      const require = createRequire(import.meta.url);
      let code = "no-throw";
      try {
        const a = require("./a.mjs");
        // pre-fix: this access threw "Cannot access 'value' before initialization"
        void a.value;
      } catch (e) {
        code = e.code ?? e.constructor.name;
      }
      console.log(code);
    `,
    "entry.mjs": `import "./a.mjs";`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("ERR_REQUIRE_CYCLE_MODULE");
  expect(exitCode).toBe(0);
});

test("require(esm) on an SCC sibling whose body already ran returns the populated namespace", async () => {
  // entry imports c then d. c imports entry back, so c and entry share an SCC;
  // after c.execute() returns c stays at status Evaluating until entry (the
  // SCC root) finishes. d's body then require()s c — c is at Evaluating with
  // generator State != Init (body ran), so the const export is readable
  // without re-driving the loader.
  using dir = tempDir("require-esm-cycle-sibling", {
    "entry.mjs": `
      import "./c.mjs";
      import "./d.mjs";
      export const FROM_ENTRY = 1;
    `,
    "c.mjs": `
      import "./entry.mjs";
      export const FROM_C = "populated";
    `,
    "d.mjs": `
      import { createRequire } from "node:module";
      const require = createRequire(import.meta.url);
      const c = require("./c.mjs");
      console.log(c.FROM_C);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("populated");
  expect(exitCode).toBe(0);
});

test("require(esm) cycle error names the requested module", async () => {
  using dir = tempDir("require-esm-cycle-message", {
    "a.mjs": `
      import "./b.mjs";
      export const value = 1;
    `,
    "b.mjs": `
      import { createRequire } from "node:module";
      const require = createRequire(import.meta.url);
      try {
        require("./a.mjs");
      } catch (e) {
        console.log(e.code, e.message.includes("a.mjs"));
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "a.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("ERR_REQUIRE_CYCLE_MODULE true");
  expect(exitCode).toBe(0);
});

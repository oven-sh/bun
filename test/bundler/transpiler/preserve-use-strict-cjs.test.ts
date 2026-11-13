import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, bunRun, isWindows, tempDir } from "harness";
import path from "path";

test.concurrent(`"use strict'; preserves strict mode in CJS`, async () => {
  expect(await bunRun(path.join(import.meta.dir, "strict-mode-fixture.ts"))).toSpawn();
});

test.concurrent(`sloppy mode by default in CJS`, async () => {
  expect(await bunRun(path.join(import.meta.dir, "sloppy-mode-fixture.ts"))).toSpawn();
});

test.concurrent(`"use strict"; after another directive preserves strict mode in CJS`, async () => {
  expect(await bunRun(path.join(import.meta.dir, "strict-mode-after-directive-fixture.cjs"))).toSpawn("strict");
});

test.concurrent(`"use strict"; after another directive preserves strict mode with the inspector enabled`, async () => {
  // With the inspector enabled the runtime transpiler does not minify syntax,
  // so the "use client" directive stays in the output as the first statement.
  // The transpiler used to skip "use strict" in that case, and the module ran
  // in sloppy mode only while it was being debugged.
  const socket = `/tmp/bun-use-strict-inspect-${process.pid}-${Date.now()}.sock`;
  try {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "strict-mode-after-directive-fixture.cjs")],
      env: { ...bunEnv, BUN_INSPECT: isWindows ? "127.0.0.1:0" : "ws+unix://" + socket },
      stdout: "pipe",
      // The inspector prints its listening address here.
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("this is not undefined");
    expect(stdout).toBe("strict\n");
    expect(exitCode).toBe(0);
  } finally {
    rmSync(socket, { force: true });
  }
});

test.concurrent(`"use strict"; after another directive preserves strict mode under bun test --coverage`, async () => {
  // --coverage turns syntax minification off for the whole process, the same
  // way the inspector does, so a test suite used to see such modules in
  // sloppy mode only when coverage was enabled.
  using dir = tempDir("use-strict-coverage", {
    "lib.cjs": readFileSync(path.join(import.meta.dir, "strict-mode-after-directive-fixture.cjs"), "utf8"),
    "lib.test.ts": `
      import { expect, test } from "bun:test";
      test("lib is strict", () => {
        expect(require("./lib.cjs")).toEqual({ FORCE_COMMON_JS: true });
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage", "./lib.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // The fixture throws before it exports anything when it runs in sloppy mode.
  expect(stderr).not.toContain("this is not undefined");
  expect(stderr).toContain("1 pass");
  // The test runner prints its banner to stdout too.
  expect(stdout).toEndWith("strict\n");
  expect(exitCode).toBe(0);
});

// The classic wrapper of older npm packages and UMD bundles. Only the directive
// inside the function makes this code strict: the file is CommonJS and has none.
const strictWrapper = `
(function () { "use strict";
  const frozen = Object.freeze({ role: "user" });
  let write; try { frozen.role = "admin"; write = "no throw"; } catch (e) { write = e.name; }
  let undeclared; try { undeclared_name = 1; undeclared = "a global"; } catch (e) { undeclared = e.name; }
  function f() { return this === undefined ? "undefined" : "the global"; }
  console.log(write, undeclared, f());
})();
// Without an extension (stdin), this is what makes the file CommonJS.
module.exports = {};
`;
const strictWrapperOutput = "TypeError ReferenceError undefined\n";

async function runInDir(files: Record<string, string>, ...cmd: string[]) {
  using dir = tempDir("use-strict-function", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent.each([
  ["as the entry point", ["fn.cjs"]],
  ["when it is required", ["-e", `require("./fn.cjs")`]],
  ["in a Worker", ["-e", `new Worker("./fn.cjs")`]],
  [
    "from stdin",
    ["-e", `Bun.spawnSync({ cmd: [process.execPath, "-"], stdin: Bun.file("fn.cjs"), stdout: "inherit" })`],
  ],
])(`"use strict" in a function makes the function strict %s`, async (_, cmd) => {
  expect(await runInDir({ "fn.cjs": strictWrapper }, ...cmd)).toEqual({
    stdout: strictWrapperOutput,
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent.each([[[]], [["--minify"]]])(
  `"use strict" in a function stays in a --format=cjs bundle %j`,
  async flags => {
    const build = ["build", "fn.cjs", "--outfile=out.cjs", "--target=node", "--format=cjs", ...flags];
    using dir = tempDir("use-strict-function-bundle", { "fn.cjs": strictWrapper });
    for (const cmd of [build, ["out.cjs"]]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...cmd],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      if (cmd === build) {
        expect({ stderr, exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
      } else {
        expect({ stdout, stderr, exitCode }).toEqual({ stdout: strictWrapperOutput, stderr: "", exitCode: 0 });
      }
    }
  },
);

// Every kind of function body has a directive prologue.
test.concurrent(`"use strict" makes every kind of function strict`, async () => {
  const nested = `(function () { return this === undefined ? "strict" : "sloppy"; })()`;
  const result = await runInDir(
    {
      "kinds.cjs": `
        function declaration() { "use strict"; return ${nested}; }
        const expression = function () { "use strict"; return ${nested}; };
        const arrow = () => { "use strict"; return ${nested}; };
        const object = { method() { "use strict"; return ${nested}; }, get getter() { "use strict"; return ${nested}; } };
        function* generator() { "use strict"; yield ${nested}; }
        async function asyncFunction() { "use strict"; return ${nested}; }
        function sloppy() { return ${nested}; }
        asyncFunction().then(last =>
          console.log(declaration(), expression(), arrow(), object.method(), object.getter, generator().next().value, last, sloppy()),
        );
      `,
    },
    "kinds.cjs",
  );
  expect(result).toEqual({
    stdout: "strict strict strict strict strict strict strict sloppy\n",
    stderr: "",
    exitCode: 0,
  });
});

// A string that is not a directive in the source is not one in the output
// either. Without dead-code elimination the string statement is kept.
test.concurrent.each([
  ["with dead-code elimination", ["sloppy.cjs"]],
  ["for bun --print", ["-p", `require("./sloppy.cjs"), ""`]],
])(`a string that is not a directive does not become one %s`, async (_, cmd) => {
  const result = await runInDir(
    {
      "sloppy.cjs": `
        function paren() { ("use strict"); return typeof this; }
        function semicolon() { ;"use strict"; return typeof this; }
        function template() { \`use strict\`; return typeof this; }
        function escaped() { "use\\x20strict"; return typeof this; }
        function late() { var x; "use strict"; return typeof this; }
        function folded() { "use " + "strict"; return typeof this; }
        function inBlock() { { "use strict"; } return typeof this; }
        function inIf() { if (1) "use strict"; return typeof this; }
        console.log(paren(), semicolon(), template(), escaped(), late(), folded(), inBlock(), inIf());
      `,
    },
    ...cmd,
  );
  expect(result.stdout.trim()).toBe("object object object object object object object object");
  expect(result.exitCode).toBe(0);
});

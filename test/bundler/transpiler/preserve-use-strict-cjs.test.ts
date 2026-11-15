import { expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, tempDir } from "harness";
import path from "path";

test.concurrent(`"use strict'; preserves strict mode in CJS`, async () => {
  expect(await bunRun(path.join(import.meta.dir, "strict-mode-fixture.ts"))).toSpawn();
});

test.concurrent(`sloppy mode by default in CJS`, async () => {
  expect(await bunRun(path.join(import.meta.dir, "sloppy-mode-fixture.ts"))).toSpawn();
});

// Under --coverage the transpiler does not minify syntax, so it keeps "use client" as a statement.
test.concurrent.each([
  ["a class", "class K {}"],
  ["a variable", "var k = 1;"],
])(
  `"use strict" above another directive and %s preserves strict mode in CJS under --coverage`,
  async (_, statement) => {
    using dir = tempDir("preserve-use-strict-cjs", {
      "lib.cjs": `"use strict";\n"use client";\n${statement}\nmodule.exports = (function () { return this === undefined ? "strict" : "sloppy"; })();\n`,
      "lib.test.js": `test("mode", () => console.log(require("./lib.cjs")));\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--coverage", "./lib.test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("1 pass");
    expect(stdout.trim().split("\n").at(-1)).toBe("strict");
    expect(exitCode).toBe(0);
  },
);

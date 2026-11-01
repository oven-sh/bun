import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// A require() that goes into a context of node:vm is called by a text that the build hasn't read. An executable refuses the file that the text names, unless it
// holds it. The build can't know the name, so it says that a loader has left, and what helps. Both things that it advises work.
const files: Record<string, string> = {
  "lib/a.js": `module.exports = "a";`,
  "made.mjs": `import vm from "node:vm";
    import { createRequire } from "node:module";
    console.log(vm.runInNewContext("require('./lib/a.js')", { require: createRequire(import.meta.url) }));`,
  "own.cjs": `const vm = require("node:vm");
    console.log(vm.runInNewContext("require('./lib/a.js')", { require }));`,
  "quiet.mjs": `import vm from "node:vm";
    console.log(vm.runInNewContext("one + 1", { one: 1 }));`,
};
const warning = "TS100064: the program hands a require() to code that the compiler can't read";

test.each(["made.mjs", "own.cjs"])(
  "the build says that the require() of %s leaves for a text it can't read",
  async entry => {
    using dir = tempDir("aot-require-in-vm", files);
    using elsewhere = tempDir("aot-require-in-vm-elsewhere", {});
    const directory = String(dir);
    const executable = join(String(elsewhere), "program");
    const build = async (...flags: string[]) => {
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", entry, ...flags, "--outfile", executable],
        directory,
        bunEnv,
      );
      expect(built.exitCode).toBe(0);
      return (built.stdout + built.stderr).split(warning).length - 1;
    };

    expect(await build()).toBe(1);
    const refused = await run([executable], directory, bunEnv);
    expect(refused.stderr).toContain("it isn't in this executable");
    expect({ stdout: refused.stdout, exitCode: refused.exitCode }).toEqual({ stdout: "", exitCode: 1 });

    expect(await build("lib/a.js")).toBe(1);
    const held = await run([executable], String(elsewhere), bunEnv);
    expect({ stdout: held.stdout, exitCode: held.exitCode }).toEqual({ stdout: "a\n", exitCode: 0 });

    expect(await build("--aot-allow-code-from-disk")).toBe(0);
    const read = await run([executable], directory, bunEnv);
    expect({ stdout: read.stdout, exitCode: read.exitCode }).toEqual({ stdout: "a\n", exitCode: 0 });
  },
  240_000,
);

// Native code calls a loader that it is handed, and runs nothing that nobody has read.
test.each([
  `console.log(["node:os", "node:path"].map(require).length);`,
  `setTimeout(require, 0, "node:os"); console.log(2);`,
  `Promise.resolve("node:os").then(require).then(it => console.log(typeof it === "object" ? 2 : 0));`,
  `const load = require.bind(null); console.log(typeof load("node:os") === "object" ? 2 : 0);`,
  `globalThis.load = require; console.log(new Function("return 1 + 1")());`,
])(
  "no warning where no code that the build can't read gets the require(): %s",
  async program => {
    using dir = tempDir("aot-require-in-vm-native", { "main.cjs": program });
    const directory = String(dir);
    const executable = join(directory, "program");
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
      directory,
      bunEnv,
    );
    expect(built.exitCode).toBe(0);
    expect(built.stdout + built.stderr).not.toContain(warning);
    const ran = await run([executable], directory, bunEnv);
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "2\n", exitCode: 0 });
  },
  120_000,
);

test("a text that is handed no loader is no reason for a warning", async () => {
  using dir = tempDir("aot-require-in-vm-quiet", files);
  const directory = String(dir);
  const executable = join(directory, "program");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "quiet.mjs", "--outfile", executable],
    directory,
    bunEnv,
  );
  expect(built.exitCode).toBe(0);
  expect(built.stdout + built.stderr).not.toContain("TS100064");
  const ran = await run([executable], directory, bunEnv);
  expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "2\n", exitCode: 0 });
}, 120_000);

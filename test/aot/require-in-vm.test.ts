import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// A require() that goes into a context of node:vm is called by a text that the build hasn't read. An executable refuses the file that the text names, unless it
// holds it. The build can't know the name, so it says that a loader has left, and what helps. Both things that it advises work.
// Each program asks for two files: held/a.js, which its build gets as an entry point, and lib/a.js, which only the disk has.
const files: Record<string, string> = {
  "held/a.js": `module.exports = "held";`,
  "lib/a.js": `module.exports = "a";`,
  "made.mjs": `import vm from "node:vm";
    import { createRequire } from "node:module";
    const context = { require: createRequire(import.meta.url) };
    console.log(vm.runInNewContext("require('./held/a.js')", context));
    console.log(vm.runInNewContext("require('./lib/a.js')", context));`,
  "own.cjs": `const vm = require("node:vm");
    console.log(vm.runInNewContext("require('./held/a.js')", { require }));
    console.log(vm.runInNewContext("require('./lib/a.js')", { require }));`,
  "both.mjs": `import "./made.mjs";
    import "./own.cjs";`,
  "quiet.mjs": `import vm from "node:vm";
    console.log(vm.runInNewContext("one + 1", { one: 1 }));`,
};
const warning = "TS100064: the program passes require() to code that the compiler can't read";

/** Builds in a folder of the files, with the executable elsewhere. Answers how often the build warned. */
function project() {
  const dir = tempDir("aot-require-in-vm", files);
  const elsewhere = tempDir("aot-require-in-vm-elsewhere", {});
  const executable = join(String(elsewhere), "program");
  return {
    directory: String(dir),
    elsewhere: String(elsewhere),
    executable,
    async build(...operands: string[]) {
      const command = [bunExe(), "build", "--compile", "--aot", ...operands, "--outfile", executable];
      const built = await run(command, String(dir), bunEnv);
      expect(built.exitCode).toBe(0);
      return (built.stdout + built.stderr).split(warning).length - 1;
    },
    [Symbol.dispose]() {
      dir[Symbol.dispose]();
      elsewhere[Symbol.dispose]();
    },
  };
}

test.each(["made.mjs", "own.cjs"])(
  "the build says that the require() of %s leaves for a text it can't read",
  async entry => {
    using made = project();
    expect(await made.build(entry, "held/a.js")).toBe(1);
    const besideItsFiles = await run([made.executable], made.directory, bunEnv);
    expect(besideItsFiles.stderr).toContain("it isn't in this executable");
    expect({ stdout: besideItsFiles.stdout, exitCode: besideItsFiles.exitCode }).toEqual({
      stdout: "held\n",
      exitCode: 1,
    });
    const moved = await run([made.executable], made.elsewhere, bunEnv);
    expect({ stdout: moved.stdout, exitCode: moved.exitCode }).toEqual({ stdout: "held\n", exitCode: 1 });
  },
  120_000,
);

test("with --aot-allow-code-from-disk the build has nothing to warn of, and the files load", async () => {
  using made = project();
  expect(await made.build("both.mjs", "--aot-allow-code-from-disk")).toBe(0);
  const read = await run([made.executable], made.directory, bunEnv);
  expect({ stdout: read.stdout, exitCode: read.exitCode }).toEqual({ stdout: "held\na\nheld\na\n", exitCode: 0 });
}, 240_000);

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

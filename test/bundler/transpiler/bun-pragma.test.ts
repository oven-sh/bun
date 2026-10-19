import { promises as fs, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import vm from "node:vm";
import path from "path";

const fixturePath = (...segs: string[]): string => path.join(import.meta.dirname, "fixtures", "bun-pragma", ...segs);

const OK = 0;
const ERR = 1;

const runFixture = async (path: string): Promise<number> => {
  const child = Bun.spawn({
    cmd: [bunExe(), "run", path],
    env: bunEnv,
    stdio: ["ignore", "ignore", "ignore"],
  });
  await child.exited;
  expect(child.exitCode).not.toBeNull();
  return child.exitCode!;
};

const run = async (cwd: string, args: string[], env: NodeJS.Dict<string> = bunEnv) => {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], env, cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
};

describe("@bun pragma", () => {
  describe("valid files", async () => {
    const passPath = fixturePath("pass");
    const passFiles: string[] = await fs.readdir(passPath, { encoding: "utf-8" });
    expect(passFiles).not.toHaveLength(0);

    it.each(passFiles)("bun run %s", async file => {
      const fullpath = path.join(passPath, file);
      const exitCode = await runFixture(fullpath);
      expect(exitCode).toBe(OK);
    });
  });

  describe("invalid files", async () => {
    const failPath = fixturePath("fail");
    const failFiles: string[] = await fs.readdir(failPath, { encoding: "utf-8" });
    expect(failFiles).not.toHaveLength(0);

    it.each(failFiles)("bun run %s", async file => {
      const fullpath = path.join(failPath, file);
      const exitCode = await runFixture(fullpath);
      expect(exitCode).toBe(ERR);
    });
  });

  // The pragma line alone says what the source is: an ES module or CommonJS, with or without bytecode.
  describe("keywords are read from the pragma line only", () => {
    // An ES module. Read as CommonJS, it throws "Expected CommonJS module to have a function wrapper".
    const esm = `console.log("@bun-cjs is on the second line");\n`;
    describe.each([
      ["a keyword ends the pragma line", `// @bun @bytecode\n${esm}`],
      ["a lone @ ends the pragma line", `// @bun @\n${esm}`],
      ["a bare CR ends the pragma line", `// @bun\r${esm}`],
      ["the pragma line is below a hashbang line", `#!/usr/bin/env bun\n// @bun @bytecode\n${esm}`],
    ])("%s", (_, source) => {
      it.concurrent.each([
        ["as the entry point", "mod.js"],
        ["through require()", "require.cjs"],
        ["through import()", "import.mjs"],
      ])("%s", async (_, entry) => {
        using dir = tempDir("bun-pragma-line", {
          "mod.js": source,
          "require.cjs": `require("./mod.js");`,
          "import.mjs": `await import("./mod.js");`,
        });
        expect(await run(String(dir), [entry])).toEqual({
          stdout: "@bun-cjs is on the second line\n",
          stderr: "",
          exitCode: 0,
        });
      });
    });

    // `bun -e` gives its text to the same reader. Read as CommonJS, the text runs as a script, and a script
    // cannot hold an `import` statement.
    it.concurrent("bun -e", async () => {
      using dir = tempDir("bun-pragma-line", {});
      const source = `// @bun @bytecode\nimport { sep } from "node:path"; console.log("@bun-cjs is on the second line", sep.length);\n`;
      expect(await run(String(dir), ["-e", source])).toEqual({
        stdout: "@bun-cjs is on the second line 1\n",
        stderr: "",
        exitCode: 0,
      });
    });

    // `// @bun @bun-cjs` does not ask for bytecode, so the loader must not read `<file>.jsc`. The `.jsc` here is
    // one that JSC accepts for this exact text, so a cache hit in the log shows that the loader read it.
    const wrapper = (pragma: string) =>
      `${pragma}\n(function(exports, require, module, __filename, __dirname) {// built with @bytecode\nconsole.log("ran");})\n`;
    it.concurrent.each([
      ["// @bun @bun-cjs", false],
      ["// @bun @bytecode @bun-cjs", true],
    ])("%s above a line with the text @bytecode: reads the .jsc = %p", async (pragma, readsSidecar) => {
      const source = wrapper(pragma);
      using dir = tempDir("bun-pragma-sidecar", { "mod.cjs": source });
      const file = path.join(String(dir), "mod.cjs");
      writeFileSync(file + ".jsc", new vm.Script(source, { filename: file, produceCachedData: true }).cachedData!);
      const { stdout, stderr, exitCode } = await run(String(dir), ["mod.cjs"], {
        ...bunEnv,
        BUN_JSC_verboseDiskCache: "1",
      });
      expect({ stdout, cacheHit: stderr.includes("[Disk Cache] Cache hit for sourceCode"), exitCode }).toEqual({
        stdout: "ran\n",
        cacheHit: readsSidecar,
        exitCode: 0,
      });
    });

    // A keyword starts at any `@` of the pragma line, also at one directly after another `@`.
    it.concurrent("`// @bun @@bun-cjs` is CommonJS", async () => {
      using dir = tempDir("bun-pragma-line", {
        "mod.js": `// @bun @@bun-cjs\n(function(exports, require, module, __filename, __dirname) {console.log("ran");})\n`,
      });
      expect(await run(String(dir), ["mod.js"])).toEqual({ stdout: "ran\n", stderr: "", exitCode: 0 });
    });
  });
});

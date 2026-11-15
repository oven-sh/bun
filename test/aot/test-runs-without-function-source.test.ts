import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

// The same file as an executable and as a file that a test imports: both were built without the text of functions.
const file = `
  function handler(a) { return a + 1; }
  class Shape { area() { return 1; } }
  console.log("SAID", handler.toString(), Shape.prototype.area.toString(), String(() => 1));`;
const files = {
  "package.json": `{ "name": "function-source" }`,
  "file.js": file,
  "main.js": `import "./file.js";`,
  "file.test.js": `import { test } from "bun:test"; import "./file.js"; test("runs", () => {});`,
  "in-place.test.js": `import { test } from "bun:test"; test("runs", () => { ${file} });`,
};
const flag = "--no-compile-function-source";
const env = { ...bunEnv, NO_COLOR: "1" };
const said = (text: string) => text.split("\n").filter(line => line.startsWith("SAID "));

async function runTest(directory: string, name: string, flags: string[]) {
  const { stdout, exitCode } = await run([bunExe(), "test", ...flags, "./" + name], directory, env);
  return { said: said(stdout), exitCode };
}

async function runExecutable(directory: string, flags: string[]) {
  const outfile = flags.length ? "./without" : "./with";
  const build = [bunExe(), "build", "--compile", "--aot", ...flags, "./main.js", "--outfile", outfile];
  expect((await run(build, directory, env)).exitCode).toBe(0);
  const { stdout, exitCode } = await run([outfile + (process.platform === "win32" ? ".exe" : "")], directory, env);
  return { said: said(stdout), exitCode };
}

describe.concurrent("--no-compile-function-source", () => {
  test.each([[[flag]], [[]]])("bun test --aot %p shows what the executable shows", async flags => {
    using directory = tempDir("aot-function-source", files);
    const expected = await runExecutable(String(directory), flags);
    expect(expected).toEqual({
      said: [expect.stringMatching(flags.length ? /^SAID (.*\[native code\]){3}/ : /^SAID function handler\(a\)/)],
      exitCode: 0,
    });
    expect(await runTest(String(directory), "file.test.js", ["--aot", ...flags])).toEqual(expected);
    expect(await runTest(String(directory), "in-place.test.js", ["--aot", ...flags])).toEqual(expected);
  });

  test("without --aot it changes nothing", async () => {
    using directory = tempDir("function-source", files);
    const expected = await runTest(String(directory), "file.test.js", []);
    expect(expected.said).toEqual([expect.stringMatching(/^SAID function handler\(a\)/)]);
    expect(await runTest(String(directory), "file.test.js", [flag])).toEqual(expected);
  });
});

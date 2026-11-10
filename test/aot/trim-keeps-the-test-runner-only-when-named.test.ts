// The test runner is a megabyte of an executable. Its entries are `Bun.jest`, "bun:test", "bun:test/vitest" and "node:test", and classes that hang under no name,
// so a program comes by it only where it names one of the four. As with Intl, Temporal and WebAssembly, --trim keeps it for no other reason.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { tempDirForAotBuilds } from "../bundler/compile-trim-features";
import { without } from "./harness/capabilities";
import { spawned } from "./harness/commands";
import { describe, test } from "./supported";

const testRunner = "bun:test and node:test (test)";

async function saysOfTestRunner(text: string) {
  using dir = tempDir("aot-trim-test-runner", { "main.ts": "// @ts-nocheck\n" + text });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.ts"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);
  return ["kept", "removed"].filter(word => stderr.includes(`\naot: trim: ${word} ${testRunner}:`));
}

describe.concurrent("the test runner stays only in a program that names it", () => {
  test.each([
    [
      // Native code that the table does not describe may make an object of any class, for all the compiler knows: not one of the test runner's.
      "a server of node:http",
      `import { createServer } from "node:http";\nconst server = createServer((request, response) => { response.end(request.url); });\nserver.listen(0, () => { console.log("ok"); server.close(); });`,
    ],
    ["a member of Bun under a key that is known only at run time", `console.log(typeof Bun[process.argv[2]]());`],
    ["a call under a computed key", `console.log(globalThis.input[process.argv[2]]());`],
    ["text that is evaluated", `console.log(new Function(process.argv[2])());`],
    ["a name in a comment", `// bun:test, node:test, Bun.jest\nconsole.log(1);`],
  ])("%s does not keep it", async (_, text) => {
    expect(await saysOfTestRunner(text)).toEqual(["removed"]);
  });

  test.each([
    ["an import of bun:test", `import { expect } from "bun:test";\nexpect(1).toBe(1);`],
    ["a require of bun:test", `require("bun:test").expect(1).toBe(1);`],
    ["an import of node:test", `import test from "node:test";\nconsole.log(typeof test);`],
    ["Bun.jest", `console.log(typeof Bun.jest(import.meta.path).expect);`],
  ])("%s keeps it", async (_, text) => {
    expect(await saysOfTestRunner(text)).toEqual(["kept"]);
  });
});

const underKeyFromRunTime = `const key = process.argv[2];
console.log(typeof Bun[key]);
try {
  console.log("answer:", typeof Bun[key](import.meta.path).expect);
} catch (error) {
  console.log("caught:", error.code, error.message.split(" ").slice(0, 5).join(" "));
}
`;
const named = `import { expect } from "bun:test";
expect({ a: [1, 2] }).toEqual({ a: [1, 2] });
try {
  expect(1).toBe(2);
} catch (error) {
  console.log("caught:", error.constructor.name);
}
console.log("held");
`;

describe.skipIf(!!without("a Bun that trims"))("in a trimmed executable", () => {
  async function shownBy(text: string, flags: string[], ...operands: string[]) {
    using dir = tempDirForAotBuilds("aot-trim-test-runner", { "main.mjs": text });
    const folder = String(dir);
    const build = [bunExe(), "build", "--compile", "--aot", ...flags, "main.mjs", "--outfile", "main"];
    expect(await spawned(build, folder, bunEnv)).toMatchObject({ exitCode: 0 });
    const { stdout, exitCode } = await spawned([join(folder, "main"), ...operands], folder, bunEnv);
    return { stdout, exitCode };
  }

  test("Bun.jest under a key from run time is still there, and the call says that it was removed", async () => {
    expect(await shownBy(underKeyFromRunTime, ["--trim"], "jest")).toEqual({
      stdout: "function\ncaught: ERR_FEATURE_REMOVED bun:test and node:test was removed\n",
      exitCode: 0,
    });
    expect(await shownBy(underKeyFromRunTime, [], "jest")).toEqual({
      stdout: "function\nanswer: function\n",
      exitCode: 0,
    });
  }, 600_000);

  test("a program that imports bun:test has its matchers", async () => {
    const shown = { stdout: "caught: Error\nheld\n", exitCode: 0 };
    expect(await shownBy(named, ["--trim"])).toEqual(shown);
    expect(await shownBy(named, [])).toEqual(shown);
  }, 600_000);
});

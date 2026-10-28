import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../aot/harness/run";
import { unsupported } from "../aot/run-programs";

const files = {
  "package.json": JSON.stringify({ name: "suite", type: "module" }),
  "a-patches.test.js": `import { beforeAll, expect, test } from "bun:test";
let refused;
beforeAll(() => {
  try {
    Headers.prototype.set = function () {};
  } catch (error) {
    refused = error;
  }
});
test("the setup swallowed the refusal", () => {
  expect(refused).toBeInstanceOf(TypeError);
});
test("the same change again, a delete, a prototype", () => {
  for (let i = 0; i < 3; i++) expect(() => patch()).toThrow(TypeError);
  expect(() => delete Headers.prototype.append).toThrow(TypeError);
  expect(() => Object.setPrototypeOf(Request.prototype, null)).toThrow(TypeError);
  Headers.prototype.get = Headers.prototype.get;
});
function patch() {
  Array.prototype.push = () => 0;
}
`,
  "b-later.test.js": `import { expect, test } from "bun:test";
test("a later file", () => {
  expect(new Headers({ a: "1" }).get("a")).toBe("1");
  expect(() => void (URL.prototype.toString = () => "")).toThrow(TypeError);
});
`,
  "c-clean.test.js": `import { expect, test } from "bun:test";
test("nothing is refused here", () => expect(1).toBe(1));
`,
};

async function bunTest(cwd: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], cwd, { ...bunEnv, NO_COLOR: "1" });
  return { output: stdout + stderr, exitCode };
}

test.skipIf(!!unsupported)(
  "bun test --aot names every refused change to a locked built-in, where it was made and which file ran",
  async () => {
    using dir = tempDir("aot-refused-changes", files);
    const { output, exitCode } = await bunTest(String(dir), "--aot");
    const lines = output.split("\n");
    const heading = lines.findIndex(line => line.includes("read-only built-ins"));
    expect(lines[heading]).toBe(
      "5 writes to read-only built-ins failed during this run, caught or not. Code that continued after one may have left its work half done:",
    );
    expect(lines.slice(heading + 1, heading + 6)).toEqual([
      expect.stringMatching(
        /^  Cannot assign to Headers\.prototype\.set, at a-patches\.test\.js:5:\d+, while a-patches\.test\.js ran$/,
      ),
      expect.stringMatching(
        /^  Cannot assign to Array\.prototype\.push, at a-patches\.test\.js:20:\d+, while a-patches\.test\.js ran$/,
      ),
      expect.stringMatching(
        /^  Cannot delete Headers\.prototype\.append, at a-patches\.test\.js:15:\d+, while a-patches\.test\.js ran$/,
      ),
      expect.stringMatching(
        /^  Cannot change the prototype of Request\.prototype, at a-patches\.test\.js:16:\d+, while a-patches\.test\.js ran$/,
      ),
      expect.stringMatching(
        /^  Cannot assign to URL\.prototype\.toString, at b-later\.test\.js:4:\d+, while b-later\.test\.js ran$/,
      ),
    ]);
    expect(output).toContain(" 4 pass");
    expect(exitCode).toBe(0);
  },
);

test.skipIf(!!unsupported)("a run in which nothing is refused says nothing", async () => {
  using dir = tempDir("aot-nothing-refused", {
    "package.json": files["package.json"],
    "c-clean.test.js": files["c-clean.test.js"],
  });
  const { output, exitCode } = await bunTest(String(dir), "--aot");
  expect(output).not.toContain("locked built-ins");
  expect(exitCode).toBe(0);
});

test("plain bun test says nothing of locks", async () => {
  using dir = tempDir("plain-refused-changes", files);
  const { output } = await bunTest(String(dir));
  expect(output).not.toContain("locked built-ins");
});

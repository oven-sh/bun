import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { unsupported } from "../aot/harness/commands";
import { run } from "../aot/harness/run";

// A test run opens what it sees a test replace: test/aot/tests-replace-members-of-built-ins.test.ts. What the language reads by itself stays read-only.
const files = {
  "package.json": JSON.stringify({ name: "suite", type: "module" }),
  "a-patches.test.js": `import { beforeAll, expect, test } from "bun:test";
let refused;
beforeAll(() => {
  try {
    Promise.prototype.then = function () {};
  } catch (error) {
    refused = error;
  }
});
test("the setup swallowed the refusal", () => {
  expect(refused).toBeInstanceOf(TypeError);
});
test("the same change again, a delete, a prototype", () => {
  for (let i = 0; i < 3; i++) expect(() => patch()).toThrow(TypeError);
  expect(() => delete Array.prototype.toString).toThrow(TypeError);
  expect(() => Object.setPrototypeOf(Request.prototype, null)).toThrow(TypeError);
  Headers.prototype.get = Headers.prototype.get;
});
function patch() {
  Object.prototype.valueOf = () => 0;
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

test.skipIf(!!unsupported)("bun test --aot warns of every write to a read-only built-in when it builds", async () => {
  using dir = tempDir("aot-refused-changes", files);
  const { output, exitCode } = await bunTest(String(dir), "--aot");
  const lines = output.split("\n");
  const places = lines.flatMap((line, index) =>
    line.startsWith("warn: TS100014: this assignment throws if it runs")
      ? [lines[index + 1].replace(/^.*[\\/]/, "")]
      : [],
  );
  expect(places.map(place => place.replace(/:\d+$/, ""))).toEqual([
    "a-patches.test.js:5",
    "a-patches.test.js:15",
    "a-patches.test.js:16",
    "a-patches.test.js:20",
    "b-later.test.js:4",
  ]);
  expect(output).toContain(" 4 pass");
  expect(exitCode).toBe(0);
});

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

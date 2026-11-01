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
    Promise.prototype[Symbol.toStringTag] = "patched";
  } catch (error) {
    refused = error;
  }
});
test("the setup swallowed the refusal", () => {
  expect(refused).toBeInstanceOf(TypeError);
});
test("the same change again, a delete, a prototype", () => {
  for (let i = 0; i < 3; i++) expect(() => patch()).toThrow(TypeError);
  expect(() => delete Array.prototype[Symbol.iterator]).toThrow(TypeError);
  expect(() => Object.setPrototypeOf(Request.prototype, null)).toThrow(TypeError);
  Headers.prototype.get = Headers.prototype.get;
});
function patch() {
  String.prototype[Symbol.iterator] = () => 0;
}
`,
  "b-later.test.js": `import { expect, test } from "bun:test";
test("a later file", () => {
  expect(new Headers({ a: "1" }).get("a")).toBe("1");
  expect(() => void (Headers.prototype[Symbol.toStringTag] = "")).toThrow(TypeError);
});
`,
  "c-clean.test.js": `import { expect, test } from "bun:test";
test("nothing is refused here", () => expect(1).toBe(1));
`,
  "d-unseen.test.js": `import { expect, test } from "bun:test";
const named = name => globalThis[["", name].join("")];
test("the build does not see whose members these are, and nobody hears of the refusals", () => {
  try { named("String").prototype[Symbol.iterator] = () => 0; } catch {}
  try { Reflect.defineProperty(named("Array").prototype, Symbol.iterator, { value: 1 }); } catch {}
  try { delete named("Map").prototype[Symbol.iterator]; } catch {}
  try { Object.setPrototypeOf(named("Request").prototype, null); } catch {}
  expect(1).toBe(1);
});
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
  expect(output).toContain(" 5 pass");
  expect(exitCode).toBe(0);
});

test.skipIf(!!unsupported).each([
  ["in one process", []],
  ["with workers", ["--parallel=2"]],
])(
  "bun test --aot names every refused change to a read-only built-in, where it was made and which file ran, %s",
  async (_, flags) => {
    using dir = tempDir("aot-refused-changes", files);
    const { output, exitCode } = await bunTest(String(dir), "--aot", ...flags);
    const lines = output.split("\n");
    const heading = lines.findIndex(line => line.includes("read-only built-ins"));
    expect(lines[heading]).toBe(
      "9 writes to read-only built-ins failed during this run, caught or not. Code that continued after one may have left its work half done:",
    );
    // Workers end their files in any order.
    expect(
      lines
        .slice(heading + 1, heading + 10)
        .map(line => line.replace(/:\d+, while/, ", while"))
        .sort(),
    ).toEqual([
      "  Cannot assign to Headers.prototype[Symbol(Symbol.toStringTag)], at b-later.test.js:4, while b-later.test.js ran",
      "  Cannot assign to Promise.prototype[Symbol(Symbol.toStringTag)], at a-patches.test.js:5, while a-patches.test.js ran",
      "  Cannot assign to String.prototype[Symbol(Symbol.iterator)], at a-patches.test.js:20, while a-patches.test.js ran",
      "  Cannot assign to String.prototype[Symbol(Symbol.iterator)], at d-unseen.test.js:4, while d-unseen.test.js ran",
      "  Cannot change the prototype of Request.prototype, at a-patches.test.js:16, while a-patches.test.js ran",
      "  Cannot change the prototype of Request.prototype, at d-unseen.test.js:7, while d-unseen.test.js ran",
      "  Cannot define Array.prototype[Symbol(Symbol.iterator)], at d-unseen.test.js:5, while d-unseen.test.js ran",
      "  Cannot delete Array.prototype[Symbol(Symbol.iterator)], at a-patches.test.js:15, while a-patches.test.js ran",
      "  Cannot delete Map.prototype[Symbol(Symbol.iterator)], at d-unseen.test.js:6, while d-unseen.test.js ran",
    ]);
    expect(output).toContain(" 5 pass");
    expect(exitCode).toBe(0);
  },
);

test.skipIf(!!unsupported)("a run in which nothing is refused says nothing", async () => {
  using dir = tempDir("aot-nothing-refused", {
    "package.json": files["package.json"],
    "c-clean.test.js": files["c-clean.test.js"],
  });
  const { output, exitCode } = await bunTest(String(dir), "--aot");
  expect(output).not.toContain("read-only built-ins");
  expect(exitCode).toBe(0);
});

test("plain bun test says nothing of locks", async () => {
  using dir = tempDir("plain-refused-changes", files);
  const { output } = await bunTest(String(dir));
  expect(output).not.toContain("read-only built-ins");
});

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A `[[test.projects]]` table scopes a preload to the files its `testMatch`
// selects. Each project runs in its own global, so a DOM registration in the
// "dom" project never reaches the server files.

const bunfig = `
[test]
preload = ["./base-preload.ts"]

[[test.projects]]
name = "dom"
testMatch = ["**/*.dom.test.ts"]
preload = ["./dom-preload.ts"]
`;

const basePreload = `
import { beforeAll, afterAll } from "bun:test";
const g = globalThis as any;
g.__baseEvals = (g.__baseEvals ?? 0) + 1;
console.log("base-preload", Bun.main.split(/[\\\\/]/).pop());
beforeAll(() => { g.__beforeAll = (g.__beforeAll ?? 0) + 1; });
afterAll(() => { console.log("base-afterAll", Bun.main.split(/[\\\\/]/).pop()); });
`;

const domPreload = `
(globalThis as any).window = { fake: true };
console.log("dom-preload", Bun.main.split(/[\\\\/]/).pop());
`;

// `beforeAllRuns` is the count the file expects. A serial run starts the
// preload-level beforeAll once per global. A --parallel worker wraps every
// file with it, so the parallel fixture passes 0 to skip the check.
function serverFile(name: string, beforeAllRuns = 1) {
  return `
import { test, expect } from "bun:test";
test(${JSON.stringify(name)}, () => {
  const g = globalThis as any;
  console.log("run", ${JSON.stringify(name)}, typeof g.window, g.__baseEvals, g.__beforeAll);
  expect(typeof g.window).toBe("undefined");
  expect(g.__baseEvals).toBe(1);
  if (${beforeAllRuns}) expect(g.__beforeAll).toBe(${beforeAllRuns});
});
`;
}

function domFile(name: string, beforeAllRuns = 1) {
  return `
import { test, expect } from "bun:test";
test(${JSON.stringify(name)}, () => {
  const g = globalThis as any;
  console.log("run", ${JSON.stringify(name)}, typeof g.window, g.__baseEvals, g.__beforeAll);
  expect(g.window).toEqual({ fake: true });
  expect(g.__baseEvals).toBe(1);
  if (${beforeAllRuns}) expect(g.__beforeAll).toBe(${beforeAllRuns});
});
`;
}

const files = {
  "bunfig.toml": bunfig,
  "base-preload.ts": basePreload,
  "dom-preload.ts": domPreload,
  "a.server.test.ts": serverFile("a.server"),
  "b.dom.test.ts": domFile("b.dom"),
  "c.server.test.ts": serverFile("c.server"),
  "d.dom.test.ts": domFile("d.dom"),
};

async function run(dir: string, args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

/** The "run <file> <typeof window>" lines, in order. */
function runs(stdout: string) {
  return stdout
    .split("\n")
    .filter(l => l.startsWith("run "))
    .map(l => l.split(" ").slice(1, 3).join(" "));
}

describe.concurrent("[[test.projects]]", () => {
  test("the project preload runs only for the files testMatch selects", async () => {
    using dir = tempDir("test-projects", files);
    const { stdout, stderr, exitCode } = await run(String(dir), []);

    // Files are grouped by project: the base group first, then "dom".
    expect(runs(stdout)).toEqual(["a.server undefined", "c.server undefined", "b.dom object", "d.dom object"]);
    // Each group is one fresh global: the base preload runs once per group
    // and the dom preload only in the dom group.
    expect(stdout.split("\n").filter(l => l.startsWith("base-preload"))).toEqual([
      "base-preload a.server.test.ts",
      "base-preload b.dom.test.ts",
    ]);
    expect(stdout.split("\n").filter(l => l.startsWith("dom-preload"))).toEqual(["dom-preload b.dom.test.ts"]);
    // The preload-level afterAll closes each group.
    expect(stdout.split("\n").filter(l => l.startsWith("base-afterAll"))).toEqual([
      "base-afterAll c.server.test.ts",
      "base-afterAll d.dom.test.ts",
    ]);
    expect(stderr).toContain("4 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("with --isolate, every file gets its base and project preloads", async () => {
    using dir = tempDir("test-projects-isolate", files);
    const { stdout, stderr, exitCode } = await run(String(dir), ["--isolate"]);

    expect(runs(stdout)).toEqual(["a.server undefined", "c.server undefined", "b.dom object", "d.dom object"]);
    expect(stdout.split("\n").filter(l => l.startsWith("base-preload")).length).toBe(4);
    expect(stdout.split("\n").filter(l => l.startsWith("dom-preload"))).toEqual([
      "dom-preload b.dom.test.ts",
      "dom-preload d.dom.test.ts",
    ]);
    expect(stderr).toContain("4 pass");
    expect(exitCode).toBe(0);
  });

  test("with --randomize, files stay grouped by project", async () => {
    using dir = tempDir("test-projects-randomize", files);
    const { stdout, stderr, exitCode } = await run(String(dir), ["--randomize", "--seed=7"]);

    const order = runs(stdout);
    expect(order.length).toBe(4);
    expect(order.slice(0, 2).sort()).toEqual(["a.server undefined", "c.server undefined"]);
    expect(order.slice(2).sort()).toEqual(["b.dom object", "d.dom object"]);
    expect(stderr).toContain("4 pass");
    expect(exitCode).toBe(0);
  });

  test("a --parallel worker swaps its global when the project changes", async () => {
    using dir = tempDir("test-projects-parallel", {
      ...files,
      "a.server.test.ts": serverFile("a.server", 0),
      "b.dom.test.ts": domFile("b.dom", 0),
      "c.server.test.ts": serverFile("c.server", 0),
      "d.dom.test.ts": domFile("d.dom", 0),
      "e.server.test.ts": serverFile("e.server", 0),
    });
    // Two workers own [a, c] and [e, b, d]. The second worker runs a server
    // file and then a dom file in the same process, without --isolate.
    const { stdout, stderr, exitCode } = await run(String(dir), ["--parallel=2", "--no-isolate"]);

    // Workers stream their output to the coordinator, which prints it on stderr.
    const order = runs(stdout + stderr);
    expect(order.sort()).toEqual([
      "a.server undefined",
      "b.dom object",
      "c.server undefined",
      "d.dom object",
      "e.server undefined",
    ]);
    expect(stderr).toContain("5 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("the first matching project wins and testMatch accepts a string", async () => {
    using dir = tempDir("test-projects-order", {
      "bunfig.toml": `
[[test.projects]]
name = "one"
testMatch = "**/*.both.test.ts"
preload = ["./one.ts"]

[[test.projects]]
name = "two"
testMatch = ["**/*.test.ts"]
preload = ["./two.ts"]
`,
      "one.ts": `(globalThis as any).project = "one";`,
      "two.ts": `(globalThis as any).project = "two";`,
      "x.both.test.ts": `
import { test, expect } from "bun:test";
test("x", () => { expect((globalThis as any).project).toBe("one"); });
`,
      "y.test.ts": `
import { test, expect } from "bun:test";
test("y", () => { expect((globalThis as any).project).toBe("two"); });
`,
    });
    const { stderr, exitCode } = await run(String(dir), []);
    expect(stderr).toContain("2 pass");
    expect(exitCode).toBe(0);
  });

  test("a project without a name or testMatch is a config error", async () => {
    using dir = tempDir("test-projects-invalid", {
      "bunfig.toml": `
[[test.projects]]
name = "dom"
`,
      "a.test.ts": `import { test } from "bun:test"; test("a", () => {});`,
    });
    const { stderr, exitCode } = await run(String(dir), []);
    expect(stderr).toContain('test.projects entry is missing "testMatch"');
    expect(exitCode).not.toBe(0);

    using dup = tempDir("test-projects-dup", {
      "bunfig.toml": `
[[test.projects]]
name = "dom"
testMatch = "**/*.a.test.ts"

[[test.projects]]
name = "dom"
testMatch = "**/*.b.test.ts"
`,
      "a.test.ts": `import { test } from "bun:test"; test("a", () => {});`,
    });
    const second = await run(String(dup), []);
    expect(second.stderr).toContain('test.projects name "dom" is used twice');
    expect(second.exitCode).not.toBe(0);
  });
});

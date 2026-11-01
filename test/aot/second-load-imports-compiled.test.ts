// Bites only in a build with assertions: a release build stored a null pointer in a slot that nobody reads, and answered rightly.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A file that is loaded under a query runs from its text. Loaded again behind vi.resetModules(), its second record takes the code of the first, and the engine then fills the
// places of its imports ahead of the run with the environments of the modules they come from. A compiled module has none: "ASSERTION FAILED: m_moduleEnvironment".
const files = {
  "node_modules/dep/package.json": `{ "name": "dep", "main": "index.js" }`,
  "node_modules/dep/index.js": `module.exports = { who: () => "real", extra: 1 };`,
  "node_modules/lib/package.json": `{ "name": "lib", "main": "index.js" }`,
  "node_modules/lib/index.js": `import dep from "dep"; export const who = () => dep.who(); export const extra = dep.extra;`,
  "query.test.js": `
    import { test, vi } from "vitest";
    vi.mock("dep", () => ({ default: { who: () => "mock" } }));
    test("query", async () => {
      const first = await import("lib/index.js?query");
      vi.resetModules();
      const second = await import("lib/index.js?query");
      vi.resetModules();
      const third = await import("lib/index.js?query");
      console.log(first.who(), second.who(), third.who(), String(third.extra), first === second, second === third);
    });`,
};

async function runTests(folder: string, flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "."], folder, {
    ...bunEnv,
    NO_COLOR: "1",
  });
  return { printed: stdout.replace(/^bun test .*\n/, ""), counts: stderr.match(/^ \d+ (pass|fail)$/gm), exitCode };
}

test.each([[[]], [["--isolate"]], [["--isolate=modules"]]] as [string[]][])(
  "the second load runs as under bun test: %j",
  async flags => {
    using dir = tempDir("second-load-imports-compiled", files);
    const plain = await runTests(String(dir), flags);
    expect(plain).toMatchObject({ counts: [" 1 pass", " 0 fail"], exitCode: 0 });
    expect(await runTests(String(dir), ["--aot", ...flags])).toEqual(plain);
  },
  240_000,
);

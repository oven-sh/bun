import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// require() of an ESM that is mid-evaluation (ancestor or self) must throw
// ERR_REQUIRE_CYCLE_MODULE like Node, not abort in CyclicModuleRecord::link
// and not silently return an empty namespace.
describe.concurrent("require(esm) while the target is mid-evaluation", () => {
  test("ESM→ESM→createRequire(ancestor) throws ERR_REQUIRE_CYCLE_MODULE", async () => {
    using dir = tempDir("require-esm-cycle", {
      "a.mjs": `import './b.mjs';
export const A = 1;
console.log("a done");
`,
      "b.mjs": `import { createRequire } from "node:module";
let got;
try { got = createRequire(import.meta.url)("./a.mjs"); }
catch (e) { got = { code: e.code, name: e.name, message: e.message }; }
console.log("b required a:", JSON.stringify(got));
`,
      "entry.mjs": `import { pathToFileURL } from "node:url";
await import(pathToFileURL("./a.mjs").href);
console.log("alive");
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.split("\n");
    expect({ lines, stderr, exitCode }).toEqual({
      lines: [expect.stringMatching(/^b required a: /), "a done", "alive", ""],
      stderr: "",
      exitCode: 0,
    });
    const got = JSON.parse(lines[0].slice("b required a: ".length));
    expect(got).toEqual({
      code: "ERR_REQUIRE_CYCLE_MODULE",
      name: "Error",
      message: expect.stringContaining("Cannot require() ES Module"),
    });
    expect(got.message).toContain("a.mjs");
    expect(got.message).toContain("in a cycle");
  });

  test("self-require from an ESM throws ERR_REQUIRE_CYCLE_MODULE", async () => {
    using dir = tempDir("require-esm-self-cycle", {
      "self.mjs": `import { createRequire } from "node:module";
let got;
try { got = createRequire(import.meta.url)("./self.mjs"); }
catch (e) { got = "!" + (e.code || e.name); }
console.log("self required:", typeof got === "object" ? JSON.stringify(got) : got);
export const S = 1;
`,
      "entry.mjs": `import { pathToFileURL } from "node:url";
await import(pathToFileURL("./self.mjs").href);
console.log("alive");
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "self required: !ERR_REQUIRE_CYCLE_MODULE\nalive\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("uncaught cycle error rejects the dynamic import and does not abort", async () => {
    using dir = tempDir("require-esm-cycle-uncaught", {
      "a.mjs": `import './b.mjs';
export const A = 1;
`,
      "b.mjs": `import { createRequire } from "node:module";
createRequire(import.meta.url)("./a.mjs");
`,
      "entry.mjs": `import { pathToFileURL } from "node:url";
try {
  await import(pathToFileURL("./a.mjs").href);
  console.log("should not reach");
} catch (e) {
  console.log("caught:", e.code || e.name);
}
console.log("alive");
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "caught: ERR_REQUIRE_CYCLE_MODULE\nalive\n",
      stderr: "",
      exitCode: 0,
    });
  });
});

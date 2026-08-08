import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Writing to an imported binding is a run-time TypeError per ECMA-262
// (SetMutableBinding on an immutable indirect binding), not an early error.
// The module must load and evaluate; only a reached write throws.
describe("assigning to an imported binding", () => {
  const mod = `export let x = 1;\nexport default 2;\n`;

  test.concurrent.each([
    ["simple assignment", `x = 5`],
    ["update expression", `x++`],
    ["compound assignment", `x += 1`],
    ["array destructuring", `[x] = [9]`],
    ["object destructuring", `({ x } = { x: 9 })`],
    ["for-of target", `for (x of [9]) {}`],
    ["default import", `d = 5`],
    ["namespace import", `ns = 5`],
    ["computed namespace property", `ns[k] = 5`],
  ])("is a run-time TypeError: %s", async (_name, write) => {
    using dir = tempDir("assign-to-import", {
      "m.mjs": mod,
      "entry.mjs": `
        import d, { x } from "./m.mjs";
        import * as ns from "./m.mjs";
        const k = "x";
        void d; void ns; void k;
        function never() { ${write} }
        void never;
        try { ${write} } catch (e) { console.log("threw:" + e.constructor.name) }
        console.log("ran:" + x);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("threw:TypeError\nran:1\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("unreached write does not throw", async () => {
    using dir = tempDir("assign-to-import-dead", {
      "m.mjs": mod,
      "entry.mjs": `
        import { x } from "./m.mjs";
        if (false) x = 5;
        function never() { x = 7 }
        void never;
        console.log("ran:" + x);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("ran:1\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent.each([
    ["direct binding", `import { x } from "./m.mjs"; x = 5;\n`, 'Cannot assign to import "x"'],
    [
      "computed namespace property",
      `import * as ns from "./m.mjs"; const k = "x"; ns[k] = 5;\n`,
      'Cannot assign to property on import "ns"',
    ],
    ["delete namespace property", `import * as ns from "./m.mjs"; delete ns.x;\n`, 'Cannot assign to import "x"'],
    [
      "delete string-index namespace property",
      `import * as ns from "./m.mjs"; delete ns["x"];\n`,
      'Cannot assign to import "x"',
    ],
    [
      "delete computed namespace property",
      `import * as ns from "./m.mjs"; const k = "x"; delete ns[k];\n`,
      'Cannot assign to property on import "ns"',
    ],
  ])("bun build still rejects it: %s", async (_name, entry, diagnostic) => {
    using dir = tempDir("assign-to-import-build", {
      "m.mjs": mod,
      "entry.mjs": entry,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "entry.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain(diagnostic);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });
});

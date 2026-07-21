import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/31401
// A digit-named module (e.g. `1.ts`) with an anonymous default function must emit a valid identifier.
describe.concurrent("issue 31401: anonymous default export from digit-named module", () => {
  test("run a digit-named module with an anonymous default function", async () => {
    using dir = tempDir("issue-31401-run", {
      "1.ts": `export default function () {}\nconsole.log("ok");\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "1.ts")],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("No identifiers allowed directly after numeric literal");
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"ok"`);
    expect(exitCode).toBe(0);
  });

  test("import a digit-named module with an anonymous default function", async () => {
    using dir = tempDir("issue-31401-import", {
      "9mod.ts": `export default function () {}\n`,
      "index.ts": `import f from "./9mod.ts";\nconsole.log(typeof f);\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "index.ts")],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("No identifiers allowed directly after numeric literal");
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"function"`);
    expect(exitCode).toBe(0);
  });

  test("bundled output uses a valid identifier for the generated default name", async () => {
    // `--no-bundle` now keeps the function anonymous, so check the bundled output
    // where convertStmtsForChunk still assigns the generated `_1_default` name.
    using dir = tempDir("issue-31401-bundle", {
      "1.ts": `export default function () {}\n`,
      "entry.ts": `import f from "./1.ts"; console.log(typeof f);\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", join(String(dir), "entry.ts")],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("No identifiers allowed directly after numeric literal");
    // Must be a valid identifier: the leading digit gets an underscore prefix.
    expect(normalizeBunSnapshot(stdout)).toContain("function _1_default() {}");
    expect(exitCode).toBe(0);
  });
});

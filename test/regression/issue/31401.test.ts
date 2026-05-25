import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/31401
//
// An anonymous `export default function () {}` gets an auto-generated name
// derived from the module filename (`<name>_default`). When the filename
// starts with a digit (e.g. `1.ts`), the transpile / `bun run` path (which
// does not run the renamer) emitted `function 1_default()` — an invalid
// identifier that JSC's lexer rejected with
// "No identifiers allowed directly after numeric literal".
// The generated name must be sanitized up-front (→ `_1_default`).
describe.concurrent("issue 31401: anonymous default export from digit-named module", () => {
  test("bun run a digit-named module with an anonymous default function", async () => {
    using dir = tempDir("issue-31401-run", {
      "1.ts": `export default function () {}\nconsole.log("ok");\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "1.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("No identifiers allowed directly after numeric literal");
    expect(stdout.replaceAll("\r\n", "\n")).toBe("ok\n");
    expect(exitCode).toBe(0);
  });

  test("import a digit-named module with an anonymous default function", async () => {
    using dir = tempDir("issue-31401-import", {
      "9mod.ts": `export default function () {}\n`,
      "index.ts": `import f from "./9mod.ts";\nconsole.log(typeof f);\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("No identifiers allowed directly after numeric literal");
    expect(stdout.replaceAll("\r\n", "\n")).toBe("function\n");
    expect(exitCode).toBe(0);
  });

  test("transpile-only output uses a valid identifier for the generated default name", async () => {
    using dir = tempDir("issue-31401-transpile", {
      "1.ts": `export default function () {}\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "1.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("No identifiers allowed directly after numeric literal");
    // Must be a valid identifier: the leading digit gets an underscore prefix.
    expect(stdout.replaceAll("\r\n", "\n")).toContain("export default function _1_default() {}");
    expect(exitCode).toBe(0);
  });
});

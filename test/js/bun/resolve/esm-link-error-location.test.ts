import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

// https://github.com/oven-sh/bun/issues/5582
// When a named import resolves to a module that does not export that name,
// the resulting SyntaxError previously named only the imported-from module,
// not the file that contains the failing import statement. In a large
// project that made the offending import impossible to locate.
describe("ESM link-time SyntaxError reports the importing file", () => {
  async function run(cwd: string, entry: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), entry],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("entry point imports a missing named export", async () => {
    using dir = tempDir("link-err-direct", {
      "dep.mjs": `export const b = 1;\n`,
      "index.mjs": `\n\nimport { a } from "./dep.mjs";\nconsole.log(a);\n`,
    });
    const { stderr, exitCode } = await run(String(dir), "index.mjs");
    expect(stderr).toContain("SyntaxError: Export named 'a' not found in module");
    expect(stderr).toContain("dep.mjs");
    const importer = path.join(String(dir), "index.mjs");
    expect(stderr).toContain(importer);
    expect(stderr).toMatch(/index\.mjs:3/);
    expect(exitCode).not.toBe(0);
  });

  test("indirect: the failing import is not in the entry point", async () => {
    using dir = tempDir("link-err-indirect", {
      "dep.mjs": `export const b = 1;\n`,
      "middle.mjs": `import { nope } from "./dep.mjs";\nexport const m = nope;\n`,
      "main.mjs": `import { m } from "./middle.mjs";\nconsole.log(m);\n`,
    });
    const { stderr, exitCode } = await run(String(dir), "main.mjs");
    expect(stderr).toContain("SyntaxError: Export named 'nope' not found in module");
    const importer = path.join(String(dir), "middle.mjs");
    expect(stderr).toContain(importer);
    expect(stderr).not.toContain(path.join(String(dir), "main.mjs") + ":");
    expect(exitCode).not.toBe(0);
  });

  test("dynamic import() rejection carries importer location on the error", async () => {
    using dir = tempDir("link-err-dynamic", {
      "dep.mjs": `export const b = 1;\n`,
      "importer.mjs": `import { gone } from "./dep.mjs";\nexport default gone;\n`,
      "main.mjs": `try {\n  await import("./importer.mjs");\n  console.log("UNREACHABLE");\n} catch (e) {\n  console.log("MSG:" + e.message);\n  console.log("URL:" + e.sourceURL);\n  console.log("LINE:" + (typeof e.line === "number" && e.line > 0 ? "set" : e.line));\n}\n`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "main.mjs");
    expect(stderr).toBe("");
    const importer = path.join(String(dir), "importer.mjs");
    expect({
      msg: stdout.match(/^MSG:(.*?not found in module)/m)?.[1],
      url: stdout.match(/^URL:(.*)$/m)?.[1],
      line: stdout.match(/^LINE:(.*)$/m)?.[1],
    }).toEqual({
      msg: "Export named 'gone' not found in module",
      url: importer,
      line: "set",
    });
    expect(exitCode).toBe(0);
  });
});

import { describe, expect, test } from "bun:test";
import { mkdirSync } from "fs";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
import { join } from "path";

describe.concurrent("run-cjs", () => {
  test("running a commonjs module works", async () => {
    const dir = tmpdirSync();
    mkdirSync(dir, { recursive: true });
    await Bun.write(join(dir, "index1.js"), "module.exports = 1; console.log('hello world');");
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "index1.js")],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
    });
    const stdout = await proc.stdout.text();
    expect(stdout).toEqual("hello world\n");
  });

  // Node resolves a .js file's module format from the nearest ancestor package.json's
  // "type" field; the presence of a "name" field is irrelevant. Previously the resolver
  // only recorded an enclosing package.json when it had a non-empty "name", so a nameless
  // {"type":"commonjs"} scope was skipped for files in a *subdirectory* of that scope and
  // the next-higher named ancestor's "type" was used instead.
  describe('nameless package.json "type" governs module format', () => {
    const cjsBody = `let x = 1;\nif (x === 2) return;\nconsole.log("cjs ok");\n`;

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

    const ok = { stdout: "cjs ok\n", stderr: "", exitCode: 0 };

    test('subdir: nameless {"type":"commonjs"} overrides outer named {"type":"module"}', async () => {
      using dir = tempDir("nameless-cjs-subdir", {
        "package.json": `{"name":"outer","type":"module"}`,
        "pkg/package.json": `{"type":"commonjs"}`,
        "pkg/sub/t.js": cjsBody,
      });
      expect(await run(join(String(dir), "pkg", "sub"), "t.js")).toEqual(ok);
    });

    test('subdir: nameless {"type":"commonjs"} with no named ancestor', async () => {
      using dir = tempDir("nameless-cjs-no-ancestor", {
        "pkg/package.json": `{"type":"commonjs"}`,
        "pkg/sub/t.js": cjsBody,
      });
      expect(await run(join(String(dir), "pkg", "sub"), "t.js")).toEqual(ok);
    });

    test('adjacent: nameless {"type":"commonjs"} overrides outer named {"type":"module"}', async () => {
      using dir = tempDir("nameless-cjs-adjacent", {
        "package.json": `{"name":"outer","type":"module"}`,
        "pkg/package.json": `{"type":"commonjs"}`,
        "pkg/t.js": cjsBody,
      });
      expect(await run(join(String(dir), "pkg"), "t.js")).toEqual(ok);
    });

    test('subdir: adding "name" to inner package.json (control)', async () => {
      using dir = tempDir("named-cjs-subdir", {
        "package.json": `{"name":"outer","type":"module"}`,
        "pkg/package.json": `{"name":"inner","type":"commonjs"}`,
        "pkg/sub/t.js": cjsBody,
      });
      expect(await run(join(String(dir), "pkg", "sub"), "t.js")).toEqual(ok);
    });
  });
});

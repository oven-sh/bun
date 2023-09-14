import { bunEnv, bunExe } from "harness";
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("bun build", () => {
  test("warnings dont return exit code 1", () => {
    const { stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "build", path.join(import.meta.dir, "./fixtures/jsx-warning/index.jsx")],
      env: bunEnv,
    });
    expect(exitCode).toBe(0);
    expect(stderr.toString("utf8")).toContain(
      'warn: "key" prop before a {...spread} is deprecated in JSX. Falling back to classic runtime.',
    );
  });

  test("generating a standalone binary in nested path, issue #4195", () => {
    function testCompile(outfile: string) {
      const { exitCode } = Bun.spawnSync({
        cmd: [
          bunExe(),
          "build",
          path.join(import.meta.dir, "./fixtures/trivial/index.js"),
          "--compile",
          "--outfile",
          outfile,
        ],
        env: bunEnv,
      });
      expect(exitCode).toBe(0);
    }
    function testExec(outfile: string) {
      const { exitCode } = Bun.spawnSync({
        cmd: [outfile],
      });
      expect(exitCode).toBe(0);
    }
    {
      const baseDir = `${tmpdir()}/bun-build-outfile-${Date.now()}`;
      const outfile = path.join(baseDir, "index.exe");
      testCompile(outfile);
      testExec(outfile);
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
    {
      const baseDir = `${tmpdir()}/bun-build-outfile2-${Date.now()}`;
      const outfile = path.join(baseDir, "b/u/n", "index.exe");
      testCompile(outfile);
      testExec(outfile);
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

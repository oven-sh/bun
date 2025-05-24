import { test, expect } from "bun:test";
import { spawn } from "bun";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bunExe, bunEnv, tmpdirSync } from "harness";

test("should properly transpile files with --no-bundle and --outdir flags", async () => {
  const outdir = tmpdirSync("issue-05206");

  const {
    exited,
    stdout: stdoutStream,
    stderr: stderrStream,
  } = spawn({
    cmd: [bunExe(), "build", "foo.fixture.ts", "bar.fixture.ts", "--no-bundle", "--outdir", outdir],
    env: bunEnv,
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    exited,
    new Response(stdoutStream).text(),
    new Response(stderrStream).text(),
  ]);

  expect({ exitCode, stdout, stderr }).toMatchObject({
    exitCode: 0,
    stderr: expect.not.stringMatching(/error|warn/i),
  });

  const fooPath = join(outdir, "foo.fixture.js");
  const barPath = join(outdir, "bar.fixture.js");

  expect(existsSync(fooPath)).toBe(true);
  expect(existsSync(barPath)).toBe(true);

  expect(readFileSync(fooPath, "utf8")).toContain("hello world");
  expect(readFileSync(barPath, "utf8")).toContain("foo bar baz");
});

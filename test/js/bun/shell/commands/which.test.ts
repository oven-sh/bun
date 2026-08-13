import { $ } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

test.skipIf(isWindows)("which with an absolute path at the platform path length limit reports not found", async () => {
  const fixture = /* ts */ `
    import { $ } from "bun";
    const max = process.platform === "linux" ? 4096 : 1024;
    const bin = "/" + Buffer.alloc(max - 1, "a").toString();
    const { exitCode, stdout } = await $\`which \${bin}\`.quiet().nothrow();
    const out = stdout.toString().replace(/^which: /, "");
    console.log(JSON.stringify({ exitCode, notFound: out === bin + " not found\\n" }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(JSON.parse(stdout.trim())).toEqual({ exitCode: 1, notFound: true });
  expect(exitCode).toBe(0);
});

test("a PATH entry with an interior null byte never matches", async () => {
  // The OS stops reading a path at its first NUL, so the candidate
  // `<execPath>\0zz/zz` used to be checked as `<execPath>`: `which` printed the
  // phantom path and running `zz` executed bun itself.
  const env = { PATH: `${bunExe()}\0zz` };

  const lookup = await $`which zz`.env(env).quiet().nothrow();
  expect({
    stdout: lookup.stdout.toString(),
    stderr: lookup.stderr.toString(),
    exitCode: lookup.exitCode,
  }).toEqual({ stdout: "which: zz not found\n", stderr: "", exitCode: 1 });

  const run = await $`zz --version`.env(env).quiet().nothrow();
  expect({
    stdout: run.stdout.toString(),
    stderr: run.stderr.toString(),
    exitCode: run.exitCode,
  }).toEqual({ stdout: "", stderr: "bun: command not found: zz\n", exitCode: 1 });
});

test("which rlly long", async () => {
  const longstr = "a".repeat(100000);
  expect(async () => await $`${longstr}`.throws(true)).toThrow();
});

test("which PATH rlly long", async () => {
  const longstr = "a".repeat(100000);
  expect(async () => await $`PATH=${longstr} slkdfjlsdkfj`.throws(true)).toThrow();
});

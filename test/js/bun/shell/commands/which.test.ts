import { $ } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync } from "node:fs";
import { join } from "node:path";

// Two directories each holding an executable of the same name. `which tool`
// must come from the $PATH directory and `which ./tool` from the shell's cwd,
// so the output shows which of the two inputs each lookup read.
const exe = isWindows ? "tool.exe" : "tool";
const searchTree = {
  [`path-dir/${exe}`]: "",
  [`cwd-dir/${exe}`]: "",
};

function searchDirs(dir: string) {
  const pathDir = join(dir, "path-dir");
  const cwdDir = join(dir, "cwd-dir");
  if (!isWindows) {
    chmodSync(join(pathDir, exe), 0o755);
    chmodSync(join(cwdDir, exe), 0o755);
  }
  return { pathDir, cwdDir, expected: `${join(pathDir, exe)}\n${join(cwdDir, exe)}\n` };
}

test.concurrent("which searches $PATH for bare names and the shell cwd for ./ names (captured stdout)", async () => {
  using dir = tempDir("which-captured", searchTree);
  const { pathDir, cwdDir, expected } = searchDirs(String(dir));

  const { stdout, exitCode } = await $`which tool ./tool`.env({ PATH: pathDir }).cwd(cwdDir).quiet().nothrow();
  expect(stdout.toString()).toBe(expected);
  expect(exitCode).toBe(0);
});

test.concurrent("which searches $PATH for bare names and the shell cwd for ./ names (streamed stdout)", async () => {
  using dir = tempDir("which-streamed", searchTree);
  const { pathDir, cwdDir, expected } = searchDirs(String(dir));

  // Without .quiet() the builtin writes to the process's stdout (the pipe
  // below), which is the one-argument-per-write path in the builtin.
  const fixture = /* ts */ `
    import { $ } from "bun";
    const { exitCode } = await $\`which tool ./tool\`.env({ PATH: ${JSON.stringify(pathDir)} }).cwd(${JSON.stringify(cwdDir)}).nothrow();
    process.exitCode = exitCode;
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe(expected);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

// `which` resolves through the same PATH as running the command does: a
// `PATH=... cmd` prefix, then the exported environment, then the process
// environment when the shell environment has no PATH at all.
test.concurrent("which honors a PATH= prefix assignment", async () => {
  using dir = tempDir("which-prefix", searchTree);
  const { pathDir } = searchDirs(String(dir));

  const { stdout, exitCode } = await $`PATH=${pathDir} which tool`
    .env({ ...bunEnv, PATH: "" })
    .quiet()
    .nothrow();
  expect(stdout.toString()).toBe(`${join(pathDir, exe)}\n`);
  expect(exitCode).toBe(0);
});

test.concurrent("which falls back to the process PATH when the shell environment has no PATH", async () => {
  using dir = tempDir("which-process-path", searchTree);
  const { pathDir } = searchDirs(String(dir));

  // Windows spells the variable `Path`, so drop every spelling before setting it.
  const fixture = /* ts */ `
    import { $ } from "bun";
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"));
    const { stdout, exitCode } = await $\`which tool\`.env(env).quiet().nothrow();
    console.log(JSON.stringify({ stdout: stdout.toString(), exitCode }));
  `;
  const env = Object.fromEntries(Object.entries(bunEnv).filter(([key]) => key.toLowerCase() !== "path"));
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: { ...env, PATH: pathDir },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({ stdout: `${join(pathDir, exe)}\n`, exitCode: 0 });
  expect(exitCode).toBe(0);
});

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

test("which rlly long", async () => {
  const longstr = "a".repeat(100000);
  expect(async () => await $`${longstr}`.throws(true)).toThrow();
});

test("which PATH rlly long", async () => {
  const longstr = "a".repeat(100000);
  expect(async () => await $`PATH=${longstr} slkdfjlsdkfj`.throws(true)).toThrow();
});

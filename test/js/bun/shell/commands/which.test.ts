import { $ } from "bun";
import { describe, expect, test } from "bun:test";
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
  // below) through an IOWriter instead of appending to a captured buffer.
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

test.skipIf(isWindows)("which with an absolute path at the platform path length limit reports not found", async () => {
  const fixture = /* ts */ `
    import { $ } from "bun";
    const max = process.platform === "linux" ? 4096 : 1024;
    const bin = "/" + Buffer.alloc(max - 1, "a").toString();
    const { exitCode, stdout } = await $\`which \${bin}\`.quiet().nothrow();
    console.log(JSON.stringify({ exitCode, notFound: stdout.toString() === bin + " not found\\n" }));
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

describe("which prints the same line for an unresolvable arg however stdout is collected", () => {
  const BUN = bunExe();
  const bogus = "bun_shell_which_test_bogus_command";
  const expected = `${Bun.which(BUN)}\n${bogus} not found\n`;

  test.concurrent(".quiet() (captured buffer)", async () => {
    const { stdout, exitCode } = await $`which ${BUN} ${bogus}`.env(bunEnv).quiet().nothrow();
    expect(stdout.toString()).toBe(expected);
    expect(exitCode).toBe(1);
  });

  test.concurrent(".text()", async () => {
    expect(await $`which ${BUN} ${bogus}`.env(bunEnv).nothrow().text()).toBe(expected);
  });

  test.concurrent("command substitution", async () => {
    const { stdout, exitCode } = await $`echo "$(which ${BUN} ${bogus})"`.env(bunEnv).quiet().nothrow();
    expect(stdout.toString()).toBe(expected);
    expect(exitCode).toBe(0);
  });

  test.concurrent("redirect into a Buffer", async () => {
    const buf = Buffer.alloc(expected.length + 64);
    const { exitCode } = await $`which ${BUN} ${bogus} > ${buf}`.env(bunEnv).quiet().nothrow();
    expect(buf.subarray(0, buf.indexOf(0)).toString()).toBe(expected);
    expect(exitCode).toBe(1);
  });

  test.concurrent("redirect into a file (written through an IOWriter)", async () => {
    using dir = tempDir("shell-which-redirect", {});
    const { exitCode } = await $`which ${BUN} ${bogus} > out.txt`.env(bunEnv).cwd(String(dir)).quiet().nothrow();
    expect(await Bun.file(join(String(dir), "out.txt")).text()).toBe(expected);
    expect(exitCode).toBe(1);
  });

  test.concurrent("only unresolvable args", async () => {
    const { stdout, exitCode } = await $`which ${bogus} ${bogus}2`.env(bunEnv).quiet().nothrow();
    expect(stdout.toString()).toBe(`${bogus} not found\n${bogus}2 not found\n`);
    expect(exitCode).toBe(1);
  });

  test.concurrent("no args", async () => {
    const { stdout, exitCode } = await $`which`.env(bunEnv).quiet().nothrow();
    expect(stdout.toString()).toBe("\n");
    expect(exitCode).toBe(1);
  });
});

describe("which echoes an arg that is not valid UTF-8 byte for byte", () => {
  // 0xff never occurs in UTF-8, so a lossy conversion would turn it into
  // U+FFFD (ef bf bd). The arg reaches `which` through command substitution
  // because a JS string cannot carry the raw byte.
  const arg = Buffer.from([0x6e, 0xff, 0x6d]);
  const expected = Buffer.concat([arg, Buffer.from(" not found\n")]).toString("hex");

  test.concurrent("captured buffer", async () => {
    using dir = tempDir("shell-which-bytes-captured", { "arg.bin": arg });
    const { stdout, exitCode } = await $`which $(cat arg.bin)`.env(bunEnv).cwd(String(dir)).quiet().nothrow();
    expect(stdout.toString("hex")).toBe(expected);
    expect(exitCode).toBe(1);
  });

  test.concurrent("redirect into a file (written through an IOWriter)", async () => {
    using dir = tempDir("shell-which-bytes-redirect", { "arg.bin": arg });
    const { exitCode } = await $`which $(cat arg.bin) > out.bin`.env(bunEnv).cwd(String(dir)).quiet().nothrow();
    expect(Buffer.from(await Bun.file(join(String(dir), "out.bin")).bytes()).toString("hex")).toBe(expected);
    expect(exitCode).toBe(1);
  });
});

import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync, existsSync } from "node:fs";
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

// stdout carries only resolved paths, so `P="$(which tool)"` is empty when the
// tool is missing. The not-found line is a diagnostic and goes to stderr. Each
// stream can be a captured buffer or an fd, so every pairing is covered.
describe("which writes the not-found line to stderr", () => {
  // The last arg is found. Exit code 1 then shows that an earlier miss
  // survives every wait for an IOWriter.
  const script = "which nope-a tool nope-b tool";
  const notFound = "which: nope-a not found\nwhich: nope-b not found\n";

  // `expected` maps "stdout", "stderr" and any redirect target to its content.
  const cases: [name: string, redirect: string, expected: (tool: string) => Record<string, string>][] = [
    ["stdout captured, stderr captured", "", tool => ({ stdout: `${tool}\n${tool}\n`, stderr: notFound })],
    [
      "stdout to a file, stderr captured",
      "> out.txt",
      tool => ({ stdout: "", stderr: notFound, "out.txt": `${tool}\n${tool}\n` }),
    ],
    [
      "stdout captured, stderr to a file",
      "2> err.txt",
      tool => ({ stdout: `${tool}\n${tool}\n`, stderr: "", "err.txt": notFound }),
    ],
    [
      "2>&1 keeps the lines in argument order",
      "2>&1",
      tool => ({ stdout: `which: nope-a not found\n${tool}\nwhich: nope-b not found\n${tool}\n`, stderr: "" }),
    ],
  ];

  test.concurrent.each(cases)("%s", async (_, redirect, expected) => {
    using dir = tempDir("which-not-found", searchTree);
    const { pathDir, cwdDir } = searchDirs(String(dir));
    const want = expected(join(pathDir, exe));

    const { stdout, stderr, exitCode } = await $`${{ raw: `${script} ${redirect}` }}`
      .env({ PATH: pathDir })
      .cwd(cwdDir)
      .quiet()
      .nothrow();
    const actual: Record<string, string> = { stdout: stdout.toString(), stderr: stderr.toString() };
    for (const name of Object.keys(want)) {
      actual[name] ??= await Bun.file(join(cwdDir, name)).text();
    }
    expect(actual).toEqual(want);
    expect(exitCode).toBe(1);
  });

  test.concurrent("stdout and stderr are both fds", async () => {
    using dir = tempDir("which-not-found-streamed", searchTree);
    const { pathDir, cwdDir } = searchDirs(String(dir));
    const tool = join(pathDir, exe);

    // Without .quiet() the builtin writes to the process's stdout and stderr
    // (the pipes below) through an IOWriter each.
    const fixture = /* ts */ `
      import { $ } from "bun";
      const { exitCode } = await $\`${script}\`.env({ PATH: ${JSON.stringify(pathDir)} }).cwd(${JSON.stringify(cwdDir)}).nothrow();
      process.exitCode = exitCode;
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: `${tool}\n${tool}\n`, stderr: notFound });
    expect(exitCode).toBe(1);
  });

  // The not-found line is best effort, like the diagnostics of `ls`.
  test.concurrent.skipIf(!existsSync("/dev/full"))(
    "a not-found line that cannot be written does not stop the listing",
    async () => {
      using dir = tempDir("which-not-found-full", searchTree);
      const { pathDir, cwdDir } = searchDirs(String(dir));
      const tool = join(pathDir, exe);

      const { stdout, stderr, exitCode } = await $`${{ raw: `${script} 2> /dev/full` }}`
        .env({ PATH: pathDir })
        .cwd(cwdDir)
        .quiet()
        .nothrow();
      expect({ stdout: stdout.toString(), stderr: stderr.toString() }).toEqual({
        stdout: `${tool}\n${tool}\n`,
        stderr: "",
      });
      expect(exitCode).toBe(1);
    },
  );

  test.concurrent("$(which missing) expands to an empty string", async () => {
    using dir = tempDir("which-not-found-subst", searchTree);
    const { pathDir, cwdDir } = searchDirs(String(dir));

    const { stdout, exitCode } = await $`P="$(which nope-a)"; echo "[$P]"`
      .env({ PATH: pathDir })
      .cwd(cwdDir)
      .quiet()
      .nothrow();
    expect(stdout.toString()).toBe("[]\n");
    expect(exitCode).toBe(0);
  });
});

test.skipIf(isWindows)("which with an absolute path at the platform path length limit reports not found", async () => {
  const fixture = /* ts */ `
    import { $ } from "bun";
    const max = process.platform === "linux" ? 4096 : 1024;
    const bin = "/" + Buffer.alloc(max - 1, "a").toString();
    const { exitCode, stdout, stderr } = await $\`which \${bin}\`.quiet().nothrow();
    const notFound = stderr.toString() === "which: " + bin + " not found\\n";
    console.log(JSON.stringify({ exitCode, stdout: stdout.toString(), notFound }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(JSON.parse(stdout.trim())).toEqual({ exitCode: 1, stdout: "", notFound: true });
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

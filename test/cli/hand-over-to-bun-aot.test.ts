import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync, copyFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// `bun` is built without the ahead-of-time compiler and `bun-aot` with it. The API does not hand over, so it tells them apart.
async function hasCompiler(): Promise<boolean> {
  using dir = tempDir("has-compiler", { "empty.ts": "export {};\n" });
  const result = await Bun.build({
    entrypoints: [join(String(dir), "empty.ts")],
    compile: { outfile: join(String(dir), "empty"), aot: true },
    throw: false,
  } as never);
  return !result.logs.some(log => String(log.message ?? log).includes("isn't available in this build of Bun"));
}

async function revisionOf(bun: string): Promise<string> {
  await using proc = Bun.spawn({ cmd: [bun, "--revision"], env: bunEnv, stdout: "pipe", stderr: "inherit" });
  const [stdout] = await Promise.all([proc.stdout.text(), proc.exited]);
  return stdout.trim();
}

// In place of bun-aot: it answers --revision as every Bun does, and then does what `script` says.
function writeStandIn(path: string, revision: string, script: string) {
  writeFileSync(path, `#!/bin/sh\nif [ "$1" = --revision ]; then echo "${revision}"; exit 0; fi\n${script}\n`);
  chmodSync(path, 0o755);
}

test.skipIf(isWindows)("a Bun without the compiler runs an --aot command in the bun-aot beside it", async () => {
  if (await hasCompiler()) return;

  using dir = tempDir("hand-over", { "hello.ts": "console.log(1);\n" });
  const bun = join(String(dir), "bun");
  copyFileSync(bunExe(), bun);
  chmodSync(bun, 0o755);
  writeStandIn(join(String(dir), "bun-aot"), await revisionOf(bun), 'echo "bun-aot: $*"\nexit 7');

  for (const command of [
    ["build", "--compile", "--aot", "hello.ts"],
    ["compile", "hello.ts"],
  ]) {
    await using proc = Bun.spawn({
      cmd: [bun, ...command],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: `bun-aot: ${command.join(" ")}\n`,
      stderr: "",
      exitCode: 7,
    });
  }
});

test.skipIf(isWindows)("bun-aot takes the place of the Bun that hands over: its pid, its signals", async () => {
  if (await hasCompiler()) return;

  using dir = tempDir("hand-over-in-place", { "hello.ts": "console.log(1);\n" });
  const bun = join(String(dir), "bun");
  copyFileSync(bunExe(), bun);
  chmodSync(bun, 0o755);
  writeStandIn(join(String(dir), "bun-aot"), await revisionOf(bun), "echo $$\nkill -TERM $$\nsleep 30");

  await using proc = Bun.spawn({
    cmd: [bun, "compile", "hello.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, signal: proc.signalCode }).toEqual({
    stdout: `${proc.pid}\n`,
    stderr: "",
    signal: "SIGTERM",
  });
});

test.skipIf(isWindows)("a bun-aot of another revision is named and not run", async () => {
  if (await hasCompiler()) return;

  using dir = tempDir("hand-over-another-revision", { "hello.ts": "console.log(1);\n" });
  const bun = join(String(dir), "bun");
  copyFileSync(bunExe(), bun);
  chmodSync(bun, 0o755);
  const revision = await revisionOf(bun);

  for (const [write, said] of [
    [
      (path: string) => writeStandIn(path, "0.0.0+000000000", "echo ran"),
      `bun-aot is Bun 0.0.0+000000000, and this is Bun ${revision}`,
    ],
    [
      (path: string) => {
        writeFileSync(path, "#!/bin/sh\necho ran\nexit 3\n");
        chmodSync(path, 0o755);
      },
      "bun-aot does not answer --revision",
    ],
  ] as const) {
    write(join(String(dir), "bun-aot"));
    await using proc = Bun.spawn({
      cmd: [bun, "compile", "hello.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr.split("\n", 1)[0]).toStartWith("error: ");
    expect({ stdout, said: stderr.split("\n", 1)[0].slice(-said.length), exitCode }).toEqual({
      stdout: "",
      said,
      exitCode: 1,
    });
  }
});

test("a Bun without the compiler that finds no bun-aot and cannot fetch one says so", async () => {
  if (await hasCompiler()) return;

  using dir = tempDir("hand-over-nothing-to-find", { "hello.ts": "console.log(1);\n" });
  const bun = join(String(dir), isWindows ? "bun.exe" : "bun");
  copyFileSync(bunExe(), bun);
  chmodSync(bun, 0o755);

  for (const command of [
    ["build", "--compile", "--aot", "hello.ts"],
    ["compile", "hello.ts"],
  ]) {
    await using proc = Bun.spawn({
      cmd: [bun, ...command],
      cwd: String(dir),
      env: {
        ...bunEnv,
        BUN_AOT_DISABLE_DOWNLOAD: undefined,
        // Nobody listens there, so nothing leaves the machine.
        BUN_COMPILE_TARGET_TARBALL_URL: "http://127.0.0.1:1/bun-aot.tgz",
        BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // It died here once, before it had a word to say.
    expect({ stdout, exitCode, signal: proc.signalCode, stderr: exitCode === 1 ? "" : stderr }).toEqual({
      stdout: "",
      exitCode: 1,
      signal: null,
      stderr: "",
    });
    expect(stderr).toMatch(/^error: Failed to download 'bun-aot-[^']+'/);
    expect(stderr).toContain("ahead-of-time compilation runs in ");
  }
});

// Every way to ask for the compiler. bunEnv forbids the download, so this is what the rest of the tests meet in a Bun without it.
test.skipIf(await hasCompiler())(
  "a Bun without the compiler that finds no bun-aot and may not fetch one says that it has none",
  async () => {
    using dir = tempDir("hand-over-nothing-to-fetch", {
      "hello.ts": "console.log(1);\n",
      "hello.test.ts": 'import { test } from "bun:test";\ntest("runs", () => {});\n',
      "build.ts": 'await Bun.build({ entrypoints: ["hello.ts"], compile: { outfile: "hello", aot: true } });\n',
    });
    const bun = join(String(dir), isWindows ? "bun.exe" : "bun");
    copyFileSync(bunExe(), bun);
    chmodSync(bun, 0o755);
    const files = readdirSync(String(dir)).sort();
    let requests = 0;
    using server = Bun.serve({
      port: 0,
      fetch() {
        requests++;
        return new Response(null, { status: 404 });
      },
    });

    for (const [subject, ...command] of [
      ["ahead-of-time compilation", "compile", "hello.ts"],
      ["--aot", "build", "--compile", "--aot", "hello.ts"],
      ["--aot", "run", "--aot", "hello.ts"],
      ["--aot", "test", "--aot"],
      ["--aot", "check", "--aot", "hello.ts"],
      ["compile.aot", "build.ts"],
    ]) {
      await using proc = Bun.spawn({
        cmd: [bun, ...command],
        cwd: String(dir),
        env: {
          ...bunEnv,
          BUN_AOT_DISABLE_DOWNLOAD: "1",
          BUN_COMPILE_TARGET_TARBALL_URL: new URL("bun-aot.tgz", server.url).href,
          BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"),
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({
        command: command.join(" "),
        stdout: stdout.replace(/^bun test v.*\n/, ""),
        said: stderr.split("\n", 1)[0],
        exitCode,
        signal: proc.signalCode,
        stderr: exitCode === 1 ? "" : stderr,
      }).toEqual({
        command: command.join(" "),
        stdout: "",
        said: `error: ${subject} isn't available in this build of Bun`,
        exitCode: 1,
        signal: null,
        stderr: "",
      });
    }
    expect({ requests, files: readdirSync(String(dir)).sort() }).toEqual({ requests: 0, files });
  },
);

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMusl, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// `bun` is built without the ahead-of-time compiler. Asked for it, it runs the command in `bun-aot`, which a release lays beside it.
// ./hand-over-to-bun-aot.test.ts puts a script in that place. Here both are real: CI lays the `bun-aot` of the same build beside
// the `bun` under test (--bun-aot-step of scripts/runner.node.ts). Most rows run a command in both and want the same of both.
const bunWithCompiler = join(dirname(bunExe()), isWindows ? "bun-aot.exe" : "bun-aot");

// The API does not hand over, so it tells the two apart.
async function hasCompiler(): Promise<boolean> {
  using dir = tempDir("has-compiler", { "empty.ts": "export {};\n" });
  const result = await Bun.build({
    entrypoints: [join(String(dir), "empty.ts")],
    compile: { outfile: join(String(dir), "empty"), aot: true },
    throw: false,
  } as never);
  return !result.logs.some(log => String(log.message ?? log).includes("isn't available in this build of Bun"));
}

const nothingToTry = (await hasCompiler())
  ? "this Bun has the compiler itself and hands nothing over"
  : existsSync(bunWithCompiler)
    ? undefined
    : `no bun-aot lies beside ${bunExe()}`;

interface Ran {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
}

async function run(cmd: string[], cwd: string, given: { stdin?: string; env?: Record<string, string> } = {}) {
  await using proc = Bun.spawn({
    cmd,
    cwd,
    // Nobody listens there, so nothing leaves the machine.
    env: { ...bunEnv, BUN_COMPILE_TARGET_TARBALL_URL: "http://127.0.0.1:1/bun.tgz", ...given.env },
    stdin: given.stdin === undefined ? "ignore" : new Blob([given.stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signal: proc.signalCode } satisfies Ran;
}

const withoutAmounts = (ran: Ran): Ran => {
  const plain = (text: string) =>
    text
      .replaceAll("\r\n", "\n")
      .replace(/\b\d+(\.\d+)?\s?(ns|us|µs|ms|s|B|KB|MB|GB)\b/g, "<amount>")
      // A time is padded to a width.
      .replace(/^ +(?=\[<amount>\])/gm, "");
  return { ...ran, stdout: plain(ran.stdout), stderr: plain(ran.stderr) };
};

/** The command in `bun`, which hands it over, and in `bun-aot` itself. */
async function inBoth(
  command: string[],
  cwd: string,
  given?: { stdin?: string; env?: Record<string, string>; saysItsNameTwice?: boolean },
) {
  const handedOver = withoutAmounts(await run([bunExe(), ...command], cwd, given));
  // TODO: `bun test` has printed its first line by the time it hands over, and `bun-aot` prints it again.
  if (given?.saysItsNameTwice) handedOver.stdout = handedOver.stdout.replace(/^(bun test v.*\n)\1/, "$1");
  const itself = withoutAmounts(await run([bunWithCompiler, ...command], cwd, given));
  expect(handedOver).toEqual(itself);
  return handedOver;
}

/** Builds with both into one name, one after the other, and runs what each has built. */
async function buildsInBoth(command: string[], cwd: string) {
  const outfile = join(cwd, isWindows ? "built.exe" : "built");
  const results: { built: Ran; ran: Ran | undefined }[] = [];
  for (const bun of [bunExe(), bunWithCompiler]) {
    const built = withoutAmounts(await run([bun, ...command, "--outfile", outfile], cwd));
    results.push({ built, ran: built.exitCode === 0 ? await run([outfile], cwd) : undefined });
  }
  expect(results[0]).toEqual(results[1]);
  return results[0];
}

const files = {
  "hello.ts": `const words: string[] = ["hello", "from", process.argv.slice(2).join("+") || "nobody"];\nconsole.log(words.join(" "));\n`,
  "defined.ts": `declare const GREETING: string;\nconsole.log(GREETING);\n`,
  "asked.ts": `
    console.log(JSON.stringify({ cwd: process.cwd(), given: process.env.GIVEN_BY_THE_CALLER, arguments: process.argv.slice(2) }));
    console.error("to stderr");
    console.log((await Bun.stdin.text()).toUpperCase());
    process.exit(7);
  `,
  "server.ts": `
    const server = Bun.serve({ port: 0, fetch: request => new Response("asked for " + new URL(request.url).pathname) });
    console.log(server.port);
  `,
  "waits.ts": `console.log(process.pid);\nsetInterval(() => {}, 1000);\n`,
  "dies.ts": `process.kill(process.pid, "SIGKILL");\nsetInterval(() => {}, 1000);\n`,
  "passes.test.ts": `import { expect, test } from "bun:test";\ntest("adds", () => expect(1 + 1).toBe(2));\n`,
  "failing/fails.test.ts": `import { expect, test } from "bun:test";\ntest("adds", () => expect(1 + 1).toBe(3));\n`,
  "wrong.ts": `const count: number = "three";\nconsole.log(count);\n`,
  "api.ts": `await Bun.build({ entrypoints: ["hello.ts"], compile: { outfile: "by-the-api", aot: true } });\n`,
};

if (nothingToTry) test.skip(`nothing is tried: ${nothingToTry}`, () => {});

describe.skipIf(!!nothingToTry)("bun hands over to the bun-aot beside it", () => {
  const limit = 240_000;

  test("the two are of one revision", async () => {
    using dir = tempDir("hand-over-revision", {});
    const [bun, withCompiler] = [
      await run([bunExe(), "--revision"], String(dir)),
      await run([bunWithCompiler, "--revision"], String(dir)),
    ];
    expect(withCompiler).toEqual(bun);
  });

  test(
    "bun build --compile --aot makes an executable that answers as plain Bun does",
    async () => {
      using dir = tempDir("hand-over-build", files);
      const { built, ran } = await buildsInBoth(["build", "--compile", "--aot", "hello.ts"], String(dir));
      expect({ exitCode: built.exitCode, signal: built.signal }).toEqual({ exitCode: 0, signal: null });
      expect(ran).toEqual(await run([bunExe(), "hello.ts"], String(dir)));
      expect(ran!.stdout).toBe("hello from nobody\n");
    },
    limit,
  );

  test(
    "bun compile does the same",
    async () => {
      using dir = tempDir("hand-over-compile", files);
      const { built, ran } = await buildsInBoth(["compile", "hello.ts"], String(dir));
      expect({ exitCode: built.exitCode, signal: built.signal }).toEqual({ exitCode: 0, signal: null });
      expect(ran!.stdout).toBe("hello from nobody\n");
    },
    limit,
  );

  test(
    "flags pass through: --define, --target of this machine, --trim",
    async () => {
      using dir = tempDir("hand-over-flags", files);
      const defined = await buildsInBoth(
        ["build", "--compile", "--aot", "--define", 'GREETING="defined"', "defined.ts"],
        String(dir),
      );
      expect(defined.ran?.stdout).toBe("defined\n");

      const os = isWindows ? "windows" : process.platform;
      const target = `bun-${os}-${process.arch}${isMusl ? "-musl" : ""}`;
      await buildsInBoth(["build", "--compile", "--aot", `--target=${target}`, "hello.ts"], String(dir));
      await buildsInBoth(["build", "--compile", "--aot", "--trim", "hello.ts"], String(dir));
    },
    limit,
  );

  test(
    "a server that was built this way answers a request",
    async () => {
      using dir = tempDir("hand-over-server", files);
      const outfile = join(String(dir), isWindows ? "server.exe" : "server");
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", "server.ts", "--outfile", outfile],
        String(dir),
      );
      expect({ exitCode: built.exitCode, signal: built.signal }).toEqual({ exitCode: 0, signal: null });
      await using server = Bun.spawn({
        cmd: [outfile],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });
      const { value } = await server.stdout.getReader().read();
      const port = Number(new TextDecoder().decode(value));
      expect(await (await fetch(`http://127.0.0.1:${port}/a/path`)).text()).toBe("asked for /a/path");
    },
    limit,
  );

  test(
    "bun run --aot: arguments, stdin, both outputs, the exit code, the working directory and the environment are the caller's",
    async () => {
      using dir = tempDir("hand-over-run", files);
      const given = { stdin: "typed in", env: { GIVEN_BY_THE_CALLER: "yes" } };
      const ran = await inBoth(["run", "--aot", "asked.ts", "one", "two words"], String(dir), given);
      const [first, second] = ran.stdout.split("\n");
      expect({ ...JSON.parse(first), cwd: undefined }).toEqual({
        cwd: undefined,
        given: "yes",
        arguments: ["one", "two words"],
      });
      expect({ second, stderr: ran.stderr, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
        second: "TYPED IN",
        stderr: "to stderr\n",
        exitCode: 7,
        signal: null,
      });
      expect(withoutAmounts(await run([bunExe(), "asked.ts", "one", "two words"], String(dir), given))).toEqual(ran);
    },
    limit,
  );

  test(
    "bun test --aot passes and fails as the tests do",
    async () => {
      using dir = tempDir("hand-over-test", files);
      expect(
        (await inBoth(["test", "--aot", "passes.test.ts"], String(dir), { saysItsNameTwice: true })).exitCode,
      ).toBe(0);
      expect((await inBoth(["test", "--aot"], join(String(dir), "failing"), { saysItsNameTwice: true })).exitCode).toBe(
        1,
      );
    },
    limit,
  );

  test(
    "bun check --aot reports what it finds",
    async () => {
      using dir = tempDir("hand-over-check", files);
      expect((await inBoth(["check", "--aot", "hello.ts"], String(dir))).exitCode).toBe(0);
      const wrong = await inBoth(["check", "--aot", "wrong.ts"], String(dir));
      expect(wrong.exitCode).toBe(1);
      expect(wrong.stdout + wrong.stderr).toContain("TS2322");
    },
    limit,
  );

  test("Bun.build() with compile.aot does not hand over", async () => {
    using dir = tempDir("hand-over-api", files);
    const ran = await run([bunExe(), "api.ts"], String(dir));
    expect({ said: ran.stderr.split("\n", 1)[0], exitCode: ran.exitCode, signal: ran.signal }).toEqual({
      said: "error: compile.aot isn't available in this build of Bun",
      exitCode: 1,
      signal: null,
    });
  });

  // TODO: `bun` waits for `bun-aot` as for any child. What ends the one does not end the other, and a signal comes back as exit code 1.
  test.todo("a signal that ends bun-aot is what bun ends with", async () => {
    using dir = tempDir("hand-over-dies", files);
    expect((await inBoth(["run", "--aot", "dies.ts"], String(dir))).signal).toBe("SIGKILL");
  });

  test.todo("a signal that is sent to bun ends the program", async () => {
    using dir = tempDir("hand-over-signal", files);
    const proc = Bun.spawn({
      cmd: [bunExe(), "run", "--aot", "waits.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const { value } = await proc.stdout.getReader().read();
    const pid = Number(new TextDecoder().decode(value));
    proc.kill("SIGTERM");
    await proc.exited;
    const isRunning = () => {
      try {
        return process.kill(pid, 0);
      } catch {
        return false;
      }
    };
    for (let turn = 0; turn < 50 && isRunning(); turn++) await Bun.sleep(100);
    const outlived = isRunning();
    if (outlived) process.kill(pid, "SIGKILL");
    expect(outlived).toBe(false);
  });

  test.todo("bun test --aot prints its first line once", async () => {
    using dir = tempDir("hand-over-test-once", files);
    await inBoth(["test", "--aot", "passes.test.ts"], String(dir));
  });

  // TODO: whatever has that name is run.
  test.todo("a bun-aot of another revision is refused by name and not run");
});

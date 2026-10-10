import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isPosix, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { createTestBuilder } from "./test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

describe.if(isPosix)("IOWriter epipe", () => {
  TestBuilder.command`yes | head`
    .exitCode(0)
    .stdout("y\ny\ny\ny\ny\ny\ny\ny\ny\ny\n")
    .runAsTest("builtin pipe to command");

  test("concurrent", async () => {
    const promises = Array(100)
      .fill(0)
      .map(() => Bun.$`yes | head`.text());

    const results = await Promise.all(promises);
    for (const result of results) {
      expect(result).toBe("y\ny\ny\ny\ny\ny\ny\ny\ny\ny\n");
    }
  });
});

function existing(dir: string, names: string[]): string[] {
  return names.filter(name => existsSync(join(dir, name)));
}

// The pipe between two stages of a pipeline is an IOWriter too. A stage loses
// its reader when the next stage exits without reading its stdin. `ls`,
// `mkdir -v` and `rm -v` queue one chunk per directory or operand, and finish
// only after every chunk they queued has completed or failed.
describe("pipeline stage whose reader exits without reading", () => {
  const names = Array.from({ length: 64 }, (_, i) => `entry${i}`);
  const operands = names.join(" ");
  const files = Object.fromEntries(names.map(name => [name, ""]));
  const tree = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`dir${i}`, {}]));

  async function run(dir: string, pipeline: string) {
    const { stdout, exitCode } = await $`${{ raw: pipeline }}`.cwd(dir).quiet().nothrow();
    return { stdout: stdout.toString(), exitCode };
  }

  test.concurrent("ls with several operands", async () => {
    using dir = tempDir("shell-pipe-ls", files);
    expect(await run(String(dir), `ls -d ${operands} | true`)).toEqual({ stdout: "", exitCode: 0 });
  });

  test.concurrent("mkdir -v with several operands", async () => {
    using dir = tempDir("shell-pipe-mkdir", {});
    expect(await run(String(dir), `mkdir -v ${operands} | true`)).toEqual({ stdout: "", exitCode: 0 });
    expect(existing(String(dir), names)).toEqual(names);
  });

  test.concurrent("rm -v with several operands", async () => {
    using dir = tempDir("shell-pipe-rm", files);
    expect(await run(String(dir), `rm -v ${operands} | true`)).toEqual({ stdout: "", exitCode: 0 });
    expect(existing(String(dir), names)).toEqual([]);
  });

  test.concurrent("ls -R into a builtin", async () => {
    using dir = tempDir("shell-pipe-ls-recursive", tree);
    expect(await run(String(dir), "ls -R . | true")).toEqual({ stdout: "", exitCode: 0 });
  });

  test.concurrent("ls -R into a stage in the middle", async () => {
    using dir = tempDir("shell-pipe-ls-recursive-middle", tree);
    expect(await run(String(dir), "ls -R . | true | cat")).toEqual({ stdout: "", exitCode: 0 });
  });

  test.concurrent.if(isPosix)("ls -R into a command that exits at once", async () => {
    using dir = tempDir("shell-pipe-ls-recursive-exit", tree);
    expect(await run(String(dir), "ls -R . | sh -c 'exit 0'")).toEqual({ stdout: "", exitCode: 0 });
  });

  // `head` exits after the first line, while ls still has chunks queued.
  test.concurrent.if(isPosix)("ls -R into head -n 1", async () => {
    using dir = tempDir("shell-pipe-ls-recursive-head", tree);
    const { stdout, exitCode } = await run(String(dir), "ls -R . | head -n 1");
    expect({ lines: stdout.split("\n").length - 1, exitCode }).toEqual({ lines: 1, exitCode: 0 });
  });

  // On Windows `cat` is a builtin. It finishes at its first failed chunk, so
  // the chunks queued behind that one must not complete into the finished
  // cat. That is a panic, so the pipeline runs in a child process.
  test.concurrent.if(isWindows)("cat with several chunks queued", async () => {
    using dir = tempDir("shell-pipe-cat", { "big.txt": Buffer.alloc(1024 * 1024, "a").toString() });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        "const { exitCode } = await Bun.$`cat big.txt | true`.quiet().nothrow(); console.log(exitCode);",
      ],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) console.error(stderr);
    expect({ stdout, exitCode, signalCode: proc.signalCode }).toEqual({ stdout: "0\n", exitCode: 0, signalCode: null });
  });
});

// The shell echoes command output to the process's stdout. Once nothing reads
// that stdout, every chunk of output a command queues fails with EPIPE, and the
// command still has to finish so that the awaited `$` settles.
describe.if(isPosix)("command output after the stdout reader went away", () => {
  const names = Array.from({ length: 16 }, (_, i) => `entry${i}`);

  async function expectFixtureToSettle(command: string, dir: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "epipe-fixture.ts"), command, ...names],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.stdout.cancel();
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stderr: "settled\n",
      exitCode: 0,
      signalCode: null,
    });
  }

  test.concurrent("ls with several arguments", async () => {
    using dir = tempDir("shell-epipe-ls", Object.fromEntries(names.map(name => [name, {}])));
    await expectFixtureToSettle("ls", String(dir));
  });

  test.concurrent("mkdir -v with several arguments", async () => {
    using dir = tempDir("shell-epipe-mkdir", {});
    await expectFixtureToSettle("mkdir", String(dir));
    expect(existing(String(dir), names)).toEqual(names);
  });

  test.concurrent("rm -v with several arguments", async () => {
    using dir = tempDir("shell-epipe-rm", {});
    await expectFixtureToSettle("rm", String(dir));
    expect(existing(String(dir), names)).toEqual([]);
  });

  // The relay of a subprocess's output stops at its first failed chunk and can
  // be freed right there, so its other queued chunks must not reach it.
  test.concurrent("relayed subprocess output", async () => {
    using dir = tempDir("shell-epipe-subprocess", {});
    await expectFixtureToSettle("subprocess", String(dir));
  });
});

// The builtin cat queues one chunk per read. It must not finish while one of
// them is still queued: the node is reused by the next command, which then
// receives the completions of those chunks.
describe("cat whose input ends while its output is still queued", () => {
  const size = 1024 * 1024;

  function spawnCat(dir: string) {
    return Bun.spawn({
      cmd: [bunExe(), "-e", "await Bun.$`cat fifo; echo tail`.nothrow(); console.error('settled');"],
      env: { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  // Lets cat write "first\n", so that its output has drained once. Then feeds it `size` bytes and
  // the end of its input while nothing reads its stdout.
  async function feed(dir: string, reader: ReadableStreamDefaultReader<Uint8Array>) {
    const received: Uint8Array[] = [];
    // "r+" does not wait for cat to open the other end.
    const input = await open(join(dir, "fifo"), "r+");
    try {
      await input.writeFile("first\n");
      while (Buffer.concat(received).length < "first\n".length) {
        const { value, done } = await reader.read();
        if (done) break;
        received.push(value);
      }
      expect(Buffer.concat(received).toString()).toBe("first\n");
      await input.writeFile(Buffer.alloc(size, "a"));
    } finally {
      await input.close();
    }
    return received;
  }

  // Linux only: on macOS the handshake in `feed` never completes and both tests time out in CI.
  test.concurrent.if(isLinux)("every byte is written before the next command runs", async () => {
    using dir = tempDir("shell-cat-fifo-read", {});
    expect(await Bun.spawn(["mkfifo", join(String(dir), "fifo")]).exited).toBe(0);
    await using proc = spawnCat(String(dir));
    const stderr = proc.stderr.text();
    const reader = proc.stdout.getReader();
    const received = await feed(String(dir), reader);
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received.push(value);
    }
    const stdout = Buffer.concat(received);
    expect({
      bytes: stdout.length,
      intact: stdout.equals(Buffer.concat([Buffer.from("first\n"), Buffer.alloc(size, "a"), Buffer.from("tail\n")])),
      stderr: await stderr,
      exitCode: await proc.exited,
    }).toEqual({ bytes: "first\n".length + size + "tail\n".length, intact: true, stderr: "settled\n", exitCode: 0 });
  });

  test.concurrent.if(isLinux)("the queued chunks fail when the stdout reader goes away", async () => {
    using dir = tempDir("shell-cat-fifo-close", {});
    expect(await Bun.spawn(["mkfifo", join(String(dir), "fifo")]).exited).toBe(0);
    await using proc = spawnCat(String(dir));
    const stderr = proc.stderr.text();
    const reader = proc.stdout.getReader();
    await feed(String(dir), reader);
    await reader.cancel();
    expect({ stderr: await stderr, exitCode: await proc.exited, signalCode: proc.signalCode }).toEqual({
      stderr: "settled\n",
      exitCode: 0,
      signalCode: null,
    });
  });

  // On Windows cat is a builtin, and a file this large is read in several chunks. A completion
  // for a chunk that cat left behind arrives after its pipeline settled, so the pipeline runs again.
  test.concurrent.if(isWindows)("every byte of a file reaches the next stage", async () => {
    using dir = tempDir("shell-cat-file", { "big.txt": Buffer.alloc(size, "a").toString() });
    const script = `
      const sizes = [];
      for (let run = 0; run < 5; run++) {
        await Bun.$\`cat big.txt | cat > out.txt\`.nothrow();
        sizes.push(Bun.file("out.txt").size);
      }
      console.log(JSON.stringify(sizes));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) console.error(stderr);
    expect({ stdout, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: JSON.stringify(Array(5).fill(size)) + "\n",
      exitCode: 0,
      signalCode: null,
    });
  });
});

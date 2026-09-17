import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import { existsSync } from "node:fs";
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
});

// The shell echoes command output to the process's stdout. Once nothing reads
// that stdout anymore, every chunk of output a command queues fails with
// EPIPE, and the command still has to finish so that the awaited `$` settles.
// A command with several chunks queued at that point used to be told about the
// failure once and then wait forever for the rest of them.
describe.if(isPosix)("command output after the stdout reader went away", () => {
  const names = Array.from({ length: 16 }, (_, i) => `entry${i}`);
  const args = names.join(" ");

  // The fixture keeps writing to its own stdout until that fails with EPIPE,
  // so the command only runs once the test has really closed the read end.
  //
  // The output is produced in the background (by one thread pool task per
  // argument, or by the subprocess). Blocking the main thread right after
  // starting the command lets all of it pile up, so that it is queued, and
  // fails, in one batch: the situation that used to hang. The fixed command
  // has to settle however the output ends up being batched, so nothing below
  // depends on the length of that pause.
  function fixture(command: string): string {
    return `
import { $ } from "bun";
import { writeSync } from "node:fs";
while (true) {
  try {
    writeSync(1, "still has a reader\\n");
  } catch (e) {
    if (e.code === "EPIPE") break;
    if (e.code !== "EAGAIN") throw e;
  }
  await Bun.sleep(1);
}
const running = $\`${command}\`.nothrow().run();
Bun.sleepSync(100);
await running;
console.error("settled");
`;
  }

  async function expectFixtureToSettle(dir: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.ts"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.stdout.cancel();
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("settled\n");
    expect(exitCode).toBe(0);
  }

  test.concurrent("ls with several arguments", async () => {
    using dir = tempDir("shell-epipe-ls", {
      "fixture.ts": fixture(`ls -d ${args}`),
      ...Object.fromEntries(names.map(name => [name, {}])),
    });
    await expectFixtureToSettle(String(dir));
  });

  test.concurrent("mkdir -v with several arguments", async () => {
    using dir = tempDir("shell-epipe-mkdir", { "fixture.ts": fixture(`mkdir -v ${args}`) });
    await expectFixtureToSettle(String(dir));
    expect(existing(String(dir), names)).toEqual(names);
  });

  test.concurrent("rm -v with several arguments", async () => {
    using dir = tempDir("shell-epipe-rm", {
      "fixture.ts": fixture(`rm -v ${args}`),
      ...Object.fromEntries(names.map(name => [name, ""])),
    });
    await expectFixtureToSettle(String(dir));
    expect(existing(String(dir), names)).toEqual([]);
  });

  // A subprocess's output is relayed to stdout through the same writer, one
  // chunk per read. The relay gives up at its first failed chunk and can be
  // freed along with the subprocess's pipe right there, so the chunks it still
  // had queued must not be reported to it afterwards.
  test.concurrent("relayed subprocess output", async () => {
    using dir = tempDir("shell-epipe-subprocess", { "fixture.ts": fixture("head -c 1048576 /dev/zero") });
    await expectFixtureToSettle(String(dir));
  });
});

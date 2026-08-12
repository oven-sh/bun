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

  function existing(dir: string): string[] {
    return names.filter(name => existsSync(join(dir, name)));
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
    expect(existing(String(dir))).toEqual(names);
  });

  test.concurrent("rm -v with several arguments", async () => {
    using dir = tempDir("shell-epipe-rm", {
      "fixture.ts": fixture(`rm -v ${args}`),
      ...Object.fromEntries(names.map(name => [name, ""])),
    });
    await expectFixtureToSettle(String(dir));
    expect(existing(String(dir))).toEqual([]);
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

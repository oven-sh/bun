import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
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

// `cmd < ${buffer}` finishes once three things have happened: the child exited,
// its stdout/stderr reached EOF, and the writer feeding it the buffer closed. A
// child that exits without reading fails that writer with EPIPE, and when that
// is the last of the three to be processed the command used to never finish,
// leaving the promise pending and the process alive.
//
// `sh` exits right away, but first hands its stdin to a background `sleep`, so
// the EPIPE can only be processed after the exit and the EOFs. (Without that
// the order depends on how fast the child dies, and the hang is intermittent.)
// The sleep's length is not observable from here: it only has to outlive bun's
// handling of the exit, which gives no outside signal. The buffer has to be
// larger than the stdin socketpair can hold (macOS gives it 512 KiB buffers),
// otherwise it drains, and closes stdin, before the child has even exited.
describe.if(isPosix)("buffer stdin whose child exits without reading it", () => {
  const exitWhileStdinStaysOpen = "exec 3<&0; sleep 0.5 <&3 >/dev/null 2>&1 & echo exiting; exit 7";

  async function runShellFixture(name: string, command: string) {
    using dir = tempDir(`shell-buffer-stdin-epipe-${name}`, {
      "fixture.ts": /* ts */ `
        import { $ } from "bun";
        // Hang guard: unref'd, so it only fires if something else (the stuck
        // command) is keeping the process alive.
        setTimeout(() => {
          console.log("the command is still pending");
          process.exit(1);
        }, 3_000).unref();
        const sh = ${JSON.stringify(exitWhileStdinStaysOpen)};
        const big = Buffer.alloc(8 * 1024 * 1024, "a");
        const { exitCode, stdout } = await ${command}.nothrow().quiet();
        console.log(JSON.stringify({ exitCode, stdout: stdout.toString() }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, signalCode: proc.signalCode };
  }

  test.concurrent("the command finishes with the child's exit code", async () => {
    expect(await runShellFixture("cmd", "$`/bin/sh -c ${sh} < ${big}`")).toEqual({
      stdout: JSON.stringify({ exitCode: 7, stdout: "exiting\n" }) + "\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test.concurrent("a pipeline the command is part of finishes", async () => {
    expect(await runShellFixture("pipeline", "$`/bin/sh -c ${sh} < ${big} | cat`")).toEqual({
      stdout: JSON.stringify({ exitCode: 0, stdout: "exiting\n" }) + "\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
});

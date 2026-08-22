import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix } from "harness";
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

// The shell relays an external command's output to the process's stdout while
// it captures it. Once nothing reads that stdout anymore, the relay fails with
// EPIPE. The command must still finish: the shell closes its end of the
// command's stdout, so the command's next write fails (the fixture's producer
// reports that and exits), instead of the shell reading the output into its
// capture buffer for as long as the command keeps writing. `$` used to never
// settle for such a command (the modes are described in the fixture).
describe("relayed output after the stdout reader went away", () => {
  const fixture = join(import.meta.dir, "epipe-relay-fixture.ts");

  async function runFixture(mode: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture, mode],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    // Drop the read end of the fixture's stdout. The fixture waits until its
    // own writes fail with EPIPE before it runs the command.
    await proc.stdout.cancel();
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const lastLine = stderr.trim().split("\n").at(-1)!;
    // On a crash this shows the whole stderr instead of a JSON parse error.
    const report = lastLine.startsWith("{") ? JSON.parse(lastLine) : stderr;
    expect(report).toEqual({ settled: true, exitCode: expect.any(Number) });
    // The producer itself exits 0: a failed relay fails the command. The exact
    // status (the errno today) is not pinned here.
    expect(report.exitCode).not.toBe(0);
    expect(exitCode).toBe(0);
    return stderr;
  }

  test.concurrent("the child keeps writing, its stderr is still relayed", async () => {
    const stderr = await runFixture("relay");
    expect(stderr).toContain("producer: stdout write failed");
  });

  test.concurrent("the child keeps writing, stdout is the only relayed stream", async () => {
    await runFixture("relay-only-stdout");
  });

  test.concurrent("the shell's writer is already dead when the child writes", async () => {
    const stderr = await runFixture("dead-writer");
    expect(stderr).toContain("producer: stdout write failed");
  });

  test.concurrent("the shell's writer is already dead, stdout is the only relayed stream", async () => {
    await runFixture("dead-writer-only-stdout");
  });

  test.concurrent("the child exits by itself", async () => {
    await runFixture("exits-by-itself");
  });
});

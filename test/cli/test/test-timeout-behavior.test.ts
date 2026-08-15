import { expect, test } from "bun:test";
import { bunEnv, bunExe, isFlaky, isLinux, tempDir } from "harness";
import path from "path";

if (isFlaky && isLinux) {
  test.todo("processes get killed");
} else {
  test.concurrent.each([true, false])(`processes get killed (sync: %p)`, async sync => {
    const { exited, stdout, stderr } = Bun.spawn({
      cmd: [
        bunExe(),
        "test",
        path.join(import.meta.dir, sync ? "process-kill-fixture-sync.ts" : "process-kill-fixture.ts"),
      ],
      stdout: "pipe",
      stderr: "pipe",
      stdin: "inherit",
      env: bunEnv,
    });
    const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
    // merge outputs so that this test still works if we change which things are printed to stdout
    // and which to stderr
    const combined = out + err;
    // exit code should indicate failed tests, not abort or anything
    expect(exitCode).toBe(1);
    expect(combined).not.toContain("This should not be printed!");
    expect(combined).toContain("killed 1 dangling process");
    // we should not expose the termination exception
    expect(combined).not.toContain("Unhandled error between tests");
    expect(combined).not.toContain("JavaScript execution terminated");
    // both tests should have run with the expected result
    expect(combined).toContain("(fail) test timeout kills dangling processes");
    expect(combined).toContain("(pass) slow test after test timeout");
  });
}

// Shared by the inline test files below. An echo child stays alive until it is
// killed, and `echo()` only gets its message back while the child is alive: a
// killed child never runs again, so its stdout just reports EOF.
const echoChildHelpers = /* ts */ `
  function spawnEcho() {
    return Bun.spawn({
      cmd: [process.execPath, "-e", "process.stdin.pipe(process.stdout)"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });
  }

  async function echo(child: ReturnType<typeof spawnEcho>, message: string) {
    child.stdin.write(message);
    await child.stdin.flush();
    const reader = child.stdout.getReader();
    let received = "";
    while (received.length < message.length) {
      const { value, done } = await reader.read();
      if (done) break;
      received += Buffer.from(value).toString();
    }
    reader.releaseLock();
    return received;
  }
`;

async function runTestFile(source: string, args: string[] = []) {
  using dir = tempDir("test-timeout-kill", { "kill.test.ts": echoChildHelpers + source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args, "./kill.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { combined: stdout + stderr, exitCode };
}

test.concurrent.each([[[]], [["--isolate"]]])(
  "a test timeout only kills the processes spawned by that test (args: %p)",
  async args => {
    const { combined, exitCode } = await runTestFile(
      /* ts */ `
        import { afterAll, beforeAll, expect, test } from "bun:test";

        const children: ReturnType<typeof spawnEcho>[] = [];
        afterAll(() => children.forEach(child => child.kill()));

        beforeAll(() => {
          children.push(spawnEcho());
        });

        test("spawns a child that outlives the test", () => {
          children.push(spawnEcho());
        });

        test("times out", async () => {
          children.push(spawnEcho());
          await new Promise(() => {});
        }, 100);

        test("children spawned by beforeAll and by an earlier test are still running", async () => {
          const [fromBeforeAll, fromEarlierTest] = children;
          expect(await Promise.all([echo(fromBeforeAll, "beforeAll"), echo(fromEarlierTest, "earlier test")])).toEqual([
            "beforeAll",
            "earlier test",
          ]);
        });
      `,
      args,
    );

    // Only the child of the test that timed out is killed.
    expect(combined).toContain("killed 1 dangling process");
    expect(combined).not.toContain("dangling processes");
    expect(combined).toContain("(pass) spawns a child that outlives the test");
    expect(combined).toContain("(fail) times out");
    expect(combined).toContain("(pass) children spawned by beforeAll and by an earlier test are still running");
    expect(combined).toContain(" 2 pass\n");
    expect(combined).toContain(" 1 fail\n");
    expect(exitCode).toBe(1);
  },
);

test.concurrent("a test without a timeout keeps its processes when an earlier test's timer fires", async () => {
  const { combined, exitCode } = await runTestFile(/* ts */ `
    import { expect, test } from "bun:test";

    // Arms a 50ms timer for this test. The runner never disarms it, so it fires
    // while the next test is running.
    test("finishes immediately", () => {}, 50);

    test("has no timeout and spawns a child", async () => {
      const child = spawnEcho();
      try {
        // Both timers live in the same heap and fire in deadline order, so the
        // first test's 50ms timer has fired by the time this sleep resolves.
        await Bun.sleep(250);
        expect(await echo(child, "still here")).toBe("still here");
      } finally {
        child.kill();
      }
    }, 0);
  `);

  expect(combined).not.toContain("dangling process");
  expect(combined).toContain("(pass) finishes immediately");
  expect(combined).toContain("(pass) has no timeout and spawns a child");
  expect(combined).toContain(" 2 pass\n");
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/14799
//
// A terminal Ctrl+C signals the whole foreground process group. Each `bun run`
// in a nested chain also forwards the signal to its child, so a runner in the
// middle of the chain receives SIGINT more than once (the terminal's delivery
// plus its parent's forward). The forwarding handler must be persistent so the
// second delivery does not fall through to SIG_DFL and kill the runner while
// the innermost script is still cleaning up.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";

test.skipIf(!isPosix)("nested bun run waits for the child on SIGINT", async () => {
  using dir = tempDir("issue-14799", {
    "package.json": JSON.stringify({
      name: "issue-14799",
      scripts: {
        outer: `${bunExe()} run inner`,
        inner: `${bunExe()} script.js`,
      },
    }),
    "script.js": `
      let done = 0;
      process.on("SIGINT", () => {
        if (done++) return;
        setTimeout(() => {
          console.log("cleanup done");
          process.exit(0);
        }, 500);
      });
      setInterval(() => {}, 1 << 30);
      console.log("ready " + process.pid);
    `,
  });

  // Start the chain in its own process group (detached => setsid) so a single
  // kill reaches every process, the same way the terminal driver delivers
  // Ctrl+C.
  await using outer = Bun.spawn({
    cmd: [bunExe(), "run", "outer"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });

  const stderrPromise = outer.stderr.text();
  const reader = outer.stdout.getReader();
  const decoder = new TextDecoder();
  let stdout = "";
  let innerPid = 0;
  while (!innerPid) {
    const { value, done } = await reader.read();
    if (done) break;
    stdout += decoder.decode(value, { stream: true });
    const m = stdout.match(/ready (\d+)/);
    if (m) innerPid = Number(m[1]);
  }
  expect(innerPid).toBeGreaterThan(0);

  // SIGINT to the whole process group (detached => outer.pid is the pgid).
  process.kill(-outer.pid, "SIGINT");

  const exitCode = await outer.exited;

  // With the bug, the middle runner is killed by the second SIGINT and the
  // outer runner returns immediately, while the innermost script is still in
  // its 500ms cleanup timer. With the fix, the outer runner only returns once
  // its child (and transitively the innermost script) has exited.
  let innerAlive: boolean;
  try {
    process.kill(innerPid, 0);
    innerAlive = true;
  } catch {
    innerAlive = false;
  }

  // The innermost script still holds the write end of the pipe, so stdout does
  // not EOF until its cleanup has run regardless of whether the outer runner
  // waited.
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    stdout += decoder.decode(value, { stream: true });
  }
  const stderr = await stderrPromise;

  // Best-effort: don't leak the inner process if it outlived the outer runner.
  try { process.kill(-outer.pid, "SIGKILL"); } catch {}

  expect(stderr).not.toContain("error");
  expect({
    stdout,
    innerAliveAfterOuterExit: innerAlive,
    exitCode,
    signalCode: outer.signalCode,
  }).toMatchObject({
    stdout: expect.stringContaining("cleanup done"),
    innerAliveAfterOuterExit: false,
    exitCode: 0,
    signalCode: null,
  });
});

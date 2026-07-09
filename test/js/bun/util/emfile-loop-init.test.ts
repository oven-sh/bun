// The first fetch() and the first new Worker() lazily create a per-thread
// uSockets event loop (epoll_create1 + timerfd_create + eventfd on Linux,
// kqueue on macOS). Under fd exhaustion those syscalls fail with EMFILE. The
// process must not abort: the one operation should fail and, once fds are
// freed, a retry should succeed.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix } from "harness";

const fixture = /* js */ `
  import * as fs from "node:fs";
  const held = [];
  for (;;) { try { held.push(fs.openSync("/dev/null", "r")); } catch { break; } }
  // First use of the lazily-created HTTP-client event loop: must reject, not abort.
  await fetch("http://127.0.0.1:1/").then(
    () => { console.error("UNEXPECTED: fetch resolved"); process.exit(1); },
    e => console.error("rejected:", e?.code ?? String(e)),
  );
  for (const fd of held) fs.closeSync(fd);
  // With fds freed, the HTTP thread's loop should come up and a retry should
  // reach a normal connect failure (ECONNREFUSED to 127.0.0.1:1), not abort.
  await fetch("http://127.0.0.1:1/").then(
    () => console.error("retry resolved"),
    e => console.error("retry rejected:", e?.code ?? String(e)),
  );
  console.error("SURVIVED");
`;

const workerFixture = /* js */ `
  import * as fs from "node:fs";
  import * as os from "node:os";
  const W = os.tmpdir() + "/w-" + process.pid + ".mjs";
  fs.writeFileSync(W, "postMessage(42)\\n");
  // Warm lazy builtin loads (debug builds read internal:fixed_queue from disk
  // on the first nextTick, which new Worker()'s close-event dispatch triggers).
  process.nextTick(() => {});
  const held = [];
  for (;;) { try { held.push(fs.openSync("/dev/null", "r")); } catch { break; } }
  await new Promise(resolve => {
    const w = new Worker(W);
    w.onerror = ev => { console.error("worker error:", ev?.message ?? "error"); resolve(); };
    w.onmessage = () => { console.error("UNEXPECTED: worker message"); resolve(); };
  });
  for (const fd of held) fs.closeSync(fd);
  console.error("SURVIVED");
`;

describe.skipIf(!isPosix)("lazy event-loop creation under EMFILE", () => {
  test.concurrent("first fetch() rejects instead of aborting the process", async () => {
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", `ulimit -n 512 && exec "$1" --no-install -e "$2"`, "sh", bunExe(), fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "",
      stderr: expect.stringContaining("SURVIVED"),
      exitCode: 0,
    });
    expect(stderr).toContain("rejected:");
    expect(stderr).toContain("retry rejected:");
  });

  test.concurrent("first new Worker() fires an error event instead of aborting the process", async () => {
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", `ulimit -n 512 && exec "$1" --no-install -e "$2"`, "sh", bunExe(), workerFixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "",
      stderr: expect.stringContaining("SURVIVED"),
      exitCode: 0,
    });
    expect(stderr).toContain("worker error:");
  });
});

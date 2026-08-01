import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A promise that can never settle used to make wait_for_promise() spin at
// 100% CPU forever. Now the event loop notices nothing can settle it and the
// matcher fails with a "still pending" error.
test("never-settling promises in expect fail instead of hanging", async () => {
  using dir = tempDir("expect-pending", {
    "pending.test.ts": `
      import { test, expect } from "bun:test";

      expect.extend({
        async neverSettles() {
          await new Promise(() => {});
          return { pass: true, message: () => "" };
        },
      });

      test("resolves on a never-settling promise", async () => {
        await expect(new Promise(() => {})).resolves.toBe(1);
      });

      test("toThrow on an async fn that never settles", async () => {
        await expect(async () => {
          await new Promise(() => {});
        }).toThrow();
      });

      test("custom async matcher that never settles", async () => {
        await expect(1).neverSettles();
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "pending.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  // Deadline instead of awaiting exit: on a build without the fix the
  // subprocess spins forever and nothing would ever settle proc.exited.
  const exited = await Promise.race([proc.exited, Bun.sleep(15_000).then(() => "hung" as const)]);
  if (exited === "hung") proc.kill(9);
  expect(exited).not.toBe("hung");

  const stderr = await proc.stderr.text();
  expect(stderr).toContain("Received promise that is still pending: the event loop drained before it settled");
  expect(stderr).toContain("Promise is still pending: the event loop drained before it settled");
  expect(stderr).toContain(
    "Matcher `neverSettles` returned a promise that is still pending: the event loop drained before it settled",
  );
  expect(stderr).toContain("0 pass");
  expect(stderr).toContain("3 fail");
});

// An unhandled rejection in an earlier test must not make a later I/O-bound
// expect().resolves bail out before the I/O completes: "could this promise
// still settle" is judged by outstanding work, not by is_event_loop_alive(),
// whose unhandled-error check encodes exit semantics.
test("expect().resolves still waits for I/O after an earlier unhandled rejection", async () => {
  using dir = tempDir("expect-pending-cascade", {
    "cascade.test.ts": `
      import { test, expect } from "bun:test";

      test("A", () => {
        Promise.reject(new Error("deliberate unhandled rejection"));
      });

      test("B", async () => {
        await using server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
        await expect(fetch(server.url).then(r => r.text())).resolves.toBe("ok");
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "cascade.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  // A fails (unhandled rejection), B must still pass.
  expect(stderr).not.toContain("still pending");
  expect(stderr).toContain("(pass) B");
  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("1 fail");
  expect(exitCode).toBe(1);
});

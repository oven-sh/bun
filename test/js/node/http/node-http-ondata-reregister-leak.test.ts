import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// NodeHTTPResponse.setOnData used to take an unbalanced `this.ref()` and re-acquire the
// `body_read_ref` event-loop keep-alive when JS cleared and then re-assigned `ondata`
// after the request body had finished. No code path released either ref, so the
// NodeHTTPResponse leaked and `vm.active_tasks` never reached zero — the process hung.
test("re-registering ondata after request body completes does not leak NodeHTTPResponse", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "node-http-ondata-reregister-leak.fixture.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("CLOSED");
  expect(exitCode).toBe(0);
}, 30_000);

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// _http_agent.createSocket wraps its connect callback with the internal once()
// helper. Before this fix once() never cleared its `callback` slot, so a
// reference to the wrapper transitively pinned onSocketCreated.bind(this, req)
// and the ClientRequest with it. JSC's conservative root scan occasionally
// kept that wrapper alive via a stale stack word, which made Node's upstream
// test-gc-http-client* tests hang on some CI lanes. The fixture holds the
// wrapper explicitly so the retention is deterministic.
test("http.ClientRequest is collectable while the agent's once() connect wrapper is still reachable", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--expose-gc", path.join(import.meta.dir, "node-http-client-request-gc-fixture.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("collected 4/4");
  expect(exitCode).toBe(0);
});

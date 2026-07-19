import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// once() must drop its callback after firing so a held wrapper cannot pin
// onSocketCreated.bind(this, req) and the ClientRequest with it.
test("http.ClientRequest is collectable while the agent's once() connect wrapper is still reachable", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--expose-gc", path.join(import.meta.dir, "node-http-client-request-gc-fixture.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: "collected 4/4 holding 4 wrappers",
    stderr: "",
    exitCode: 0,
  });
});

// Deterministic twin of test/js/node/test/parallel/test-http-client-leaky-with-double-response.js.
// That upstream file depends on a single FinalizationRegistry delivery, which
// JSC's conservative GC cannot guarantee; see test/expectations.txt.
test("http.ClientRequest is collectable after the server sends a second response on a kept-alive socket", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "node-http-client-double-response-gc-fixture.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toMatch(/^collected [678]\/8$/);
  expect(exitCode).toBe(0);
});

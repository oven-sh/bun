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

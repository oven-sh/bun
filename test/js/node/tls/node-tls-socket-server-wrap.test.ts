// Standalone server-side TLSSocket wraps: `new tls.TLSSocket(socket, { isServer: true })`.
// https://github.com/oven-sh/bun/issues/33954
//
// The scenarios live in node-tls-socket-server-wrap-fixture.mjs, written with
// node:test so the identical file runs under both runtimes.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe } from "harness";
import { join } from "path";

const fixture = join(import.meta.dir, "node-tls-socket-server-wrap-fixture.mjs");

test.each([
  ["bun", () => [bunExe(), "test", fixture]],
  ["node", () => [nodeExe() || "node", "--test", fixture]],
])("standalone server-side TLSSocket wrap scenarios pass under %s", async (_runtime, cmd) => {
  await using proc = Bun.spawn({
    cmd: cmd(),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
});

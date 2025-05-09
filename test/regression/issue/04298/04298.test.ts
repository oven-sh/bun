import { spawn } from "bun";
import { test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("node:http should not crash when server throws, and should abruptly close the socket", async () => {
  const { promise: urlPromise, resolve: resolveUrl, reject: rejectUrl } = Promise.withResolvers();
  const { promise: serverPromise, resolve: resolveServer, reject: rejectServer } = Promise.withResolvers();
  await using server = spawn({
    cwd: import.meta.dirname,
    cmd: [bunExe(), "04298.fixture.js"],
    env: bunEnv,
    stderr: "inherit",
    ipc(url) {
      resolveUrl(url);
    },
    onExit(subprocess, exitCode) {
      if (exitCode !== 0) {
        const err = new Error(`process exited with code ${exitCode}`);
        rejectUrl(err);
        rejectServer(err);
      } else {
        resolveServer();
      }
    },
  });
  const url = await urlPromise;
  // we dont wanna to error out ECONNRESET here, we just care about the exit code
  await fetch(url).catch(() => {});
  await serverPromise;
});

import { test, expect } from "bun:test";
import { spawn } from "bun";
import { bunExe, bunEnv } from "harness";

test("node:http should not crash when server throws", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  await using server = spawn({
    cwd: import.meta.dirname,
    cmd: [bunExe(), "04298.fixture.js"],
    env: bunEnv,
    stderr: "pipe",
    ipc(url) {
      resolve(url);
    },
    onExit(exitCode, signalCode) {
      if (signalCode || exitCode !== 0) {
        reject(new Error(`process exited with code ${signalCode || exitCode}`));
      }
    },
  });
  const url = await promise;
  const response = await fetch(url);
  expect(response.status).toBe(500);
});

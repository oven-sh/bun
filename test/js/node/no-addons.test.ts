import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunExe, bunEnv as env } from "harness";

test("--no-addons throws an error on process.dlopen", () => {
  const { stdout, stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "--no-addons", "-p", "process.dlopen()"],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const err = stderr.toString();
  const out = stdout.toString();
  expect(exitCode).toBe(1);
  expect(out).toBeEmpty();
  expect(err).toContain("\nerror: Cannot load native addon because loading addons is disabled.");
});

async function dlopenInWorker(execArgv: string[]): Promise<any> {
  const worker = new Worker(new URL("./no-addons-worker-fixture.js", import.meta.url).href, {
    execArgv,
  });
  const { promise, resolve, reject } = Promise.withResolvers<any>();
  worker.onerror = reject;
  worker.onmessage = e => resolve(e.data);
  worker.postMessage("go");
  try {
    return await promise;
  } finally {
    worker.terminate();
  }
}

test("worker execArgv --no-addons disables process.dlopen inside the worker", async () => {
  expect(await dlopenInWorker(["--no-addons"])).toEqual({
    execArgv: ["--no-addons"],
    error: "Cannot load native addon because loading addons is disabled.",
  });
});

test("worker without --no-addons can call process.dlopen", async () => {
  const result = await dlopenInWorker([]);
  // dlopen ran: it fails because the path doesn't exist, not because addons
  // are disabled for the worker.
  expect(result.execArgv).toEqual([]);
  expect(result.error).not.toBeNull();
  expect(result.error).not.toContain("loading addons is disabled");
});

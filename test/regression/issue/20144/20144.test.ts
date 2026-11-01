import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { spawn } from "node:child_process";

it.skipIf(process.platform === "win32")("should not time out", async () => {
  // https://github.com/oven-sh/bun/issues/20144: after cc(), SIGINT must still
  // break a tight loop. The spawn timeout is only a last-resort kill switch for
  // a true hang; 20s matches other hang-guard tests and avoids racing startup.
  const child = spawn(bunExe(), ["run", "./20144.fixture.ts"], {
    cwd: __dirname,
    env: bunEnv,
    stdio: [null, "inherit", "inherit", "ipc"],
    timeout: 20_000,
    killSignal: "SIGKILL",
  });

  const { promise, resolve, reject } = Promise.withResolvers<{ code: number | null; signal: string | null }>();
  child.on("error", reject);
  child.on("exit", (code, signal) => resolve({ code, signal }));

  let gotReady = false;
  child.on("message", message => {
    if (message == "hej") {
      gotReady = true;
      process.kill(child.pid!, "SIGINT");
    }
  });

  expect(await promise).toEqual({ code: null, signal: "SIGINT" });
  expect(gotReady).toBe(true);
});

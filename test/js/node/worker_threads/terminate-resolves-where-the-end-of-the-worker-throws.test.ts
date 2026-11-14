import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("terminate() resolves where a function that the end of the worker calls has been replaced by one that throws", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { Worker } = require("node:worker_threads");
        process.on("uncaughtException", () => {});
        const worker = new Worker("setInterval(() => {}, 1000)", { eval: true });
        worker.on("online", async () => {
          URL.revokeObjectURL = () => {
            throw new Error("thrown by the replacement");
          };
          const { promise: late, resolve } = Promise.withResolvers();
          const timer = setTimeout(resolve, 5000, "never");
          console.log(await Promise.race([worker.terminate().then(() => "terminated"), late]));
          clearTimeout(timer);
          process.exit(0);
        });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({ stdout: "terminated\n", stderr: "" });
  expect(exitCode).toBe(0);
});

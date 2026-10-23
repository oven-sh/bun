import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("loading node:quic adds no property to Blob.prototype", async () => {
  await using child = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      process.on("warning", () => {});
      const before = Reflect.ownKeys(Blob.prototype).map(String).join();
      require("node:quic");
      console.log(Reflect.ownKeys(Blob.prototype).map(String).join() === before);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: "true\n", exitCode: 0 });
});

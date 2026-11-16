import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("fs.createReadStream() works where fs.promises was replaced before the first stream", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const fs = require("node:fs");
        Object.defineProperty(fs, "promises", { value: { made: "up" }, configurable: true, writable: true, enumerable: true });
        const stream = fs.createReadStream(process.execPath);
        stream.on("error", error => console.log("error", error.code || error.name));
        stream.on("open", () => {
          console.log("opened");
          stream.destroy();
        });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({ stdout: "opened\n", stderr: "" });
  expect(exitCode).toBe(0);
});

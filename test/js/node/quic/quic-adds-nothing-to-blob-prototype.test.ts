import { expect, test } from "bun:test";
import { bunExe } from "harness";
import { run } from "../../../aot/harness/run";

test("loading node:quic adds no property to Blob.prototype", async () => {
  const { stdout, exitCode } = await run([
    bunExe(),
    "-e",
    `
      process.on("warning", () => {});
      const before = Reflect.ownKeys(Blob.prototype).map(String).join();
      require("node:quic");
      console.log(Reflect.ownKeys(Blob.prototype).map(String).join() === before);
      `,
  ]);
  expect({ stdout, exitCode }).toEqual({ stdout: "true\n", exitCode: 0 });
});

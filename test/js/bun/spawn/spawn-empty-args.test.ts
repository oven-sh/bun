import { expect, test } from "bun:test";
import { bunExe } from "harness";
import { join } from "node:path";

test("handle empty argument", async () => {
  const proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dirname, "empty-final-arg.js"), ""],
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });

  const exited = await proc.exited;
  expect(exited).toBe(0);
});

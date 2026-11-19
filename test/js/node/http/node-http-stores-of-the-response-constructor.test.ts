import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

test("the setters of a class that extends ServerResponse get every store of its constructor", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "../../../aot/parallel/node-http/stores-of-the-response-constructor.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const expected = await Bun.file(
    join(import.meta.dir, "node-http-stores-of-the-response-constructor.expected.txt"),
  ).text();
  expect(stdout.split("\n")).toEqual(expected.split("\n"));
  expect(exitCode).toBe(0);
});

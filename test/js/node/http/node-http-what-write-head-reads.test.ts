import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

test("writeHead() reads headersSent and calls hasHeader(), wherever a program has replaced them", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "../../../aot/parallel/node-http/what-write-head-reads.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const expected = await Bun.file(join(import.meta.dir, "node-http-what-write-head-reads.expected.txt")).text();
  expect(stdout.split("\n")).toEqual(expected.split("\n"));
  expect(exitCode).toBe(0);
});

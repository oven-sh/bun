import { expect, test } from "bun:test";
import { bunExe } from "harness";
import path from "node:path";
import { run } from "../../../aot/harness/run";

test("a response is the same bytes whether its head and body are written at once or in pieces", async () => {
  const { stdout, stderr, exitCode } = await run([
    bunExe(),
    path.join(import.meta.dir, "node-http-whole-response-fixture.ts"),
  ]);
  expect(stderr).toBe("");
  expect(stdout).toMatchSnapshot();
  expect(exitCode).toBe(0);
});

import { bunExe } from "bun:harness";
import { bunEnv, runBunInstall, tmpdirSync } from "harness";
import { expect, it } from "bun:test";
import * as path from "node:path";

it("works", async () => {
  let { stdout, stderr, exited } = Bun.spawn({
    cmd: [bunExe(), "run", path.join(import.meta.dirname, "_fixtures", "msw.ts")],
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: bunEnv,
  });
  let err = await new Response(stderr).text();
  expect(err).toBeEmpty();
  let out = await new Response(stdout).text();
  expect(out).toEqual("2\n");
  expect(await exited).toBe(0);
});

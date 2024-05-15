import { bunExe } from "bun:harness";
import { bunEnv, runBunInstall, tmpdirSync } from "harness";
import { expect, it } from "bun:test";
import * as path from "node:path";

it("works", async () => {
  const fixture_path = path.join(import.meta.dirname, "_fixtures", "st.ts");
  const fixture_data = await Bun.file(fixture_path).text();
  let { stdout, stderr, exited } = Bun.spawn({
    cmd: [bunExe(), "run", fixture_path],
    cwd: path.dirname(fixture_path),
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: bunEnv,
  });
  // err = await new Response(stderr).text();
  // expect(err).toBeEmpty();
  let out = await new Response(stdout).text();
  expect(out).toEqual(fixture_data + "\n");
  expect(await exited).toBe(0);
});

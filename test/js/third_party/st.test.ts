import { bunExe, bunEnv } from "harness";
import { expect, it } from "bun:test";
import { join, dirname } from "node:path";

it("works", async () => {
  const fixture_path = join(import.meta.dirname, "_fixtures", "st.ts");
  const fixture_data = await Bun.file(fixture_path).text();
  let { stdout, stderr, exited } = Bun.spawn({
    cmd: [bunExe(), "run", fixture_path],
    cwd: dirname(fixture_path),
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: bunEnv,
  });
  let [code, err, out] = await Promise.all([exited, new Response(stderr).text(), new Response(stdout).text()]);
  if (code !== 0) {
    expect(err).toBeEmpty();
  }
  expect(out).toEqual(fixture_data + "\n");
  expect(code).toBe(0);
});

import { bunEnv, bunExe } from "harness";
import { join } from "path";

test("regression: require()ing a module with TLA should error and then wipe the module cache, so that importing it again works", async () => {
  const proc = Bun.spawn({
    cmd: [bunExe(), "run", "--smol", join(import.meta.dir, "24387", "entry.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const { stdout, stderr } = proc;

  expect(await stderr.text()).toBe("");
  expect(await stdout.text()).toMatchInlineSnapshot(`
    "ERR_REQUIRE_ASYNC_MODULE require() cannot be used on an ESM graph with top-level await. Use import() instead.
    Module {
      foo: 67,
    }
    "
  `);
  expect(await proc.exited).toBe(0);
});

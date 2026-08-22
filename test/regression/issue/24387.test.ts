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
    "require() cannot be used on an ESM graph with top-level await. Use import() instead. To see where the top-level await comes from, use --experimental-print-required-tla. ERR_REQUIRE_ASYNC_MODULE
    Module {
      foo: 67,
    }
    "
  `);
  expect(await proc.exited).toBe(0);
});

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";
test("12910", async () => {
  const buns = Array.from(
    { length: 25 },
    () =>
      Bun.spawn({
        cmd: [bunExe(), join(import.meta.dir, "t.mjs")],
        cwd: import.meta.dir,
        stdio: ["inherit", "inherit", "inherit"],
        env: bunEnv,
      }).exited,
  );

  const exited = await Promise.all(buns);
  expect(exited).toEqual(Array.from({ length: 25 }, () => 0));
});

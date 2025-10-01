import { expect, test } from "bun:test";
import { bunExe } from "harness";

test("23077", async () => {
  await using result = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/a.fixture.ts", import.meta.dir + "/b.fixture.ts"],
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();
  expect(stderr).toInclude(" 2 pass");
  expect(exitCode).toBe(0);
});

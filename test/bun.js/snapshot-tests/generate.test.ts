import { bunExe } from "bunExe";
test("generate jest snapshot output", () => {
  // generate jest snapshots and let bun test runner test against them
  const { exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "jest", import.meta.dir + "/snapshots/", "--updateSnapshot"],
  });

  expect(exitCode).toBe(0);
});

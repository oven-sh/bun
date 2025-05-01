import { bunExe } from "harness";

test("child_process_ipc_large_disconnect", () => {
  const file = __dirname + "/fixtures/child-process-ipc-large-disconect.mjs";
  const expected = Bun.spawnSync(["node", file]);
  const actual = Bun.spawnSync([bunExe(), file]);

  expect(actual.stderr.toString()).toBe(expected.stderr.toString());
  expect(actual.exitCode).toBe(expected.exitCode);
  expect(actual.stdout.toString()).toBe(expected.stdout.toString());
});

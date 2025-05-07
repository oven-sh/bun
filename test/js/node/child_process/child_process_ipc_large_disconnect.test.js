import { bunExe } from "harness";

test("child_process_ipc_large_disconnect", () => {
  const file = __dirname + "/fixtures/child-process-ipc-large-disconect.mjs";
  const actual = Bun.spawnSync([bunExe(), file]);

  expect(actual.stderr.toString()).toBe("");
  expect(actual.exitCode).toBe(0);
  expect(actual.stdout.toString()).toStartWith(`2: a\n2: b\n2: c\n2: d\n`);
  // large messages aren't always sent before disconnect. they are on windows but not on mac.
  expect(actual.stdout.toString()).toEndWith(`disconnected\n`);
});

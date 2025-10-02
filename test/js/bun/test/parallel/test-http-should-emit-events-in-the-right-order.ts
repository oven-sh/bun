import { bunEnv, bunExe } from "harness";
import { createTest } from "node-harness";
import * as path from "node:path";
const { expect } = createTest(import.meta.path);

const { stdout, exited } = Bun.spawn({
  cmd: [bunExe(), "run", path.join(import.meta.dir, "../../../node/http/fixtures/log-events.mjs")],
  stdout: "pipe",
  stdin: "ignore",
  stderr: "inherit",
  env: bunEnv,
});
const out = await stdout.text();
// TODO prefinish and socket are not emitted in the right order
expect(
  out
    .split("\n")
    .filter(Boolean)
    .map(x => JSON.parse(x)),
).toStrictEqual([
  ["req", "socket"],
  ["req", "prefinish"],
  ["req", "finish"],
  ["req", "response"],
  "STATUS: 200",
  // TODO: not totally right:
  ["res", "resume"],
  ["req", "close"],
  ["res", "readable"],
  ["res", "end"],
  ["res", "close"],
]);
expect(await exited).toBe(0);

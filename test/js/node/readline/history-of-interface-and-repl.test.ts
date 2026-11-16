import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "../../../aot/harness/run";

const expected = [
  'history event ["one"]',
  'history event ["two","one"]',
  'history event ["one","two"]',
  'history event ["three","one","two"]',
  'history event ["four","three","one"]',
  'lines ["one","two","one","three","four"] history ["four","three","one"]',
  'given history ["b","a"] 30',
  "bad history ERR_INVALID_ARG_TYPE",
  "bad size ERR_OUT_OF_RANGE",
  `first {"error":null,"history":[".exit","throw new RangeError('r')","'a' + 'b'","1 + 1"],"printed":["2","'ab'","Uncaught RangeError: r"]}`,
  `file ["throw new RangeError('r')","'a' + 'b'","1 + 1"]`,
  "mode 600",
  `second {"error":null,"history":[".exit","1 + 2","throw new RangeError('r')","'a' + 'b'","1 + 1"],"printed":["3"]}`,
  `file ["1 + 2","throw new RangeError('r')","'a' + 'b'","1 + 1"]`,
  'no file {"error":null,"history":[".exit","1 + 1"],"printed":["2"]}',
  'a folder {"error":null,"history":[".exit","1 + 1"],"printed":["2"]}',
  'default {"error":null,"history":[".exit","1 + 1"],"printed":["2"]} 1 + 1',
];

test.skipIf(process.platform === "win32")("history of a readline interface and of a REPL", async () => {
  using home = tempDir("history-home", {});
  const { NODE_REPL_HISTORY: _, ...env } = bunEnv;
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), join(import.meta.dir, "history-of-interface-and-repl-fixture.js")],
    undefined,
    { ...env, HOME: String(home), HISTORY_HOME: String(home) },
  );
  expect({ lines: stdout.trimEnd().split("\n"), stderr, exitCode }).toEqual({
    lines: expected,
    stderr: "",
    exitCode: 0,
  });
});

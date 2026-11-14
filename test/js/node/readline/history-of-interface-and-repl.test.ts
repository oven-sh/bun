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

// Node.js v26.12.1 prints these rows for the fixture. Before v26.8.0 (nodejs/node#64513) it replaced the history with the
// entries of the file: only the first row and the last row were the same.
test.concurrent("setupHistory() puts the entries of the history file after the history of the REPL", async () => {
  using dir = tempDir("repl-history-file-load", {});
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), join(import.meta.dir, "repl-history-file-load-fixture.js"), String(dir)],
    undefined,
    // With TERM=dumb, write() does not end a line, in Node.js too.
    { ...bunEnv, TERM: "xterm-256color" },
  );
  expect({ lines: stdout.trimEnd().split("\n"), stderr, exitCode }).toEqual({
    lines: [
      'no line, size 2 {"history":["old3","old2"],"file":"old3\\nold2","historyEvents":0}',
      'two lines {"history":["2 + 2","1 + 1","old2","old1"],"file":"2 + 2\\n1 + 1\\nold2\\nold1","historyEvents":2}',
      'a file that ends in a newline {"history":["1 + 1","old2","old1",""],"file":"1 + 1\\nold2\\nold1\\n","historyEvents":1}',
      'an empty file {"history":["1 + 1"],"file":"1 + 1","historyEvents":1}',
      'more entries than size 3 {"history":["2 + 2","1 + 1","old3"],"file":"2 + 2\\n1 + 1\\nold3","historyEvents":2}',
      'a line equal to the newest entry of the file {"history":["1 + 1","1 + 1","old1"],"file":"1 + 1\\n1 + 1\\nold1","historyEvents":1}',
      'a command of two lines, the second after the read {"history":["2]\\r[1,","old2","old1"],"file":"2]\\r[1,\\nold2\\nold1","historyEvents":2}',
      'a line from write() {"history":["1 + 1","old2","old1"],"file":"1 + 1\\nold2\\nold1","historyEvents":1}',
      'a line after displayPrompt() {"history":["1 + 1","old2","old1"],"file":"1 + 1\\nold2\\nold1","historyEvents":1}',
      'a history assigned to the REPL {"history":["assigned","old2","old1"],"file":"assigned\\nold2\\nold1","historyEvents":0,"isTheAssignedArray":true}',
      'a history option {"history":["given","old2","old1"],"file":"given\\nold2\\nold1","historyEvents":0,"isTheGivenArray":true}',
      'an empty history option {"history":["old2","old1"],"file":"old2\\nold1","historyEvents":0,"isTheGivenArray":false}',
    ],
    stderr: "",
    exitCode: 0,
  });
});

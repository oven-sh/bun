// A Bun.SQL query keeps its native query handle under an own symbol, so script
// can reach the handle and call run() itself. The pool always calls
// run(connection, query). A call with fewer arguments must throw. The handle
// read past the end of the argument list instead, which ended the process with
// "panic: index out of bounds: the len is 0 but the index is 0".
// The fixture runs in a subprocess because that failure kills the process.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

const fixture = path.join(import.meta.dir, "postgres-query-handle-run-arguments-fixture.ts");

// Not concurrent: debug builds that start at the same time take longer to
// start, and a debug build already needs a third of the test timeout.
test.each([
  ["run()", { name: "Error", message: "connection must be a PostgresSQLConnection" }],
  ["run(connection)", { name: "TypeError", message: "Expected query to be a Query for 'run'." }],
])("query handle: %s throws", async (call, thrown) => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture, call],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // stderr is not asserted. It is here so that a crash report shows in the diff.
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: JSON.stringify(thrown) + "\n",
    stderr: expect.any(String),
    exitCode: 0,
  });
});

// Fault-injection test: requires a server that writes exact byte ranges at exact points in the
// client's parse, which a healthy container will not do on demand. All wire-protocol bytes come
// from test/js/sql/wire-frames.ts.
//
// The client parses a socket read in place and calls JS between two messages: a parameter's
// toString() (the Bind of a queued request is encoded when the request before it completes) or a
// sql.listen() listener. That JS can run the event loop. The loop then reads again, for this
// connection and for every other socket, into the buffer that the rest of the read is still in.
// Every reply must still go to its own query, in the order of the byte stream.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

const fixture = path.join(import.meta.dir, "postgres-on-data-reentry-fixture.ts");

async function run(scenario: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...bunEnv, SCENARIO: scenario },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { result: stdout.trim() && JSON.parse(stdout), stderr: stderr.trim(), exitCode };
}

const ownRows = { a: ["a"], b: ["b"], big: ["big:70000"], q: ["q"], conversions: 1 };

test.concurrent.each([
  "newer bytes of the same connection",
  "newer bytes, with a message that came in two reads",
  "a longer read of the same connection",
  "the rest of a message",
])("postgres: the event loop runs inside a parameter conversion: %s", async scenario => {
  expect(await run(scenario)).toEqual({ result: ownRows, stderr: "", exitCode: 0 });
});

test.concurrent(
  "postgres: the event loop runs inside a parameter conversion: a read of another connection",
  async () => {
    expect(await run("a read of another connection")).toEqual({
      result: { ...ownRows, other: [["1"], ["2"]] },
      stderr: "",
      exitCode: 0,
    });
  },
);

test.concurrent("postgres: the event loop runs inside a notification listener", async () => {
  expect(await run("a notification listener")).toEqual({ result: { seen: ["1", "2", "3"] }, stderr: "", exitCode: 0 });
});

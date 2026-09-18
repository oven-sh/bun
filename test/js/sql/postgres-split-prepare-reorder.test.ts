// Result attribution in the postgres client must not depend on how the inbound
// byte stream happens to be segmented. When a named statement's preparation
// reply (ParseComplete / ParameterDescription / RowDescription / ReadyForQuery)
// arrives split across multiple reads, the statement becomes Prepared in the
// ParameterDescription handler while the earlier-enqueued queries are still
// Pending and unwritten. A query enqueued in that gap used to pass the
// enqueue-time pipeline gate and write its Bind immediately, ahead of the
// held-back cohort, while responses are still attributed to
// requests.peek_item(0) in enqueue order: the first query receives the jumper's
// rows, or a subset of queries never settle. This is the recv-side form of the
// reorder covered by postgres-prepared-pipeline-reorder.test.ts: one statement
// text, default configuration, only the inbound segmentation differs.
//
// Fault-injection test: requires a server that deliberately splits the prepare
// reply across writes, which a healthy container on loopback will not reliably
// do. All wire-protocol bytes come from test/js/sql/wire-frames.ts.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

const fixture = path.join(import.meta.dir, "postgres-split-prepare-reorder-fixture.ts");

test("postgres: queries issued during a split prepare reply are not reordered", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr: stderr.trim() }).toEqual({ stdout: "ok 16/16", stderr: "" });
  expect(exitCode).toBe(0);
});

test("postgres: the same bytes coalesced into single writes deliver correct results (control)", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...bunEnv, SPLIT: "0" },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr: stderr.trim() }).toEqual({ stdout: "ok 16/16", stderr: "" });
  expect(exitCode).toBe(0);
});

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "path";

// https://github.com/oven-sh/bun/issues/5627
// amqplib fragments payloads larger than the negotiated frameMax across many
// AMQP body frames and funnels them through an objectMode PassThrough into the
// net.Socket (see amqplib/lib/mux.js). In older Bun versions the receive side
// would see duplicated/interleaved bytes, tripping "Invalid frame" /
// "Frame size exceeds frame max" in amqplib/lib/frame.js.
test("amqplib round-trips large messages without frame corruption", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "amqplib-large-message-fixture.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.split("\n").filter(Boolean)).toEqual(["OK 100", "OK 200000"]);
  expect(exitCode).toBe(0);
}, 30_000);

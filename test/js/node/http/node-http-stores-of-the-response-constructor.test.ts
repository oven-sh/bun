import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

test("the setters of a class that extends ServerResponse get every store of its constructor", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "../../../aot/parallel/node-http/stores-of-the-response-constructor.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const expected = await Bun.file(
    join(import.meta.dir, "node-http-stores-of-the-response-constructor.expected.txt"),
  ).text();
  expect(stdout.split("\n")).toEqual(expected.split("\n"));
  expect(exitCode).toBe(0);
});

test("OutgoingMessage and ServerResponse ignore captureRejections in their options, like Node.js", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      join(import.meta.dir, "../../../aot/parallel/library-modules/http-messages-hand-no-options-to-the-emitter.mjs"),
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // What node v26.3.0 prints: https://github.com/nodejs/node/blob/v26.3.0/lib/_http_outgoing.js#L107
  expect({ stdout: stdout.split("\n"), stderr, exitCode }).toEqual({
    stdout: [
      ...[
        "new OutgoingMessage",
        "a class that extends OutgoingMessage",
        "new ServerResponse",
        "a class that extends ServerResponse",
        "ServerResponse called on an object",
      ].flatMap(way => [
        `${way}, captureRejections true: false`,
        `${way}, captureRejections "yes": false`,
        `${way}, while EventEmitter.captureRejections is true: true`,
      ]),
      "",
    ],
    stderr: "",
    exitCode: 0,
  });
});

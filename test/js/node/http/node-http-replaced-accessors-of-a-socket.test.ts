import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

test("a server reads the accessors of its connection, wherever a program has replaced one", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "node-http-replaced-accessors-of-a-socket-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe(`destroyed on the socket, GET, end(body): 3 2 2 2 1
destroyed on the socket, GET, write(), end(body): 3 2 2 2 1
destroyed on the socket, GET, a content-length, write(), end(): 3 2 2 2 1
destroyed on the socket, POST with the body read: 3 3 3 3 1
destroyed on the socket, POST with the body read, write(), end(body): 3 3 3 3 1
destroyed on the socket, POST with the body ignored: 3 2 2 2 1
readable on the socket, GET, end(body): 2 2 2 2 0
readable on the socket, GET, write(), end(body): 2 2 2 2 0
readable on the socket, GET, a content-length, write(), end(): 2 2 2 2 0
readable on the socket, POST with the body read: 2 5 5 5 0
readable on the socket, POST with the body read, write(), end(body): 2 5 5 5 0
readable on the socket, POST with the body ignored: 2 3 3 3 0
readableEnded on the socket, GET, end(body): 3 1 1 1 2
readableEnded on the socket, GET, write(), end(body): 3 1 1 1 2
readableEnded on the socket, GET, a content-length, write(), end(): 3 1 1 1 2
readableEnded on the socket, POST with the body read: 3 3 3 3 2
readableEnded on the socket, POST with the body read, write(), end(body): 3 3 3 3 2
readableEnded on the socket, POST with the body ignored: 3 2 2 2 2
readableLength on the socket, GET, end(body): 1 1 1 1 0
readableLength on the socket, GET, write(), end(body): 1 1 1 1 0
readableLength on the socket, GET, a content-length, write(), end(): 1 1 1 1 0
readableLength on the socket, POST with the body read: 1 3 3 3 0
readableLength on the socket, POST with the body read, write(), end(body): 1 3 3 3 0
readableLength on the socket, POST with the body ignored: 1 2 2 2 0
readableHighWaterMark on the socket, GET, end(body): 1 2 2 2 0
readableHighWaterMark on the socket, GET, write(), end(body): 1 2 2 2 0
readableHighWaterMark on the socket, GET, a content-length, write(), end(): 1 2 2 2 0
readableHighWaterMark on the socket, POST with the body read: 1 4 4 4 0
readableHighWaterMark on the socket, POST with the body read, write(), end(body): 1 4 4 4 0
readableHighWaterMark on the socket, POST with the body ignored: 1 3 3 3 0
writableHighWaterMark on the socket, GET, end(body): 0 1 1 1 0
writableHighWaterMark on the socket, GET, write(), end(body): 0 2 2 2 0
writableHighWaterMark on the socket, GET, a content-length, write(), end(): 0 2 2 2 0
writableHighWaterMark on the socket, POST with the body read: 0 1 1 1 0
writableHighWaterMark on the socket, POST with the body read, write(), end(body): 0 3 3 3 0
writableHighWaterMark on the socket, POST with the body ignored: 0 1 1 1 0
writableEnded on the socket, GET, end(body): 0 0 0 0 0
writableEnded on the socket, GET, write(), end(body): 0 0 0 0 0
writableEnded on the socket, GET, a content-length, write(), end(): 0 0 0 0 0
writableEnded on the socket, POST with the body read: 0 1 1 1 0
writableEnded on the socket, POST with the body read, write(), end(body): 0 1 1 1 0
writableEnded on the socket, POST with the body ignored: 0 0 0 0 0
destroyed on an heir of the prototype of the socket, GET, end(body): 3 2 2 2 1
destroyed on an heir of the prototype of the socket, GET, write(), end(body): 3 2 2 2 1
destroyed on an heir of the prototype of the socket, GET, a content-length, write(), end(): 3 2 2 2 1
destroyed on an heir of the prototype of the socket, POST with the body read: 3 3 3 3 1
destroyed on an heir of the prototype of the socket, POST with the body read, write(), end(body): 3 3 3 3 1
destroyed on an heir of the prototype of the socket, POST with the body ignored: 3 2 2 2 1
readable on an heir of the prototype of the socket, GET, end(body): 2 2 2 2 0
readable on an heir of the prototype of the socket, GET, write(), end(body): 2 2 2 2 0
readable on an heir of the prototype of the socket, GET, a content-length, write(), end(): 2 2 2 2 0
readable on an heir of the prototype of the socket, POST with the body read: 2 5 5 5 0
readable on an heir of the prototype of the socket, POST with the body read, write(), end(body): 2 5 5 5 0
readable on an heir of the prototype of the socket, POST with the body ignored: 2 3 3 3 0
readableEnded on an heir of the prototype of the socket, GET, end(body): 3 1 1 1 2
readableEnded on an heir of the prototype of the socket, GET, write(), end(body): 3 1 1 1 2
readableEnded on an heir of the prototype of the socket, GET, a content-length, write(), end(): 3 1 1 1 2
readableEnded on an heir of the prototype of the socket, POST with the body read: 3 3 3 3 2
readableEnded on an heir of the prototype of the socket, POST with the body read, write(), end(body): 3 3 3 3 2
readableEnded on an heir of the prototype of the socket, POST with the body ignored: 3 2 2 2 2
readableLength on an heir of the prototype of the socket, GET, end(body): 1 1 1 1 0
readableLength on an heir of the prototype of the socket, GET, write(), end(body): 1 1 1 1 0
readableLength on an heir of the prototype of the socket, GET, a content-length, write(), end(): 1 1 1 1 0
readableLength on an heir of the prototype of the socket, POST with the body read: 1 3 3 3 0
readableLength on an heir of the prototype of the socket, POST with the body read, write(), end(body): 1 3 3 3 0
readableLength on an heir of the prototype of the socket, POST with the body ignored: 1 2 2 2 0
readableHighWaterMark on an heir of the prototype of the socket, GET, end(body): 1 2 2 2 0
readableHighWaterMark on an heir of the prototype of the socket, GET, write(), end(body): 1 2 2 2 0
readableHighWaterMark on an heir of the prototype of the socket, GET, a content-length, write(), end(): 1 2 2 2 0
readableHighWaterMark on an heir of the prototype of the socket, POST with the body read: 1 4 4 4 0
readableHighWaterMark on an heir of the prototype of the socket, POST with the body read, write(), end(body): 1 4 4 4 0
readableHighWaterMark on an heir of the prototype of the socket, POST with the body ignored: 1 3 3 3 0
writableHighWaterMark on an heir of the prototype of the socket, GET, end(body): 0 1 1 1 0
writableHighWaterMark on an heir of the prototype of the socket, GET, write(), end(body): 0 2 2 2 0
writableHighWaterMark on an heir of the prototype of the socket, GET, a content-length, write(), end(): 0 2 2 2 0
writableHighWaterMark on an heir of the prototype of the socket, POST with the body read: 0 1 1 1 0
writableHighWaterMark on an heir of the prototype of the socket, POST with the body read, write(), end(body): 0 3 3 3 0
writableHighWaterMark on an heir of the prototype of the socket, POST with the body ignored: 0 1 1 1 0
writableEnded on an heir of the prototype of the socket, GET, end(body): 0 0 0 0 0
writableEnded on an heir of the prototype of the socket, GET, write(), end(body): 0 0 0 0 0
writableEnded on an heir of the prototype of the socket, GET, a content-length, write(), end(): 0 0 0 0 0
writableEnded on an heir of the prototype of the socket, POST with the body read: 0 1 1 1 0
writableEnded on an heir of the prototype of the socket, POST with the body read, write(), end(body): 0 1 1 1 0
writableEnded on an heir of the prototype of the socket, POST with the body ignored: 0 0 0 0 0
`);
  expect(exitCode).toBe(0);
});

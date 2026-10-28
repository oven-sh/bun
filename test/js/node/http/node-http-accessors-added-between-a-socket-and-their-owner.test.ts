import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

test("a server reads an accessor that a program adds between its connection and the owner of the accessor", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "node-http-accessors-added-between-a-socket-and-their-owner-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe(`destroyed added on the prototype of the class, GET, end(body): 4 3 3 3 4
destroyed added on the prototype of the class, GET, write(), end(body): 4 3 3 3 4
destroyed added on the prototype of the class, GET, a content-length, write(), end(): 4 3 3 3 4
destroyed added on the prototype of the class, POST with the body read: 4 5 5 5 4
destroyed added on the prototype of the class, POST with the body read, write(), end(body): 4 5 5 5 4
destroyed added on the prototype of the class, POST with the body ignored: 4 4 4 4 4
readable added on the prototype of the class, GET, end(body): 3 3 3 3 0
readable added on the prototype of the class, GET, write(), end(body): 3 3 3 3 0
readable added on the prototype of the class, GET, a content-length, write(), end(): 3 3 3 3 0
readable added on the prototype of the class, POST with the body read: 3 5 5 5 0
readable added on the prototype of the class, POST with the body read, write(), end(body): 3 5 5 5 0
readable added on the prototype of the class, POST with the body ignored: 3 3 3 3 0
readableEnded added on the prototype of the class, GET, end(body): 0 0 0 0 1
readableEnded added on the prototype of the class, GET, write(), end(body): 0 0 0 0 1
readableEnded added on the prototype of the class, GET, a content-length, write(), end(): 0 0 0 0 1
readableEnded added on the prototype of the class, POST with the body read: 0 0 0 0 1
readableEnded added on the prototype of the class, POST with the body read, write(), end(body): 0 0 0 0 1
readableEnded added on the prototype of the class, POST with the body ignored: 0 0 0 0 1
readableLength added on the prototype of the class, GET, end(body): 0 0 0 0 0
readableLength added on the prototype of the class, GET, write(), end(body): 0 0 0 0 0
readableLength added on the prototype of the class, GET, a content-length, write(), end(): 0 0 0 0 0
readableLength added on the prototype of the class, POST with the body read: 0 0 0 0 0
readableLength added on the prototype of the class, POST with the body read, write(), end(body): 0 0 0 0 0
readableLength added on the prototype of the class, POST with the body ignored: 0 0 0 0 0
readableHighWaterMark added on the prototype of the class, GET, end(body): 0 1 1 1 0
readableHighWaterMark added on the prototype of the class, GET, write(), end(body): 0 1 1 1 0
readableHighWaterMark added on the prototype of the class, GET, a content-length, write(), end(): 0 1 1 1 0
readableHighWaterMark added on the prototype of the class, POST with the body read: 0 1 1 1 0
readableHighWaterMark added on the prototype of the class, POST with the body read, write(), end(body): 0 1 1 1 0
readableHighWaterMark added on the prototype of the class, POST with the body ignored: 0 1 1 1 0
writableHighWaterMark added on the prototype of the class, GET, end(body): 0 1 1 1 0
writableHighWaterMark added on the prototype of the class, GET, write(), end(body): 0 2 2 2 0
writableHighWaterMark added on the prototype of the class, GET, a content-length, write(), end(): 0 2 2 2 0
writableHighWaterMark added on the prototype of the class, POST with the body read: 0 1 1 1 0
writableHighWaterMark added on the prototype of the class, POST with the body read, write(), end(body): 0 3 3 3 0
writableHighWaterMark added on the prototype of the class, POST with the body ignored: 0 1 1 1 0
writableEnded added on the prototype of the class, GET, end(body): 0 0 0 0 0
writableEnded added on the prototype of the class, GET, write(), end(body): 0 0 0 0 0
writableEnded added on the prototype of the class, GET, a content-length, write(), end(): 0 0 0 0 0
writableEnded added on the prototype of the class, POST with the body read: 0 0 0 0 0
writableEnded added on the prototype of the class, POST with the body read, write(), end(body): 0 0 0 0 0
writableEnded added on the prototype of the class, POST with the body ignored: 0 0 0 0 0
destroyed added on net.Socket.prototype, GET, end(body): 4 4 4 4 5
destroyed added on net.Socket.prototype, GET, write(), end(body): 4 4 4 4 5
destroyed added on net.Socket.prototype, GET, a content-length, write(), end(): 4 4 4 4 5
destroyed added on net.Socket.prototype, POST with the body read: 4 6 6 6 5
destroyed added on net.Socket.prototype, POST with the body read, write(), end(body): 4 6 6 6 5
destroyed added on net.Socket.prototype, POST with the body ignored: 4 5 5 5 5
readable added on net.Socket.prototype, GET, end(body): 3 3 3 3 0
readable added on net.Socket.prototype, GET, write(), end(body): 3 3 3 3 0
readable added on net.Socket.prototype, GET, a content-length, write(), end(): 3 3 3 3 0
readable added on net.Socket.prototype, POST with the body read: 3 5 5 5 0
readable added on net.Socket.prototype, POST with the body read, write(), end(body): 3 5 5 5 0
readable added on net.Socket.prototype, POST with the body ignored: 3 3 3 3 0
readableEnded added on net.Socket.prototype, GET, end(body): 0 0 0 0 1
readableEnded added on net.Socket.prototype, GET, write(), end(body): 0 0 0 0 1
readableEnded added on net.Socket.prototype, GET, a content-length, write(), end(): 0 0 0 0 1
readableEnded added on net.Socket.prototype, POST with the body read: 0 0 0 0 1
readableEnded added on net.Socket.prototype, POST with the body read, write(), end(body): 0 0 0 0 1
readableEnded added on net.Socket.prototype, POST with the body ignored: 0 0 0 0 1
readableLength added on net.Socket.prototype, GET, end(body): 0 0 0 0 0
readableLength added on net.Socket.prototype, GET, write(), end(body): 0 0 0 0 0
readableLength added on net.Socket.prototype, GET, a content-length, write(), end(): 0 0 0 0 0
readableLength added on net.Socket.prototype, POST with the body read: 0 0 0 0 0
readableLength added on net.Socket.prototype, POST with the body read, write(), end(body): 0 0 0 0 0
readableLength added on net.Socket.prototype, POST with the body ignored: 0 0 0 0 0
readableHighWaterMark added on net.Socket.prototype, GET, end(body): 0 1 1 1 0
readableHighWaterMark added on net.Socket.prototype, GET, write(), end(body): 0 1 1 1 0
readableHighWaterMark added on net.Socket.prototype, GET, a content-length, write(), end(): 0 1 1 1 0
readableHighWaterMark added on net.Socket.prototype, POST with the body read: 0 1 1 1 0
readableHighWaterMark added on net.Socket.prototype, POST with the body read, write(), end(body): 0 1 1 1 0
readableHighWaterMark added on net.Socket.prototype, POST with the body ignored: 0 1 1 1 0
writableHighWaterMark added on net.Socket.prototype, GET, end(body): 0 1 1 1 0
writableHighWaterMark added on net.Socket.prototype, GET, write(), end(body): 0 2 2 2 0
writableHighWaterMark added on net.Socket.prototype, GET, a content-length, write(), end(): 0 2 2 2 0
writableHighWaterMark added on net.Socket.prototype, POST with the body read: 0 1 1 1 0
writableHighWaterMark added on net.Socket.prototype, POST with the body read, write(), end(body): 0 3 3 3 0
writableHighWaterMark added on net.Socket.prototype, POST with the body ignored: 0 1 1 1 0
writableEnded added on net.Socket.prototype, GET, end(body): 0 0 0 0 0
writableEnded added on net.Socket.prototype, GET, write(), end(body): 0 0 0 0 0
writableEnded added on net.Socket.prototype, GET, a content-length, write(), end(): 0 0 0 0 0
writableEnded added on net.Socket.prototype, POST with the body read: 0 0 0 0 0
writableEnded added on net.Socket.prototype, POST with the body read, write(), end(body): 0 0 0 0 0
writableEnded added on net.Socket.prototype, POST with the body ignored: 0 0 0 0 0
readable added on Duplex.prototype, GET, end(body): 3 3 3 3 0
readable added on Duplex.prototype, GET, write(), end(body): 3 3 3 3 0
readable added on Duplex.prototype, GET, a content-length, write(), end(): 3 3 3 3 0
readable added on Duplex.prototype, POST with the body read: 3 5 5 5 0
readable added on Duplex.prototype, POST with the body read, write(), end(body): 3 5 5 5 0
readable added on Duplex.prototype, POST with the body ignored: 3 3 3 3 0
readableEnded added on Duplex.prototype, GET, end(body): 0 0 0 0 1
readableEnded added on Duplex.prototype, GET, write(), end(body): 0 0 0 0 1
readableEnded added on Duplex.prototype, GET, a content-length, write(), end(): 0 0 0 0 1
readableEnded added on Duplex.prototype, POST with the body read: 0 0 0 0 1
readableEnded added on Duplex.prototype, POST with the body read, write(), end(body): 0 0 0 0 1
readableEnded added on Duplex.prototype, POST with the body ignored: 0 0 0 0 1
readableLength added on Duplex.prototype, GET, end(body): 0 0 0 0 0
readableLength added on Duplex.prototype, GET, write(), end(body): 0 0 0 0 0
readableLength added on Duplex.prototype, GET, a content-length, write(), end(): 0 0 0 0 0
readableLength added on Duplex.prototype, POST with the body read: 0 0 0 0 0
readableLength added on Duplex.prototype, POST with the body read, write(), end(body): 0 0 0 0 0
readableLength added on Duplex.prototype, POST with the body ignored: 0 0 0 0 0
readableHighWaterMark added on Duplex.prototype, GET, end(body): 0 1 1 1 0
readableHighWaterMark added on Duplex.prototype, GET, write(), end(body): 0 1 1 1 0
readableHighWaterMark added on Duplex.prototype, GET, a content-length, write(), end(): 0 1 1 1 0
readableHighWaterMark added on Duplex.prototype, POST with the body read: 0 1 1 1 0
readableHighWaterMark added on Duplex.prototype, POST with the body read, write(), end(body): 0 1 1 1 0
readableHighWaterMark added on Duplex.prototype, POST with the body ignored: 0 1 1 1 0
destroyed on a prototype put below net.Socket.prototype, GET, end(body): 4 4 4 4 5
destroyed on a prototype put below net.Socket.prototype, GET, write(), end(body): 4 4 4 4 5
destroyed on a prototype put below net.Socket.prototype, GET, a content-length, write(), end(): 4 4 4 4 5
destroyed on a prototype put below net.Socket.prototype, POST with the body read: 4 6 6 6 5
destroyed on a prototype put below net.Socket.prototype, POST with the body read, write(), end(body): 4 6 6 6 5
destroyed on a prototype put below net.Socket.prototype, POST with the body ignored: 4 5 5 5 5
readable on a prototype put below net.Socket.prototype, GET, end(body): 3 3 3 3 0
readable on a prototype put below net.Socket.prototype, GET, write(), end(body): 3 3 3 3 0
readable on a prototype put below net.Socket.prototype, GET, a content-length, write(), end(): 3 3 3 3 0
readable on a prototype put below net.Socket.prototype, POST with the body read: 3 5 5 5 0
readable on a prototype put below net.Socket.prototype, POST with the body read, write(), end(body): 3 5 5 5 0
readable on a prototype put below net.Socket.prototype, POST with the body ignored: 3 3 3 3 0
readableEnded on a prototype put below net.Socket.prototype, GET, end(body): 0 0 0 0 1
readableEnded on a prototype put below net.Socket.prototype, GET, write(), end(body): 0 0 0 0 1
readableEnded on a prototype put below net.Socket.prototype, GET, a content-length, write(), end(): 0 0 0 0 1
readableEnded on a prototype put below net.Socket.prototype, POST with the body read: 0 0 0 0 1
readableEnded on a prototype put below net.Socket.prototype, POST with the body read, write(), end(body): 0 0 0 0 1
readableEnded on a prototype put below net.Socket.prototype, POST with the body ignored: 0 0 0 0 1
readableLength on a prototype put below net.Socket.prototype, GET, end(body): 0 0 0 0 0
readableLength on a prototype put below net.Socket.prototype, GET, write(), end(body): 0 0 0 0 0
readableLength on a prototype put below net.Socket.prototype, GET, a content-length, write(), end(): 0 0 0 0 0
readableLength on a prototype put below net.Socket.prototype, POST with the body read: 0 0 0 0 0
readableLength on a prototype put below net.Socket.prototype, POST with the body read, write(), end(body): 0 0 0 0 0
readableLength on a prototype put below net.Socket.prototype, POST with the body ignored: 0 0 0 0 0
readableHighWaterMark on a prototype put below net.Socket.prototype, GET, end(body): 0 1 1 1 0
readableHighWaterMark on a prototype put below net.Socket.prototype, GET, write(), end(body): 0 1 1 1 0
readableHighWaterMark on a prototype put below net.Socket.prototype, GET, a content-length, write(), end(): 0 1 1 1 0
readableHighWaterMark on a prototype put below net.Socket.prototype, POST with the body read: 0 1 1 1 0
readableHighWaterMark on a prototype put below net.Socket.prototype, POST with the body read, write(), end(body): 0 1 1 1 0
readableHighWaterMark on a prototype put below net.Socket.prototype, POST with the body ignored: 0 1 1 1 0
writableHighWaterMark on a prototype put below net.Socket.prototype, GET, end(body): 0 1 1 1 0
writableHighWaterMark on a prototype put below net.Socket.prototype, GET, write(), end(body): 0 2 2 2 0
writableHighWaterMark on a prototype put below net.Socket.prototype, GET, a content-length, write(), end(): 0 2 2 2 0
writableHighWaterMark on a prototype put below net.Socket.prototype, POST with the body read: 0 1 1 1 0
writableHighWaterMark on a prototype put below net.Socket.prototype, POST with the body read, write(), end(body): 0 3 3 3 0
writableHighWaterMark on a prototype put below net.Socket.prototype, POST with the body ignored: 0 1 1 1 0
writableEnded on a prototype put below net.Socket.prototype, GET, end(body): 0 0 0 0 0
writableEnded on a prototype put below net.Socket.prototype, GET, write(), end(body): 0 0 0 0 0
writableEnded on a prototype put below net.Socket.prototype, GET, a content-length, write(), end(): 0 0 0 0 0
writableEnded on a prototype put below net.Socket.prototype, POST with the body read: 0 0 0 0 0
writableEnded on a prototype put below net.Socket.prototype, POST with the body read, write(), end(body): 0 0 0 0 0
writableEnded on a prototype put below net.Socket.prototype, POST with the body ignored: 0 0 0 0 0
`);
  expect(exitCode).toBe(0);
});

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
  expect(stdout).toBe(`destroyed added on the prototype of the class, GET, end(body): 3 2 2 2 1
destroyed added on the prototype of the class, GET, write(), end(body): 3 2 2 2 1
destroyed added on the prototype of the class, GET, a content-length, write(), end(): 3 2 2 2 1
destroyed added on the prototype of the class, POST with the body read: 3 3 3 3 1
destroyed added on the prototype of the class, POST with the body read, write(), end(body): 3 3 3 3 1
destroyed added on the prototype of the class, POST with the body ignored: 3 2 2 2 1
readable added on the prototype of the class, GET, end(body): 2 2 2 2 0
readable added on the prototype of the class, GET, write(), end(body): 2 2 2 2 0
readable added on the prototype of the class, GET, a content-length, write(), end(): 2 2 2 2 0
readable added on the prototype of the class, POST with the body read: 2 5 5 5 0
readable added on the prototype of the class, POST with the body read, write(), end(body): 2 5 5 5 0
readable added on the prototype of the class, POST with the body ignored: 2 3 3 3 0
readableEnded added on the prototype of the class, GET, end(body): 3 1 1 1 2
readableEnded added on the prototype of the class, GET, write(), end(body): 3 1 1 1 2
readableEnded added on the prototype of the class, GET, a content-length, write(), end(): 3 1 1 1 2
readableEnded added on the prototype of the class, POST with the body read: 3 3 3 3 2
readableEnded added on the prototype of the class, POST with the body read, write(), end(body): 3 3 3 3 2
readableEnded added on the prototype of the class, POST with the body ignored: 3 2 2 2 2
readableLength added on the prototype of the class, GET, end(body): 1 1 1 1 0
readableLength added on the prototype of the class, GET, write(), end(body): 1 1 1 1 0
readableLength added on the prototype of the class, GET, a content-length, write(), end(): 1 1 1 1 0
readableLength added on the prototype of the class, POST with the body read: 1 3 3 3 0
readableLength added on the prototype of the class, POST with the body read, write(), end(body): 1 3 3 3 0
readableLength added on the prototype of the class, POST with the body ignored: 1 2 2 2 0
readableHighWaterMark added on the prototype of the class, GET, end(body): 1 2 2 2 0
readableHighWaterMark added on the prototype of the class, GET, write(), end(body): 1 2 2 2 0
readableHighWaterMark added on the prototype of the class, GET, a content-length, write(), end(): 1 2 2 2 0
readableHighWaterMark added on the prototype of the class, POST with the body read: 1 4 4 4 0
readableHighWaterMark added on the prototype of the class, POST with the body read, write(), end(body): 1 4 4 4 0
readableHighWaterMark added on the prototype of the class, POST with the body ignored: 1 3 3 3 0
writableHighWaterMark added on the prototype of the class, GET, end(body): 0 1 1 1 0
writableHighWaterMark added on the prototype of the class, GET, write(), end(body): 0 2 2 2 0
writableHighWaterMark added on the prototype of the class, GET, a content-length, write(), end(): 0 2 2 2 0
writableHighWaterMark added on the prototype of the class, POST with the body read: 0 1 1 1 0
writableHighWaterMark added on the prototype of the class, POST with the body read, write(), end(body): 0 3 3 3 0
writableHighWaterMark added on the prototype of the class, POST with the body ignored: 0 1 1 1 0
writableEnded added on the prototype of the class, GET, end(body): 0 0 0 0 0
writableEnded added on the prototype of the class, GET, write(), end(body): 0 0 0 0 0
writableEnded added on the prototype of the class, GET, a content-length, write(), end(): 0 0 0 0 0
writableEnded added on the prototype of the class, POST with the body read: 0 1 1 1 0
writableEnded added on the prototype of the class, POST with the body read, write(), end(body): 0 1 1 1 0
writableEnded added on the prototype of the class, POST with the body ignored: 0 0 0 0 0
destroyed added on net.Socket.prototype, GET, end(body): 3 2 2 2 1
destroyed added on net.Socket.prototype, GET, write(), end(body): 3 2 2 2 1
destroyed added on net.Socket.prototype, GET, a content-length, write(), end(): 3 2 2 2 1
destroyed added on net.Socket.prototype, POST with the body read: 3 3 3 3 1
destroyed added on net.Socket.prototype, POST with the body read, write(), end(body): 3 3 3 3 1
destroyed added on net.Socket.prototype, POST with the body ignored: 3 2 2 2 1
readable added on net.Socket.prototype, GET, end(body): 2 2 2 2 0
readable added on net.Socket.prototype, GET, write(), end(body): 2 2 2 2 0
readable added on net.Socket.prototype, GET, a content-length, write(), end(): 2 2 2 2 0
readable added on net.Socket.prototype, POST with the body read: 2 5 5 5 0
readable added on net.Socket.prototype, POST with the body read, write(), end(body): 2 5 5 5 0
readable added on net.Socket.prototype, POST with the body ignored: 2 3 3 3 0
readableEnded added on net.Socket.prototype, GET, end(body): 4 3 3 3 3
readableEnded added on net.Socket.prototype, GET, write(), end(body): 4 3 3 3 3
readableEnded added on net.Socket.prototype, GET, a content-length, write(), end(): 4 3 3 3 3
readableEnded added on net.Socket.prototype, POST with the body read: 4 5 5 5 3
readableEnded added on net.Socket.prototype, POST with the body read, write(), end(body): 4 5 5 5 3
readableEnded added on net.Socket.prototype, POST with the body ignored: 4 4 4 4 3
readableLength added on net.Socket.prototype, GET, end(body): 1 1 1 1 0
readableLength added on net.Socket.prototype, GET, write(), end(body): 1 1 1 1 0
readableLength added on net.Socket.prototype, GET, a content-length, write(), end(): 1 1 1 1 0
readableLength added on net.Socket.prototype, POST with the body read: 1 3 3 3 0
readableLength added on net.Socket.prototype, POST with the body read, write(), end(body): 1 3 3 3 0
readableLength added on net.Socket.prototype, POST with the body ignored: 1 2 2 2 0
readableHighWaterMark added on net.Socket.prototype, GET, end(body): 1 2 2 2 0
readableHighWaterMark added on net.Socket.prototype, GET, write(), end(body): 1 2 2 2 0
readableHighWaterMark added on net.Socket.prototype, GET, a content-length, write(), end(): 1 2 2 2 0
readableHighWaterMark added on net.Socket.prototype, POST with the body read: 1 4 4 4 0
readableHighWaterMark added on net.Socket.prototype, POST with the body read, write(), end(body): 1 4 4 4 0
readableHighWaterMark added on net.Socket.prototype, POST with the body ignored: 1 3 3 3 0
writableHighWaterMark added on net.Socket.prototype, GET, end(body): 0 1 1 1 0
writableHighWaterMark added on net.Socket.prototype, GET, write(), end(body): 0 2 2 2 0
writableHighWaterMark added on net.Socket.prototype, GET, a content-length, write(), end(): 0 2 2 2 0
writableHighWaterMark added on net.Socket.prototype, POST with the body read: 0 1 1 1 0
writableHighWaterMark added on net.Socket.prototype, POST with the body read, write(), end(body): 0 3 3 3 0
writableHighWaterMark added on net.Socket.prototype, POST with the body ignored: 0 1 1 1 0
writableEnded added on net.Socket.prototype, GET, end(body): 0 0 0 0 0
writableEnded added on net.Socket.prototype, GET, write(), end(body): 0 0 0 0 0
writableEnded added on net.Socket.prototype, GET, a content-length, write(), end(): 0 0 0 0 0
writableEnded added on net.Socket.prototype, POST with the body read: 0 1 1 1 0
writableEnded added on net.Socket.prototype, POST with the body read, write(), end(body): 0 1 1 1 0
writableEnded added on net.Socket.prototype, POST with the body ignored: 0 0 0 0 0
readable added on Duplex.prototype, GET, end(body): 2 2 2 2 0
readable added on Duplex.prototype, GET, write(), end(body): 2 2 2 2 0
readable added on Duplex.prototype, GET, a content-length, write(), end(): 2 2 2 2 0
readable added on Duplex.prototype, POST with the body read: 2 5 5 5 0
readable added on Duplex.prototype, POST with the body read, write(), end(body): 2 5 5 5 0
readable added on Duplex.prototype, POST with the body ignored: 2 3 3 3 0
readableEnded added on Duplex.prototype, GET, end(body): 4 3 3 3 3
readableEnded added on Duplex.prototype, GET, write(), end(body): 4 3 3 3 3
readableEnded added on Duplex.prototype, GET, a content-length, write(), end(): 4 3 3 3 3
readableEnded added on Duplex.prototype, POST with the body read: 4 5 5 5 3
readableEnded added on Duplex.prototype, POST with the body read, write(), end(body): 4 5 5 5 3
readableEnded added on Duplex.prototype, POST with the body ignored: 4 4 4 4 3
readableLength added on Duplex.prototype, GET, end(body): 1 1 1 1 0
readableLength added on Duplex.prototype, GET, write(), end(body): 1 1 1 1 0
readableLength added on Duplex.prototype, GET, a content-length, write(), end(): 1 1 1 1 0
readableLength added on Duplex.prototype, POST with the body read: 1 3 3 3 0
readableLength added on Duplex.prototype, POST with the body read, write(), end(body): 1 3 3 3 0
readableLength added on Duplex.prototype, POST with the body ignored: 1 2 2 2 0
readableHighWaterMark added on Duplex.prototype, GET, end(body): 1 2 2 2 0
readableHighWaterMark added on Duplex.prototype, GET, write(), end(body): 1 2 2 2 0
readableHighWaterMark added on Duplex.prototype, GET, a content-length, write(), end(): 1 2 2 2 0
readableHighWaterMark added on Duplex.prototype, POST with the body read: 1 4 4 4 0
readableHighWaterMark added on Duplex.prototype, POST with the body read, write(), end(body): 1 4 4 4 0
readableHighWaterMark added on Duplex.prototype, POST with the body ignored: 1 3 3 3 0
destroyed on a prototype put below net.Socket.prototype, GET, end(body): 3 2 2 2 1
destroyed on a prototype put below net.Socket.prototype, GET, write(), end(body): 3 2 2 2 1
destroyed on a prototype put below net.Socket.prototype, GET, a content-length, write(), end(): 3 2 2 2 1
destroyed on a prototype put below net.Socket.prototype, POST with the body read: 3 3 3 3 1
destroyed on a prototype put below net.Socket.prototype, POST with the body read, write(), end(body): 3 3 3 3 1
destroyed on a prototype put below net.Socket.prototype, POST with the body ignored: 3 2 2 2 1
readable on a prototype put below net.Socket.prototype, GET, end(body): 2 2 2 2 0
readable on a prototype put below net.Socket.prototype, GET, write(), end(body): 2 2 2 2 0
readable on a prototype put below net.Socket.prototype, GET, a content-length, write(), end(): 2 2 2 2 0
readable on a prototype put below net.Socket.prototype, POST with the body read: 2 5 5 5 0
readable on a prototype put below net.Socket.prototype, POST with the body read, write(), end(body): 2 5 5 5 0
readable on a prototype put below net.Socket.prototype, POST with the body ignored: 2 3 3 3 0
readableEnded on a prototype put below net.Socket.prototype, GET, end(body): 4 3 3 3 3
readableEnded on a prototype put below net.Socket.prototype, GET, write(), end(body): 4 3 3 3 3
readableEnded on a prototype put below net.Socket.prototype, GET, a content-length, write(), end(): 4 3 3 3 3
readableEnded on a prototype put below net.Socket.prototype, POST with the body read: 4 5 5 5 3
readableEnded on a prototype put below net.Socket.prototype, POST with the body read, write(), end(body): 4 5 5 5 3
readableEnded on a prototype put below net.Socket.prototype, POST with the body ignored: 4 4 4 4 3
readableLength on a prototype put below net.Socket.prototype, GET, end(body): 1 1 1 1 0
readableLength on a prototype put below net.Socket.prototype, GET, write(), end(body): 1 1 1 1 0
readableLength on a prototype put below net.Socket.prototype, GET, a content-length, write(), end(): 1 1 1 1 0
readableLength on a prototype put below net.Socket.prototype, POST with the body read: 1 3 3 3 0
readableLength on a prototype put below net.Socket.prototype, POST with the body read, write(), end(body): 1 3 3 3 0
readableLength on a prototype put below net.Socket.prototype, POST with the body ignored: 1 2 2 2 0
readableHighWaterMark on a prototype put below net.Socket.prototype, GET, end(body): 1 2 2 2 0
readableHighWaterMark on a prototype put below net.Socket.prototype, GET, write(), end(body): 1 2 2 2 0
readableHighWaterMark on a prototype put below net.Socket.prototype, GET, a content-length, write(), end(): 1 2 2 2 0
readableHighWaterMark on a prototype put below net.Socket.prototype, POST with the body read: 1 4 4 4 0
readableHighWaterMark on a prototype put below net.Socket.prototype, POST with the body read, write(), end(body): 1 4 4 4 0
readableHighWaterMark on a prototype put below net.Socket.prototype, POST with the body ignored: 1 3 3 3 0
writableHighWaterMark on a prototype put below net.Socket.prototype, GET, end(body): 0 1 1 1 0
writableHighWaterMark on a prototype put below net.Socket.prototype, GET, write(), end(body): 0 2 2 2 0
writableHighWaterMark on a prototype put below net.Socket.prototype, GET, a content-length, write(), end(): 0 2 2 2 0
writableHighWaterMark on a prototype put below net.Socket.prototype, POST with the body read: 0 1 1 1 0
writableHighWaterMark on a prototype put below net.Socket.prototype, POST with the body read, write(), end(body): 0 3 3 3 0
writableHighWaterMark on a prototype put below net.Socket.prototype, POST with the body ignored: 0 1 1 1 0
writableEnded on a prototype put below net.Socket.prototype, GET, end(body): 0 0 0 0 0
writableEnded on a prototype put below net.Socket.prototype, GET, write(), end(body): 0 0 0 0 0
writableEnded on a prototype put below net.Socket.prototype, GET, a content-length, write(), end(): 0 0 0 0 0
writableEnded on a prototype put below net.Socket.prototype, POST with the body read: 0 1 1 1 0
writableEnded on a prototype put below net.Socket.prototype, POST with the body read, write(), end(body): 0 1 1 1 0
writableEnded on a prototype put below net.Socket.prototype, POST with the body ignored: 0 0 0 0 0
`);
  expect(exitCode).toBe(0);
});

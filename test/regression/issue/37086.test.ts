import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/37086
// A pending connect must keep the event loop alive even when the socket was
// unref'd: Node defers the unref until the "connect" event fires.

test.concurrent("net.Socket#unref() before connect() does not exit before the connection completes", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const net = require("node:net");
       const server = net.createServer(() => {});
       server.listen(0, "127.0.0.1", () => {
         const s = new net.Socket();
         s.unref(); // before connect()
         s.connect(server.address().port, "127.0.0.1", () => {
           console.log("CONNECTED");
           s.destroy();
           server.close();
         });
       });
       server.unref();`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("CONNECTED\n");
  expect(exitCode).toBe(0);
});

test.concurrent("net.Socket#unref() while connecting does not exit before the connection completes", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const net = require("node:net");
       const server = net.createServer(() => {});
       server.listen(0, "127.0.0.1", () => {
         const s = new net.Socket();
         s.connect(server.address().port, "127.0.0.1", () => {
           console.log("CONNECTED");
           s.destroy();
           server.close();
         });
         s.unref(); // handle exists, connection still pending
       });
       server.unref();`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("CONNECTED\n");
  expect(exitCode).toBe(0);
});

test.concurrent("net.Socket#ref() after a pre-connect unref() keeps the socket holding the loop", async () => {
  // unref() then ref() before connect: the deferred unref must not win over
  // the later ref(), so the established socket still holds the event loop
  // open until it is destroyed.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const net = require("node:net");
       const server = net.createServer(socket => {
         // Close from the server side once the client is established; the
         // ref'd client must stay alive to observe it.
         socket.end();
       });
       server.listen(0, "127.0.0.1", () => {
         const s = new net.Socket();
         s.unref();
         s.ref();
         s.connect(server.address().port, "127.0.0.1", () => console.log("CONNECTED"));
         s.on("close", () => {
           console.log("CLOSED");
           server.close();
         });
       });
       server.unref();`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("CONNECTED\nCLOSED\n");
  expect(exitCode).toBe(0);
});

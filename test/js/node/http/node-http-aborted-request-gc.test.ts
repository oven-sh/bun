import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import net from "node:net";
import path from "node:path";

// http.Server tracks its connections in a Set: one add() per accepted socket, one delete()
// per closed socket. JSC replaces the Set's table every few operations, and the old table
// keeps a pointer to the new one for iterators. When the engine wrongly keeps one old table
// alive, that table keeps every later table alive, and each of those tables still holds the
// sockets that were in the Set when it was replaced. Each socket holds its IncomingMessage
// and ServerResponse. Nothing in node:http references them.
//
// The client is another process than the server: which Map or Set is hit depends on the
// allocation order in the server process. At most two connections are open at a time. That
// keeps the Set at its initial capacity, where it replaces its table every third connection.
//
// The bug needs the memory layout of a release build: the first table is kept after about
// 400 connections there. Debug and ASAN builds do not have that layout, and 1000 connections
// plus two full collections take longer than the default timeout on them.
test.skipIf(isDebug || isASAN)(
  "http.Server does not keep the sockets and requests of aborted connections alive",
  async () => {
    const total = 1000;

    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "node-http-aborted-request-gc-fixture.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";
    while (!output.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }
    reader.releaseLock();
    const port = Number(output.trim());
    expect(port).toBeGreaterThan(0);

    // Each connection sends a complete request head and goes away before the handler answers.
    // A connection is destroyed once the next one has written its request.
    {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      let previous: net.Socket | undefined;
      let started = 0;
      let closed = 0;
      const next = () => {
        if (started === total) {
          previous?.destroy();
          return;
        }
        started++;
        const socket = net.connect(port, "127.0.0.1", () => {
          socket.write("GET /abort HTTP/1.1\r\nHost: localhost\r\n\r\n", () => {
            previous?.destroy();
            previous = socket;
            next();
          });
        });
        socket.on("error", reject);
        socket.on("close", () => {
          if (++closed === total) resolve();
        });
      };
      next();
      await promise;
    }

    const response = await fetch(`http://127.0.0.1:${port}/report`);
    const report = await response.json();
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect({ handled: report.handled, closed: report.closed }).toEqual({ handled: total, closed: total });
    // A release build with the engine bug keeps about 250 of the 1000 alive.
    expect(report.aliveSockets).toBeLessThan(total / 20);
    expect(report.aliveRequests).toBeLessThan(total / 20);
    expect(exitCode).toBe(0);
  },
);

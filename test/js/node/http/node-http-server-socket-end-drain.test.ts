import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// res.socket.end() half-closes the connection; the server must still drain the
// unconsumed request body so the peer's FIN arrives and server.close() resolves.
// Spawned so the pre-fix hang surfaces as a watchdog exit instead of hanging
// this test file. Only the 2 MB case (fits the kernel send buffer but not the
// first recv) is exercised so the ASAN 2-vCPU lane is not swamped with
// concurrent sanitizer-instrumented subprocesses.
describe.each([2])("server.close() completes after res.socket.end() with %d MB upload in flight", mb => {
  test.concurrent("net client", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          import { once } from "node:events";
          import http from "node:http";
          import net from "node:net";
          let sock;
          const handled = Promise.withResolvers();
          const server = http.createServer((req, res) => {
            res.writeHead(200, { Connection: "close" });
            sock = res.socket;
            res.socket.end();
            try { res.write("x"); } catch {}
            handled.resolve();
          });
          await once(server.listen(0, "127.0.0.1"), "listening");
          const port = server.address().port;
          const c = net.connect(port, "127.0.0.1");
          await once(c, "connect");
          const body = Buffer.alloc(${mb} * 1024 * 1024, 0x61);
          c.write("POST / HTTP/1.1\\r\\nHost: x\\r\\nContent-Length: " + body.length + "\\r\\nConnection: close\\r\\n\\r\\n");
          c.write(body);
          c.on("error", () => {});
          c.on("end", () => c.end());
          const socketClosed = once(c, "close");
          await handled.promise;
          const serverClosed = new Promise(r => server.close(() => r()));
          const watchdog = setTimeout(() => {
            process.stdout.write("timeout destroyed=" + (sock?.destroyed ?? "none") + "\\n");
            process.exit(1);
          }, 10000);
          await Promise.all([socketClosed, serverClosed]);
          clearTimeout(watchdog);
          process.stdout.write("closed destroyed=" + sock.destroyed + "\\n");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "closed destroyed=true\n", stderr: "", exitCode: 0 });
  });

  test.concurrent("fetch client", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          import { once } from "node:events";
          import http from "node:http";
          let sock;
          const server = http.createServer((req, res) => {
            res.writeHead(200, { Connection: "close" });
            sock = res.socket;
            res.socket.end();
            try { res.write("x"); } catch {}
          });
          await once(server.listen(0, "127.0.0.1"), "listening");
          await fetch("http://127.0.0.1:" + server.address().port, {
            method: "POST",
            body: Buffer.alloc(${mb} * 1024 * 1024, 0x61),
          }).then(r => r.bytes()).catch(() => {});
          const serverClosed = new Promise(r => server.close(() => r()));
          const watchdog = setTimeout(() => {
            process.stdout.write("timeout destroyed=" + (sock?.destroyed ?? "none") + "\\n");
            process.exit(1);
          }, 10000);
          await serverClosed;
          clearTimeout(watchdog);
          process.stdout.write("closed destroyed=" + sock.destroyed + "\\n");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "closed destroyed=true\n", stderr: "", exitCode: 0 });
  });
});

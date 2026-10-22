import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isCI, isDebug, isWindows, tempDir, tls as tlsCert } from "harness";
import { join } from "node:path";

// When nothing handles the error of a 'connection' or 'secureConnection' listener, Node.js exits
// at the throw. Bun exits after the turn of the loop, and does not answer that connection before
// it. When something handles the error, the connection stays and its request is answered.
//
// The fixture is the server and its peers. It runs unchanged under Node.js.
describe.concurrent("an http server whose connection listener throws", () => {
  const fixture = join(import.meta.dir, "node-http-connection-listener-throw-fixture.js");
  // CI has its own time for each test. A local debug or ASAN build needs several seconds to start one process.
  const timeout = (isASAN || isDebug) && !isCI ? 90_000 : undefined;
  // A Worker with a server leaks the request pool of its thread (#37513). The stack of that
  // allocation reaches a frame that test/leaksan.supp names only beyond the 30 frames of CI.
  const workerEnv = { LSAN_OPTIONS: [bunEnv.LSAN_OPTIONS, "malloc_context_size=100"].filter(Boolean).join(":") };

  const refused = { requests: 0, served: 0, read: [0], exit: 1 };
  const answered = { requests: 1, served: 1, read: [100], exit: 0 };
  const expected: Record<string, object> = {
    // What Node.js v26.3.0 prints for the same case.
    // Two peers wait in the accept queue, with their requests sent.
    "http": { ...refused, read: [0, 0] },
    // Node.js emits 'connection' before the TLS handshake, Bun after it. The peer reads the same.
    "https": refused,
    "https-secureConnection": refused,
    "http-nextTick": refused,
    "http-queueMicrotask": refused,
    "http-monitor": refused,
    // The loop has more to do after the error, so the request is read without a deferred accept too.
    "http-immediate": refused,
    // The listener writes a 403 before it throws, and the peer reads that. The close behind it is
    // a reset, because the request is not read, and on Windows a reset can discard the 403.
    "http-writes": { ...refused, read: [isWindows ? expect.any(Number) : 45] },
    // The close waits for what the peer has not taken, and the request behind it is not answered.
    "https-secureConnection-writes-big-unread": { ...refused, read: [expect.any(Number)] },
    "http-handled": answered,
    "https-secureConnection-handled": answered,
    "http-captured": answered,
    "http-exits": { ...refused, exit: 3 },
    // The listener refuses with socket.destroy() and throws nothing.
    "http-destroys": { ...refused, exit: 0 },
    // The listener closes the socket itself before it throws.
    "http-destroyed": refused,
    "https-secureConnection-destroyed": refused,
    "http-ends": { ...refused, read: [isWindows ? expect.any(Number) : 45] },
    "worker:http": { ...refused, exit: 0 },
    "worker:http-nextTick": { ...refused, exit: 0 },

    // Not what Node.js prints. Its Worker ends behind the read that holds the request of this
    // peer, and answers it. Without TLS 1.3 it does not.
    "worker:https-secureConnection": { ...refused, exit: 0 },
    // The process stays up, and the driver stops it.
    "hot:http": { ...refused, exit: "SIGTERM" },
    "hot:https-secureConnection": { ...refused, exit: "SIGTERM" },
    // The request comes in a later read than the end of the handshake.
    "hot:https-secureConnection-tls12": { ...refused, exit: "SIGTERM" },
    "watch:http": { ...refused, exit: "SIGTERM" },
  };

  test.each(Object.keys(expected))(
    "%s",
    async name => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), fixture, name],
        env: { ...bunEnv, TLS_FIXTURE: JSON.stringify(tlsCert), ...(name.startsWith("worker:") && workerEnv) },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({
        result: stdout ? JSON.parse(stdout) : undefined,
        stderr,
        exitCode,
        signalCode: proc.signalCode,
      }).toEqual({
        result: expected[name],
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
    timeout,
  );

  // `bun test` takes the error as the failure of the test that runs, so the connection stays.
  // It starts the next test from inside the report of the error. When that test keeps the loop
  // to itself, the server of the failed test is closed, collected and freed before the report
  // returns to the frame that ran the listener.
  test(
    "under bun test",
    async () => {
      using dir = tempDir("connection-listener-throw", {
        "listener.test.js": `
          import { expect, test } from "bun:test";
          import http from "node:http";
          import net from "node:net";

          // A server whose connection listener throws, and one peer of it.
          async function refusedPeer() {
            const server = http.createServer((req, res) => res.end("SECRET"));
            server.on("connection", () => {
              throw new Error("PEER REFUSED");
            });
            await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
            let read = "";
            await new Promise(resolve => {
              const peer = net.connect(server.address().port, "127.0.0.1", () =>
                peer.write("GET / HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n"),
              );
              peer.setEncoding("utf8");
              peer.on("data", chunk => (read += chunk));
              peer.on("error", () => {});
              peer.on("close", resolve);
            });
            console.log("READ " + read.length);
            await new Promise(resolve => server.close(resolve));
          }

          let first;
          let second;
          const blocks = [];
          test("a connection listener throws", () => (first = refusedPeer()));
          test("the next test gives the loop back", () => first);
          // Not on Windows: the wait below runs inside the open callback of the connection that it waits for, and does not always end there (#33261).
          const posix = test.skipIf(process.platform === "win32");
          posix("a connection listener throws again", () => (second = refusedPeer()));
          posix("the next test keeps the loop", () => {
            expect(
              (async () => {
                await second;
                Bun.gc(true);
                await new Promise(resolve => setImmediate(resolve));
                await new Promise(resolve => setImmediate(resolve));
                // Blocks of the size of the freed server: a read of it finds them.
                for (let i = 0; i < 4096; i++) blocks.push(Bun.allocUnsafe(1700).fill(0x41));
                return blocks.length;
              })(),
            ).resolves.toBe(4096);
          });
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "./listener.test.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({
        read: stdout.match(/^READ \d+$/gm),
        summary: stderr.match(/^ *\d+ (?:pass|fail)$/gm)?.map(line => line.trim()),
        exitCode,
        signalCode: proc.signalCode,
      }).toEqual({
        read: isWindows ? ["READ 100"] : ["READ 100", "READ 100"],
        summary: isWindows ? ["1 pass", "1 fail"] : ["2 pass", "2 fail"],
        exitCode: 1,
        signalCode: null,
      });
    },
    timeout,
  );
});

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isCI, isDebug, isWindows, tls as tlsCert } from "harness";
import { join } from "node:path";

// A 'connection' or 'secureConnection' listener of an http server throws, for example an
// allow-list that asserts on socket.remoteAddress. When nothing handles the error, the peer that
// the listener refused reads nothing of a response, and the process exits with 1. When something
// handles it, the connection stays and its request is answered.
//
// The fixture is the server and its peers. It runs unchanged under Node.js.
describe.concurrent("an http server whose connection listener throws", () => {
  const fixture = join(import.meta.dir, "node-http-connection-listener-throw-fixture.js");
  // CI has its own time for each test. A local debug or ASAN build needs several seconds to start one process.
  const timeout = (isASAN || isDebug) && !isCI ? 90_000 : undefined;

  const refused = { served: 0, read: [0], exit: 1 };
  const answered = { served: 1, read: [100], exit: 0 };
  const expected: Record<string, object> = {
    // What Node.js v26.3.0 prints for the same case.
    // Two peers wait in the accept queue, with their requests sent.
    "http": { ...refused, read: [0, 0] },
    "https": refused,
    "https-secureConnection": refused,
    "http-nextTick": refused,
    "http-queueMicrotask": refused,
    "http-monitor": refused,
    // The listener writes a 403 before it throws, and the peer reads that. The close behind it is
    // a reset, because the request is not read, and on Windows a reset can discard the 403.
    "http-writes": { ...refused, read: [isWindows ? expect.any(Number) : 45] },
    // More than the socket takes at once. The peer reads some of it, and no response behind it.
    "https-writes-big": { ...refused, read: [expect.any(Number)] },
    "http-handled": answered,
    "https-secureConnection-handled": answered,
    "http-captured": answered,
    "http-exits": { ...refused, exit: 3 },
    // The listener refuses with socket.destroy() and throws nothing.
    "http-destroys": { ...refused, exit: 0 },
    "worker:http": { ...refused, exit: 0 },

    // Not what Node.js prints. Its Worker ends behind the read that holds the request of this
    // peer, and answers it. Without TLS 1.3 it does not.
    "worker:https-secureConnection": { ...refused, exit: 0 },
    // The process stays up, and the driver stops it.
    "hot:http": { ...refused, exit: "SIGTERM" },
    "hot:https-secureConnection": { ...refused, exit: "SIGTERM" },
    "watch:http": { ...refused, exit: "SIGTERM" },
  };

  test.each(Object.keys(expected))(
    "%s",
    async name => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), fixture, name],
        env: { ...bunEnv, TLS_FIXTURE: JSON.stringify(tlsCert) },
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
});

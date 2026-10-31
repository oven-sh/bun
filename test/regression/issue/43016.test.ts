import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/43016
// The dev-mode idle timeout warning is meant to print once per process. The
// HTTP/1 path and the HTTP/2 and HTTP/3 path each had their own once flag and
// their own text, so a process that timed out one request on each protocol
// printed the warning twice.
//
// The warning is only registered when `idleTimeout` is not passed, so the
// test has to wait for the default 10 second timeout on both connections.
// That is longer than the default per-test timeout, so this test sets one.
test("Bun.serve prints the idle timeout warning once for HTTP/1 and HTTP/2 timeouts", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import http2 from "node:http2";
      import net from "node:net";

      const seen = [];
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        development: true,
        http2: true,
        async fetch(req) {
          seen.push(req.headers.get("x-proto"));
          await req.text();
          return new Response("ok");
        },
      });

      // The server closes each connection when its idle timeout fires. The
      // request count proves that both requests reached the handler before
      // that, so a client that failed early cannot pass as a timeout.
      let remaining = 2;
      function done() {
        if (--remaining === 0) {
          console.log("both closed, requests seen: " + seen.sort().join(","));
          process.exit(0);
        }
      }

      // HTTP/1: a POST whose body never completes.
      const h1 = net.connect(server.port, "127.0.0.1", () => {
        h1.write("POST / HTTP/1.1\\r\\nHost: x\\r\\nX-Proto: h1\\r\\nContent-Length: 100\\r\\n\\r\\nabc");
      });
      h1.on("error", () => {});
      h1.on("close", done);

      // HTTP/2 (cleartext, prior knowledge): a POST stream that never ends.
      const session = http2.connect("http://127.0.0.1:" + server.port);
      session.on("error", () => {});
      session.on("close", done);
      const stream = session.request({ ":method": "POST", ":path": "/", "x-proto": "h2" });
      stream.on("error", () => {});
      stream.write("abc");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("both closed, requests seen: h1,h2\n");
  const warning = "warn: Bun.serve() timed out a request after 10 seconds. Pass `idleTimeout` to configure.";
  expect(stderr.split(warning).length - 1).toBe(1);
  expect(stderr).not.toContain("[Bun.serve]: request timed out");
  expect(exitCode).toBe(0);
}, 30_000);

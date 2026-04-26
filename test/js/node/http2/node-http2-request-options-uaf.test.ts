import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

// H2FrameParser.request() previously obtained a *Stream pointer into the
// streams HashMap and then called options.get(...) (which performs a full
// JS [[Get]] including accessor getters / Proxy traps) while holding that
// pointer. A getter that re-entered session.request() could insert new
// streams, rehash the map, and leave the outer call writing through a
// dangling pointer (heap-use-after-free under ASAN).
//
// The fix reads all option properties into locals before acquiring the
// *Stream, so no user JS runs while the HashMap pointer is held.
//
// This test only runs under sanitizer builds (debug/asan) where the UAF is
// deterministically caught; on release builds without ASAN the corruption
// is silent and the test would not reliably exercise the bug.
test.skipIf(!isDebug && !isASAN)(
  "http2 client request() does not hold *Stream across user-controlled options getters",
  async () => {
    const script = /* js */ `
    const http2 = require("node:http2");

    const server = http2.createServer();
    server.on("stream", (stream) => {
      stream.respond({ ":status": 200 });
      stream.end();
    });
    server.on("error", () => {});

    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const client = http2.connect("http://127.0.0.1:" + port);
      client.on("error", () => {});

      client.on("connect", () => {
        let triggered = false;

        // Use a POST so the options object is passed through to the native
        // parser without being shallow-copied.
        const options = {
          get paddingStrategy() {
            if (!triggered) {
              triggered = true;
              // Insert enough new streams to force the HashMap to rehash,
              // invalidating any *Stream pointer held by the outer request().
              for (let i = 0; i < 128; i++) {
                const r = client.request({ ":path": "/", ":method": "GET" });
                r.on("error", () => {});
                r.on("response", () => {});
                r.resume();
              }
            }
            return 0;
          },
          // Ensure the outer request writes through the (previously dangling)
          // stream pointer after the getter returns.
          exclusive: true,
          parent: 1,
          weight: 16,
          waitForTrailers: false,
          endStream: true,
        };

        const req = client.request({ ":path": "/", ":method": "POST" }, options);
        req.on("error", () => {});
        req.on("response", () => {});
        req.resume();
        req.on("close", () => {
          client.close(() => {
            server.close(() => {
              if (!triggered) {
                console.error("getter was never invoked");
                process.exit(1);
              }
              console.log("done");
              process.exit(0);
            });
          });
        });
        req.end();
      });
    });
  `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // On failure the subprocess aborts with an AddressSanitizer report in
    // stderr and never prints "done". stderr is not asserted directly because
    // sanitizer builds emit a benign startup warning even on success.
    if (exitCode !== 0) console.error(stderr);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "done", exitCode: 0 });
  },
);

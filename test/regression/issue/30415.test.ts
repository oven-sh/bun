// https://github.com/oven-sh/bun/issues/30415
//
// Sustained `http2.connect()` session reuse (e.g. AWS SDK v3 Kinesis
// GetRecords) leaked native RSS at ~380 MB/hour on Bun because
// `H2FrameParser.streams` never dropped entries for closed streams —
// every `session.request()` added a `*Stream` and only a full session
// teardown freed them. Node reclaims stream state on close and stays flat.
//
// This test opens a real HTTP/2 loopback, runs many sequential requests
// through a single session, then inspects `session.state.streamCount` —
// the native count of tracked streams. Before the fix it grew linearly
// with request count; after the fix it drops back to zero (or a tiny
// transient count for the most recently closed stream).
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.concurrent("http2 session does not retain closed streams", async () => {
  const script = /* js */ `
    const http2 = require("node:http2");

    const server = http2.createServer();
    server.on("stream", stream => {
      stream.respond({ ":status": 200 });
      stream.end();
    });

    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const client = http2.connect("http://127.0.0.1:" + port);

      client.on("connect", async () => {
        const ITERATIONS = 50;
        for (let i = 0; i < ITERATIONS; i++) {
          await new Promise((resolve, reject) => {
            const req = client.request({ ":path": "/", ":method": "GET" });
            req.on("error", reject);
            req.on("close", resolve);
            req.resume();
            req.end();
          });
        }
        // Give the event loop a chance to settle any setImmediate(rstNextTick).
        for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));

        const state = client.state;
        const retained = state.streamCount;
        const lastId = state.lastProcStreamID;
        // lastProcStreamID grows by 2 per client-initiated request. Confirm
        // we actually made it through all ITERATIONS (otherwise a low
        // streamCount could be a false negative).
        if (lastId < ITERATIONS * 2 - 1) {
          console.error("only completed", lastId, "requests");
          process.exit(1);
        }
        // Before the fix: retained grows with ITERATIONS. After the fix it
        // should be 0 (or 1 if the last stream's setImmediate rstNextTick
        // hasn't run yet), which stays stable regardless of ITERATIONS.
        if (retained > 4) {
          console.error("retained", retained, "closed streams after", ITERATIONS, "requests");
          process.exit(2);
        }
        console.log("ok retained=" + retained + " lastId=" + lastId);
        client.close(() => server.close(() => process.exit(0)));
      });

      client.on("error", err => {
        console.error("client error:", err?.message || err);
        process.exit(99);
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
  // Don't pin stderr to "" — ASAN and other diagnostic builds may emit
  // benign lines there. The test only cares about stdout + exit code; the
  // stderr value is still included in the failure object so a real crash
  // shows up in the diff.
  expect({ stderr, stdout: stdout.trim().split("\n").pop(), exitCode }).toMatchObject({
    stdout: expect.stringMatching(/^ok retained=\d+ lastId=\d+$/),
    exitCode: 0,
  });
});

// Regression for the UAF that landed alongside the stream-reclamation fix:
// `sendData`'s defer block dispatches the write callback before reading
// `stream.state` / `stream.waitForTrailers` / `stream.getIdentifier()`. If
// that write callback synchronously aborts the stream's AbortSignal, the
// native listener runs inline — `SignalRef.abortListener` → `abortStream` →
// `removeStreamByID` → `bun.destroy(stream)` — and the dereferences in the
// defer become use-after-free. ASAN would trip here before the fix; release
// builds would silently read reused heap memory.
test.concurrent("http2 write callback aborting the signal does not UAF the stream", async () => {
  const script = /* js */ `
    const http2 = require("node:http2");

    const server = http2.createServer();
    server.on("stream", stream => {
      stream.respond({ ":status": 200 });
      // Drain any body the client writes so the peer-level flow stays sane.
      stream.on("data", () => {});
      stream.on("end", () => stream.end());
      stream.on("error", () => {});
    });

    server.listen(0, "127.0.0.1", async () => {
      const port = server.address().port;
      const client = http2.connect("http://127.0.0.1:" + port);
      client.on("error", err => {
        console.error("client error:", err?.message || err);
        process.exit(99);
      });
      await new Promise(r => client.on("connect", r));

      const ITERATIONS = 20;
      for (let i = 0; i < ITERATIONS; i++) {
        const ac = new AbortController();
        await new Promise(resolve => {
          const req = client.request(
            { ":path": "/", ":method": "POST" },
            { signal: ac.signal },
          );
          req.on("error", () => {});
          req.on("close", resolve);
          req.on("response", () => {});
          req.resume();
          // Writable 'finish' fires synchronously from inside the internal
          // callback that _final passes to native.writeStream(..., close=true).
          // sendData's defer dispatches that callback before reading the
          // stream's state/waitForTrailers/identifier — aborting the attached
          // AbortSignal here runs SignalRef.abortListener synchronously,
          // which reaches abortStream → removeStreamByID → bun.destroy
          // before the defer is done.
          req.on("finish", () => ac.abort());
          req.end("x");
        });
      }

      for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
      console.log("ok");
      client.close(() => server.close(() => process.exit(0)));
    });
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, stdout: stdout.trim().split("\n").pop(), exitCode }).toMatchObject({
    stdout: "ok",
    exitCode: 0,
  });
});

// Same UAF class, different entry point. `stream.priority({...})` and
// `stream.sendTrailers({...})` hand a user-controlled object straight to
// native code, which reads `options.get("weight")` / `options.get("parent")`
// etc. A property getter / Proxy trap on that object can synchronously
// `AbortController.abort()`, which fires `SignalRef.abortListener` inline
// → `abortStream` → `removeStreamByID` → `bun.destroy(stream)`. The native
// code then continues reading and writing `stream.*` on the freed
// allocation. Before the fix a release build would silently corrupt the
// heap; an ASAN build crashes.
test.concurrent("http2 priority options getter aborting the signal does not UAF", async () => {
  const script = /* js */ `
    const http2 = require("node:http2");

    const server = http2.createServer();
    server.on("stream", stream => {
      // Don't end immediately — keep the stream open long enough for the
      // client to call priority() on it.
      setImmediate(() => {
        stream.respond({ ":status": 200 });
        stream.end();
      });
    });

    server.listen(0, "127.0.0.1", async () => {
      const port = server.address().port;
      const client = http2.connect("http://127.0.0.1:" + port);
      client.on("error", () => {});
      await new Promise(r => client.on("connect", r));

      const ITERATIONS = 10;
      for (let i = 0; i < ITERATIONS; i++) {
        const ac = new AbortController();
        await new Promise(resolve => {
          const req = client.request(
            { ":path": "/", ":method": "GET" },
            { signal: ac.signal },
          );
          req.on("error", () => {});
          req.on("close", resolve);
          req.on("response", () => {
            // Call priority() with an options object whose "weight" getter
            // synchronously aborts the AbortSignal. The native
            // setStreamPriority reads options.get("weight") first, then
            // proceeds to write stream.streamDependency / stream.exclusive
            // / stream.weight — on freed memory before this fix.
            try {
              req.priority({
                get weight() {
                  ac.abort();
                  return 16;
                },
                parent: 3,
                exclusive: false,
                silent: false,
              });
            } catch {}
          });
          req.resume();
          req.end();
        });
      }

      for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
      console.log("ok");
      client.close(() => server.close(() => process.exit(0)));
    });
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, stdout: stdout.trim().split("\n").pop(), exitCode }).toMatchObject({
    stdout: "ok",
    exitCode: 0,
  });
});

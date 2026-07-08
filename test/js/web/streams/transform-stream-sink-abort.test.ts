// When the readable half of a TransformStream is consumed by a Bun native sink
// (Bun.serve response body, Bun.spawn stdin) and that sink aborts, the pump
// teardown used to null the stream's controller slot. A still-pending async
// transform() then called controller.enqueue() and dereferenced a null
// controller: a debug ASSERT / release segfault.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test.concurrent("Bun.serve: client abort while async transform() is pending does not crash", async () => {
  using dir = tempDir("transform-sink-abort-serve", {
    "index.ts": `
      import net from "node:net";
      import { once } from "node:events";
      let resolveGate: () => void;
      const gate = new Promise<void>(r => (resolveGate = r));
      let enqueueResult = "not reached";
      let readable: ReadableStream | undefined;
      const srv = Bun.serve({
        hostname: "127.0.0.1", port: 0, idleTimeout: 0,
        async fetch(req) {
          if (!req.body) return new Response("nobody");
          const ts = new TransformStream({
            async transform(ch, c) {
              await gate;
              try {
                c.enqueue(ch);
                enqueueResult = "ok";
              } catch (e) {
                enqueueResult = "threw " + (e as Error)?.constructor?.name;
              }
            },
          });
          readable = req.body.pipeThrough(ts);
          return new Response(readable);
        },
        error() { return new Response("error"); },
      });
      const s = net.connect(srv.port, "127.0.0.1");
      await once(s, "connect");
      s.write("POST / HTTP/1.1\\r\\nhost: x\\r\\ncontent-length: 100000\\r\\n\\r\\n");
      s.write(Buffer.alloc(1024, 66));
      s.on("data", () => {});
      s.on("error", () => {});
      // Wait for the server to start pumping the response body (locks ts.readable).
      while (!readable || !readable.locked) await new Promise(r => setImmediate(r));
      s.destroy();
      // Wait for the pump to tear down ts.readable (it releases the reader).
      while (readable.locked) await new Promise(r => setImmediate(r));
      resolveGate!();
      await Promise.resolve();
      await Promise.resolve();
      srv.stop(true);
      console.log("SURVIVED", enqueueResult);
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  // The readable is closed by the pump teardown, so enqueue must throw a TypeError.
  expect({ stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "SURVIVED threw TypeError",
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

test.concurrent("Bun.spawn stdin: child exit while async transform() is pending does not crash", async () => {
  using dir = tempDir("transform-sink-abort-spawn", {
    "index.ts": `
      let resolvePending: () => void;
      const pending = new Promise<void>(r => (resolvePending = r));
      let enqueueResult = "not reached";
      const ts = new TransformStream({
        async transform(chunk, controller) {
          await pending;
          try {
            controller.enqueue(chunk);
            enqueueResult = "ok";
          } catch (e) {
            enqueueResult = "threw " + (e as Error)?.constructor?.name;
          }
        },
      });
      const proc = Bun.spawn({
        cmd: [process.execPath, "-e", ""],
        stdin: ts.readable,
        stdout: "ignore",
        stderr: "ignore",
      });
      const writer = ts.writable.getWriter();
      writer.write(new Uint8Array(1024)).catch(() => {});
      await proc.exited;
      // Wait for the pump to tear down ts.readable (it releases the reader).
      while (ts.readable.locked) await new Promise(r => setImmediate(r));
      resolvePending!();
      await Promise.resolve();
      await Promise.resolve();
      console.log("SURVIVED", enqueueResult);
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  // The readable is closed by the pump teardown, so enqueue must throw a TypeError.
  expect({ stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "SURVIVED threw TypeError",
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

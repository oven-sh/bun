import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/20965
// StreamTransfer.onAborted set has_ended_response=true before finish(), so
// route.onResponseComplete() was skipped and pending_requests was never
// decremented — server.stop() would hang after any aborted file stream.
test("aborting a streaming file response mid-transfer does not leak pending_requests (server.stop resolves)", async () => {
  using dir = tempDir("file-route-abort", {
    "fixture.ts": /* ts */ `
      import { connect } from "node:net";
      import { writeFileSync } from "node:fs";
      import { join } from "node:path";

      const big = join(import.meta.dir, "big.bin");
      writeFileSync(big, Buffer.alloc(5 * 1024 * 1024));

      using server = Bun.serve({
        port: 0,
        routes: { "/big": new Response(Bun.file(big)) },
        fetch: () => new Response("unreachable"),
      });

      // Raw TCP: send GET, receive first chunk, then drop the socket. The 5MB
      // body fills the kernel send buffer so StreamTransfer is paused on
      // backpressure when onAborted fires.
      await new Promise<void>((resolve, reject) => {
        const sock = connect({ port: server.port, host: "127.0.0.1" }, () => {
          sock.write("GET /big HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n");
          sock.once("data", () => {
            sock.destroy();
            resolve();
          });
        });
        sock.on("error", reject);
      });

      const result = await Promise.race([
        server.stop().then(() => "stopped"),
        Bun.sleep(2000).then(() => "HUNG: pending_requests was never decremented"),
      ]);
      console.log(result);
      process.exit(result === "stopped" ? 0 : 1);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(normalizeBunSnapshot(stdout)).toBe("stopped");
  expect(exitCode).toBe(0);
});

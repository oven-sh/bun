import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { createServer } from "node:net";
import { once } from "node:events";

// Drives FetchTasklet::callback through the on_timeout -> fail ->
// dispatch_result_and_reset path that produced the highest-volume
// Option::unwrap panic on `task.http` in 1.4.0 crash telemetry.
test("socket idle timeout delivers a Timeout rejection via FetchTasklet::callback", async () => {
  // Raw TCP server that accepts and never writes: the HTTP client's idle
  // timer is the only thing that ends the request on the HTTP-thread side.
  const server = createServer(socket => {
    socket.on("error", () => {});
  });
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as import("node:net").AddressInfo;

  try {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const url = "http://127.0.0.1:${port}/";
          // Run a batch so several ThreadlocalAsyncHTTP clones live on the
          // HTTP thread concurrently when the idle timer sweep fires.
          const results = await Promise.all(
            Array.from({ length: 16 }, () =>
              fetch(url).then(
                () => "resolved",
                err => err?.name ?? String(err),
              ),
            ),
          );
          for (const r of results) {
            if (r !== "TimeoutError") {
              throw new Error("expected TimeoutError, got " + r);
            }
          }
          console.log("ok");
        `,
      ],
      env: {
        ...bunEnv,
        BUN_CONFIG_HTTP_IDLE_TIMEOUT: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

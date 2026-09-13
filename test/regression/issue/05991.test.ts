// https://github.com/oven-sh/bun/issues/5991
// spawnSync with a streaming fetch Response as stdin threw
// "ReadableStream cannot be used in sync mode" (and before that, truncated
// the body). It should buffer the body and deliver all of it to the child.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("spawnSync stdin: streaming fetch Response delivers the full body", async () => {
  const total = 256 * 1024;
  await using server = Bun.serve({
    port: 0,
    fetch() {
      let sent = 0;
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(c: any) {
            const chunk = Buffer.alloc(64 * 1024, "x");
            while (sent < total) {
              c.write(chunk);
              await c.flush();
              sent += chunk.length;
            }
            c.close();
          },
        }),
        { headers: { "Content-Type": "application/octet-stream" } },
      );
    },
  });

  const res = await fetch(server.url);
  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [
      bunExe(),
      "-e",
      `let n = 0; for await (const c of process.stdin) n += c.length; process.stdout.write(String(n));`,
    ],
    stdin: res,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  expect(stderr.toString()).toBe("");
  expect(stdout.toString()).toBe(String(total));
  expect(exitCode).toBe(0);
});

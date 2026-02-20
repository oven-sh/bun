import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/17048
// Breaking from a `for await` loop over a response body should abort
// the underlying HTTP connection and allow the process to exit promptly.
test("breaking from for-await over response.body exits promptly", async () => {
  // Start a server that streams data slowly over ~3 seconds
  using server = Bun.serve({
    port: 0,
    async fetch() {
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode("hello "));
          for (let i = 0; i < 3; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            controller.enqueue(new TextEncoder().encode("world "));
          }
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "text/plain" },
      });
    },
  });

  // The client breaks after the first chunk, then the process should exit
  // naturally without waiting for the full stream.
  const script = `
    const response = await fetch("http://localhost:${server.port}");
    for await (const chunk of response.body) {
      break;
    }
  `;

  const start = Date.now();

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [exitCode, stderr] = await Promise.all([proc.exited, proc.stderr.text()]);
  const elapsed = Date.now() - start;

  if (exitCode !== 0) {
    console.error("stderr:", stderr);
  }

  // The process should exit well within 2 seconds.
  // Before the fix, it would wait ~3+ seconds for the slow stream to finish.
  expect(elapsed).toBeLessThan(2000);
  expect(exitCode).toBe(0);
}, 10_000);

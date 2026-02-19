import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/26395
// Bun.write(file, Response) fails silently when the Response body is still being downloaded.
// The issue was that when the Response JS object gets garbage collected before the body finishes
// downloading, the finalizer would incorrectly ignore the remaining body because it only checked
// for `promise` being set, but Bun.write sets `onReceiveValue` instead.

test("Bun.write should complete when writing a Response with a locked body", async () => {
  using dir = tempDir("issue-26395", {
    "test.js": `
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          // Create a response with a streaming body that takes time to complete
          const stream = new ReadableStream({
            async start(controller) {
              // Send data in chunks with small delays to simulate a slow download
              for (let i = 0; i < 10; i++) {
                controller.enqueue(new TextEncoder().encode("chunk" + i + "\\n"));
                await Bun.sleep(20);
              }
              controller.close();
            }
          });
          return new Response(stream, {
            headers: { "Content-Type": "text/plain" }
          });
        }
      });

      const outputPath = Bun.argv[2];

      async function triggerBug() {
        const res = await fetch(server.url);

        // Start the write operation (sets onReceiveValue on the Response body)
        // but don't await it yet - the response body is now "locked"
        const writePromise = Bun.write(outputPath, res);

        // Force GC aggressively to try to collect the Response object
        // while the body is still being downloaded
        for (let i = 0; i < 10; i++) {
          Bun.gc(true);
          await Bun.sleep(10);
        }

        return writePromise;
      }

      await triggerBug();

      // Verify the file was written completely
      const content = await Bun.file(outputPath).text();
      const expectedContent = Array.from({ length: 10 }, (_, i) => "chunk" + i + "\\n").join("");

      if (content !== expectedContent) {
        console.error("FAIL: Content mismatch");
        console.error("Expected:", JSON.stringify(expectedContent));
        console.error("Got:", JSON.stringify(content));
        process.exit(1);
      }

      console.log("SUCCESS");
      server.stop();
    `,
  });

  const outputPath = `${dir}/downloaded.txt`;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js", outputPath],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("SUCCESS");
  expect(exitCode).toBe(0);
});

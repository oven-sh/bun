import { spawn } from "bun";
import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/2499
it("onAborted() and onWritable are not called after receiving an empty response body due to a promise rejection", async testDone => {
  var timeout = AbortSignal.timeout(10_000);
  timeout.onabort = e => {
    testDone(new Error("Test timed out, which means it failed"));
  };

  const invalidJSON = Buffer.from("invalid json");

  // We want to test that the server isn't keeping the connection open in a
  // zombie-like state when an error occurs due to an unhandled rejected promise
  //
  // At the time of writing, this can only happen when:
  // - development mode is enabled
  // - the server didn't send the complete response body in one send()
  // - renderMissing() is called
  //
  // In that case, it finalizes the response in the middle of an incomplete body
  //
  // On an M1, this reproduces 1 out of every 4 calls to this function
  // It's inherently going to be flaky without simulating system calls or overriding libc
  //
  // So to make sure we catch it
  // 1) Run this test 40 times
  // 2) Set a timeout for this test of 10 seconds.
  //
  // In debug builds, this test should complete in 1-2 seconds.
  for (let i = 0; i < 40; i++) {
    let bunProcess;
    try {
      bunProcess = spawn({
        cmd: [bunExe(), "run", join(import.meta.dir, "./02499.fixture.ts")],
        stdin: "pipe",
        stderr: "ignore",
        stdout: "pipe",
        env: bunEnv,
      });

      const reader = bunProcess.stdout.getReader();
      let hostname, port;
      {
        const chunks: Buffer[] = [];
        var decoder = new TextDecoder();
        while (!hostname && !port) {
          var { value, done } = await reader.read();
          if (done) break;
          if (chunks.length > 0) {
            chunks.push(value!);
          }
          try {
            if (chunks.length > 0) {
              value = Buffer.concat(chunks);
            }

            ({ hostname, port } = JSON.parse(decoder.decode(value).trim()));
          } catch {
            chunks.push(value!);
          }
        }
      }

      try {
        await fetch(`http://${hostname}:${port}/upload`, {
          body: invalidJSON,
          keepalive: false,
          method: "POST",
          timeout: true,
          signal: timeout,
        });
      } catch (e) {}

      bunProcess.stdin?.write("--CLOSE--");
      await bunProcess.stdin?.flush();
      await bunProcess.stdin?.end();
      expect(await bunProcess.exited).toBe(0);
    } catch (e) {
      timeout.onabort = () => {};
      testDone(e);
      throw e;
    } finally {
      bunProcess?.kill(9);
    }
  }
  timeout.onabort = () => {};
  testDone();
}, 30_000);

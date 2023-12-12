import { expect, it } from "bun:test";
import { bunExe, bunEnv } from "../../harness.js";
import { mkdirSync, rmSync, writeFileSync, readFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { sleep, spawn, spawnSync, which } from "bun";
import { StringDecoder } from "node:string_decoder";
// https://github.com/oven-sh/bun/issues/2499
it("onAborted() and onWritable are not called after receiving an empty response body due to a promise rejection", async testDone => {
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
        cmd: [bunExe(), "run", join(import.meta.dir, "./02499-repro.ts")],
        stdin: "pipe",
        stderr: "inherit",
        stdout: "pipe",
        env: bunEnv,
      });

      const reader = bunProcess.stdout.getReader();
      let hostname, port;
      var text = "";
      {
        var decoder = new StringDecoder();
        while (!hostname && !port) {
          var { value, done } = await reader.read();
          if (done) break;
          text = decoder.write(value!);
          try {
            ({ hostname, port } = JSON.parse(text.trim()));
          } catch {}
        }
      }

      try {
        await fetch(`http://${hostname}:${port}/upload`, {
          body: invalidJSON,
          keepalive: false,
          method: "POST",
          timeout: true,
        });
      } catch (e) {}

      const wrote = bunProcess.stdin?.write("--CLOSE--");
      await bunProcess.stdin?.flush();
      await bunProcess.stdin?.end();
      expect(await bunProcess.exited).toBe(0);
      console.count("Completed");
    } catch (e) {
      testDone(e);
      throw e;
    } finally {
      bunProcess?.kill(9);
    }
  }
  testDone();
}, 60_000);

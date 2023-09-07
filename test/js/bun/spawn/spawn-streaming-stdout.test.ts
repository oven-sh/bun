import { it, test, expect } from "bun:test";
import { spawn } from "bun";
import { bunExe, bunEnv, gcTick } from "harness";
import { closeSync, openSync } from "fs";

test("spawn can read from stdout multiple chunks", async () => {
  gcTick(true);
  const maxFD = openSync("/dev/null", "w");
  closeSync(maxFD);

  for (let i = 0; i < 10; i++)
    await (async function () {
      var exited;
      const proc = spawn({
        cmd: [bunExe(), import.meta.dir + "/spawn-streaming-stdout-repro.js"],
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
        env: bunEnv,
      });
      var chunks = [];
      let counter = 0;
      try {
        for await (var chunk of proc.stdout) {
          chunks.push(chunk);
          counter++;
          if (counter > 3) break;
        }
      } catch (e: any) {
        console.log(e.stack);
        throw e;
      }
      expect(counter).toBe(4);
      // TODO: fix bug with returning SIGHUP instead of exit code 1
      proc.kill();
      expect(Buffer.concat(chunks).toString()).toBe("Wrote to stdout\n".repeat(4));
    })();

  const newMaxFD = openSync("/dev/null", "w");
  closeSync(newMaxFD);
  expect(newMaxFD).toBe(maxFD);
});

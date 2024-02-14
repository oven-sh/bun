// @known-failing-on-windows: 1 failing
import { it, test, expect } from "bun:test";
import { spawn } from "bun";
import { bunExe, bunEnv, gcTick } from "harness";
import { closeSync, openSync } from "fs";
import { devNull } from "os";

test("spawn can read from stdout multiple chunks", async () => {
  gcTick(true);
  var maxFD: number = -1;
  for (let i = 0; i < 100; i++) {
    await (async function () {
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
      await proc.exited;
    })();
    if (maxFD === -1) {
      maxFD = openSync(devNull, "w");
      closeSync(maxFD);
    }
  }
  const newMaxFD = openSync(devNull, "w");
  closeSync(newMaxFD);
  expect(newMaxFD).toBe(maxFD);
}, 60_000);

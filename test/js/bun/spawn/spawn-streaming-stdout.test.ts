// @known-failing-on-windows: 1 failing
import { it, test, expect } from "bun:test";
import { spawn } from "bun";
import { bunExe, bunEnv, gcTick, dumpStats, expectMaxObjectTypeCount } from "harness";
import { closeSync, openSync } from "fs";
import { devNull } from "os";

test("spawn can read from stdout multiple chunks", async () => {
  gcTick(true);
  var maxFD: number = -1;

  const interval = setInterval(dumpStats, 1000);
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
      proc.kill();
      expect(Buffer.concat(chunks).toString()).toStartWith("Wrote to stdout\n".repeat(4));
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
  clearInterval(interval);
  await expectMaxObjectTypeCount(expect, "ReadableStream", 10);
  await expectMaxObjectTypeCount(expect, "ReadableStreamDefaultReader", 10);
  await expectMaxObjectTypeCount(expect, "ReadableByteStreamController", 10);
  await expectMaxObjectTypeCount(expect, "Subprocess", 5);
  dumpStats();
}, 60_0000);

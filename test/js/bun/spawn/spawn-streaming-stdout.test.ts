import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, dumpStats, expectMaxObjectTypeCount, gcTick, getMaxFD } from "harness";

test("spawn can read from stdout multiple chunks", async () => {
  gcTick(true);
  var maxFD: number = -1;
  let concurrency = 7;
  const count = 100;
  const interval = setInterval(dumpStats, 1000).unref();
  for (let i = 0; i < count; ) {
    const promises = new Array(concurrency);
    for (let j = 0; j < concurrency; j++) {
      promises[j] = (async function () {
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
    }
    await Promise.all(promises);
    i += concurrency;
    if (maxFD === -1) {
      maxFD = getMaxFD();
    }
  }
  const newMaxFD = getMaxFD();
  expect(newMaxFD).toBe(maxFD);
  clearInterval(interval);
  await expectMaxObjectTypeCount(expect, "ReadableStream", 10);
  await expectMaxObjectTypeCount(expect, "ReadableStreamDefaultReader", 10);
  await expectMaxObjectTypeCount(expect, "ReadableByteStreamController", 10);
  await expectMaxObjectTypeCount(expect, "Subprocess", 5);
  dumpStats();
}, 60_0000);

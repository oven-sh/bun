import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, dumpStats, expectMaxObjectTypeCount, gcTick, getMaxFD } from "harness";

test("spawn can read from stdout multiple chunks", async () => {
  gcTick();
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
      // Pipe fds are closed on a background thread after their streams finish,
      // so the first batch's closes may still be in flight here; poll until the
      // count settles so the baseline isn't inflated.
      maxFD = getMaxFD();
      for (let j = 0; j < 100; j++) {
        await Bun.sleep(10);
        const settled = getMaxFD();
        if (settled === maxFD) break;
        maxFD = settled;
      }
    }
  }
  // Same race for the last batch's closes; wait for the fd count to drop back
  // to the baseline before asserting. The settled baseline can still come out
  // slightly high (it has no pre-spawn ground truth; #6724 moved it after the
  // first batch on purpose), so ending below it is fine; only above is a leak.
  let newMaxFD = getMaxFD();
  for (let i = 0; i < 100 && newMaxFD > maxFD; i++) {
    await Bun.sleep(10);
    newMaxFD = getMaxFD();
  }
  expect(newMaxFD).toBeLessThanOrEqual(maxFD);
  clearInterval(interval);
  await expectMaxObjectTypeCount(expect, "ReadableStream", 10);
  await expectMaxObjectTypeCount(expect, "ReadableStreamDefaultReader", 10);
  await expectMaxObjectTypeCount(expect, "ReadableByteStreamController", 10);
  await expectMaxObjectTypeCount(expect, "Subprocess", 5);
  dumpStats();
}, 60_0000);

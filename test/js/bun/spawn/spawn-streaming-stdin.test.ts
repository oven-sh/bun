import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, dumpStats, expectMaxObjectTypeCount, getMaxFD } from "harness";
import { join } from "path";

const N = 100;
const concurrency = 16;
const delay = 8 * 12;

test("spawn can write to stdin multiple chunks", async () => {
  const interval = setInterval(dumpStats, 1000).unref();

  const maxFD = getMaxFD();

  var remaining = N;
  while (remaining > 0) {
    const proms = new Array(concurrency);
    for (let i = 0; i < concurrency; i++) {
      proms[i] = (async function () {
        const proc = spawn({
          cmd: [bunExe(), join(import.meta.dir, "stdin-repro.js")],
          stdout: "pipe",
          stdin: "pipe",
          stderr: "inherit",
          env: { ...bunEnv },
        });

        const prom2 = (async function () {
          let inCounter = 0;
          while (true) {
            proc.stdin!.write("Wrote to stdin!\n");
            await proc.stdin!.flush();
            await Bun.sleep(delay);

            if (inCounter++ === 6) break;
          }
          await proc.stdin!.end();
          return inCounter;
        })();

        const prom = (async function () {
          let chunks: any[] = [];

          try {
            for await (var chunk of proc.stdout) {
              chunks.push(chunk);
            }
          } catch (e: any) {
            console.log(e.stack);
            throw e;
          }

          return Buffer.concat(chunks).toString().trim();
        })();

        const [chunks, , exitCode] = await Promise.all([prom, prom2, proc.exited]);

        expect(chunks).toBe("Wrote to stdin!\n".repeat(7).trim());
        expect(exitCode).toBe(0);
      })();
    }
    await Promise.all(proms);
    remaining -= concurrency;
  }

  const newMaxFD = getMaxFD();

  // assert we didn't leak any file descriptors
  expect(newMaxFD).toBe(maxFD);
  clearInterval(interval);
  await expectMaxObjectTypeCount(expect, "ReadableStream", 10);
  await expectMaxObjectTypeCount(expect, "ReadableStreamDefaultReader", 10);
  await expectMaxObjectTypeCount(expect, "ReadableByteStreamController", 10);
  await expectMaxObjectTypeCount(expect, "Subprocess", 5);
  dumpStats();
}, 60_000);

// @known-failing-on-windows: 1 failing
import { it, test, expect } from "bun:test";
import { spawn } from "bun";
import { bunExe, bunEnv, gcTick, dumpStats, expectMaxObjectTypeCount } from "harness";
import { closeSync, openSync } from "fs";
import { tmpdir, devNull } from "node:os";
import { join } from "path";
import { unlinkSync } from "node:fs";

const N = 100;
test("spawn can write to stdin multiple chunks", async () => {
  const interval = setInterval(dumpStats, 1000).unref();

  const maxFD = openSync(devNull, "w");
  const concurrency = 10;
  const delay = 8 * (Bun.version.includes("-debug") ? 12 : 1);

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

            if (inCounter++ === 3) break;
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

        expect(chunks).toBe("Wrote to stdin!\n".repeat(4).trim());
        expect(exitCode).toBe(0);
      })();
    }
    await Promise.all(proms);
    remaining -= concurrency;
  }

  closeSync(maxFD);
  const newMaxFD = openSync(devNull, "w");
  closeSync(newMaxFD);

  // assert we didn't leak any file descriptors
  expect(newMaxFD).toBe(maxFD);
  clearInterval(interval);
  await expectMaxObjectTypeCount(expect, "ReadableStream", 10);
  await expectMaxObjectTypeCount(expect, "ReadableStreamDefaultReader", 10);
  await expectMaxObjectTypeCount(expect, "ReadableByteStreamController", 10);
  await expectMaxObjectTypeCount(expect, "Subprocess", 5);
  dumpStats();
}, 60_000);

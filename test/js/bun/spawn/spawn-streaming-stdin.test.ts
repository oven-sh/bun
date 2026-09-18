import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, dumpStats, expectMaxObjectTypeCount, getMaxFD } from "harness";
import { join } from "path";

// Two batches of `concurrency` spawns are enough for the fd/object-count
// leak checks below: any per-spawn leak of one fd or one retained object
// already blows past the asserted thresholds after 32 iterations.
const N = 32;
const concurrency = 16;
const line = "Wrote to stdin!\n";
const writes = 7;

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
          stderr: "pipe",
          env: { ...bunEnv },
        });

        // The reader accumulates echoed bytes from the child and resolves any
        // writer that is waiting for its echo. This lets the writer know the
        // child has consumed the previous chunk, so the next write is observed
        // as a distinct chunk by the child's `for await` loop without needing a
        // fixed Bun.sleep() between writes.
        let echoed = 0;
        let stdoutClosed = false;
        let notifyEcho: (() => void) | undefined;
        const stderrPromise = proc.stderr.text();

        const readerTask = (async function () {
          const chunks: Uint8Array[] = [];
          for await (const chunk of proc.stdout) {
            chunks.push(chunk);
            echoed += chunk.byteLength;
            notifyEcho?.();
          }
          stdoutClosed = true;
          notifyEcho?.();
          return Buffer.concat(chunks).toString();
        })();

        const writerTask = (async function () {
          for (let w = 1; w <= writes; w++) {
            proc.stdin!.write(line);
            await proc.stdin!.flush();
            while (echoed < line.length * w) {
              if (stdoutClosed) {
                // stdout ended before we got our echo. Kill the child so stderr
                // reaches EOF even if the child is still blocked on stdin, then
                // surface whatever it wrote.
                proc.kill();
                const [err, code] = await Promise.all([stderrPromise, proc.exited]);
                throw new Error(
                  `child stdout closed after ${echoed}/${line.length * writes} bytes (exit ${code}); stderr:\n${err}`,
                );
              }
              await new Promise<void>(resolve => {
                notifyEcho = resolve;
              });
              notifyEcho = undefined;
            }
          }
          await proc.stdin!.end();
        })();

        const [received, stderr, , exitCode] = await Promise.all([readerTask, stderrPromise, writerTask, proc.exited]);

        expect(stderr).toBe("");
        expect(received).toBe(line.repeat(writes));
        expect(exitCode).toBe(0);
      })();
    }
    await Promise.all(proms);
    remaining -= concurrency;
  }

  // Pipe fds are closed on a background thread after their streams finish, so
  // the last batch's closes may still be in flight here; wait for them to land.
  let newMaxFD = getMaxFD();
  for (let i = 0; i < 100 && newMaxFD !== maxFD; i++) {
    await Bun.sleep(10);
    newMaxFD = getMaxFD();
  }

  // assert we didn't leak any file descriptors
  expect(newMaxFD).toBe(maxFD);
  clearInterval(interval);
  await expectMaxObjectTypeCount(expect, "ReadableStream", 10);
  await expectMaxObjectTypeCount(expect, "ReadableStreamDefaultReader", 10);
  await expectMaxObjectTypeCount(expect, "ReadableByteStreamController", 10);
  await expectMaxObjectTypeCount(expect, "Subprocess", 5);
  dumpStats();
}, 60_000);

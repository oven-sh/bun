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

// The pipe is read from the moment the child starts. What arrived before the first look at
// `proc.stdout` has to be the stream's first chunk, not wait behind the child's next write.
test.each(["stdout", "stderr"] as const)(
  "what a child wrote to %s before the stream was first read is its first chunk",
  async which => {
    const other = which === "stdout" ? "stderr" : "stdout";
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.${which}.write("early\\n", () => process.${other}.write("ready\\n"));
         process.stdin.on("data", () => process.exit(0));`,
      ],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const decoder = new TextDecoder();
    async function readLine(stream: ReadableStream<Uint8Array>) {
      const reader = stream.getReader();
      let text = "";
      while (!text.includes("\n")) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      reader.releaseLock();
      return text;
    }
    // "ready" was written after "early" had been: by now "early" is in the pipe or already in the parent.
    expect(await readLine(proc[other])).toBe("ready\n");
    for (let i = 0; i < 10; i++) await new Promise<void>(resolve => setImmediate(resolve));
    expect(await readLine(proc[which])).toBe("early\n");
    proc.stdin.write("done\n");
    await proc.stdin.end();
    expect(await proc.exited).toBe(0);
  },
);

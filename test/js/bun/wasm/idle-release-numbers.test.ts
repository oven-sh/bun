// TEMPORARY: prints the numbers of compile-rss-fixture.mjs and of the Atomics.wait retention child on every lane, and
// fails so that CI shows them. To be removed before this PR leaves draft.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import path from "node:path";

test.skipIf(isDebug || isASAN)(
  "numbers of the idle release tests on this lane (temporary, fails on purpose)",
  async () => {
    const lines: string[] = [];
    const fixture = path.join(import.meta.dir, "compile-rss-fixture.mjs");
    const run = async (cmd: string[], env: Record<string, string | undefined>) => {
      await using proc = Bun.spawn({ cmd, env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return `${stdout.trim().split("\n").at(-1)}${stderr.trim() ? " STDERR " + stderr.trim().slice(0, 300) : ""}${exitCode ? " EXIT " + exitCode : ""}`;
    };
    const brief = (line: string) => {
      try {
        const r = JSON.parse(line);
        const burst = (b: any) =>
          `${b.peakDeltaMiB.toFixed(1)}>${b.idleDeltaMiB.toFixed(1)}@${Math.round(b.polledMs)}ms${b.stalled ? "!" : ""}`;
        return `base ${Math.round(r.baselineMs)} ms total ${Math.round(r.totalMs)} ms first ${burst(r.first)} later ${r.bursts.map(burst).join(" ")}`;
      } catch {
        return line;
      }
    };
    for (let i = 0; i < 20; i++) {
      lines.push(
        "8 threads: " +
          brief(await run([bunExe(), fixture, "10", "later"], { ...bunEnv, BUN_JSC_numberOfWasmCompilerThreads: "8" })),
      );
    }
    for (let i = 0; i < 6; i++) {
      lines.push("default threads: " + brief(await run([bunExe(), fixture, "10", "later"], bunEnv)));
    }
    for (let i = 0; i < 10; i++) {
      lines.push("Atomics.wait: " + (await run([bunExe(), "-e", atomicsWaitChild], bunEnv)));
    }
    console.log(`cpus ${navigator.hardwareConcurrency} ${process.platform} ${process.arch}\n` + lines.join("\n"));
    expect("the numbers above").toBe("printed, and this file is removed again");
  },
  600_000,
);

const atomicsWaitChild = `
      const view = new Int32Array(new SharedArrayBuffer(16));
      const [RELEASED, PHASE, GO] = [0, 1, 2];
      const worker = new Worker(
        URL.createObjectURL(
          new Blob(
            [
              \`
              self.onmessage = event => {
                const view = new Int32Array(event.data);
                // Start-up has to be over before the base is read and before the blocks are allocated: RSS still
                // grows by 2 to 6 MiB in the first 100 ms of this handler, and about 100 ms in, the JSC warm-up
                // thread (and this thread, in this wait) sweep. A sweep moves the clock by which the allocator
                // tells which large blocks were used a moment ago: one that came right after the allocation would
                // let a single release hand the blocks back.
                Atomics.wait(view, 0, 0, 150);
                // The main thread reads RSS in each phase, and sets GO to the phase when it has.
                Atomics.store(view, 1, 1);
                Atomics.wait(view, 2, 0);
                const blocks = [];
                for (let kib = 96; kib <= 480; kib += 32) {
                  for (let i = 0; i < 12; i++) blocks.push(new Uint8Array(kib * 1024).fill(1));
                }
                Atomics.store(view, 1, 2);
                Atomics.wait(view, 2, 1);
                // transfer(0) frees the memory here and now: no collection, and no allocation after it.
                for (const block of blocks) block.buffer.transfer(0);
                Atomics.store(view, 1, 3);
                Atomics.wait(view, 0, 0, 1500);
                postMessage("done");
              };
              \`,
            ],
            { type: "application/javascript" },
          ),
        ),
      );
      const done = new Promise(resolve => (worker.onmessage = resolve));
      worker.postMessage(view.buffer);
      const rss = () => process.memoryUsage.rss() / 1048576;
      const reach = phase => {
        while (Atomics.load(view, PHASE) !== phase);
      };
      const go = phase => {
        Atomics.store(view, GO, phase);
        Atomics.notify(view, GO);
      };
      // No await from here until the worker is told to stop: a thread that goes idle is swept, and every sweep moves
      // the clock by which the allocator tells which large blocks were used a moment ago.
      reach(1);
      const base = rss();
      go(1);
      reach(2);
      const held = rss() - base;
      go(2);
      reach(3);
      const deadline = performance.now() + 1200;
      let kept;
      while ((kept = rss() - base) >= 10 && performance.now() < deadline);
      Atomics.store(view, RELEASED, 1);
      Atomics.notify(view, RELEASED);
      await done;
      console.log(JSON.stringify({ held, kept }));
      process.exit(0);
      `;

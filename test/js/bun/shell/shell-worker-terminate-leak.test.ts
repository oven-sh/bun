import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { join } from "path";

// Terminating a worker while a Bun.$ command's external subprocess is still
// running used to leak the whole in-flight exec: the shell interpreter's VM
// shutdown finalizer dropped its node arena without deiniting live Cmd nodes,
// so the ShellSubprocess box, its stdout/stderr PipeReaders and a pending
// buffer-stdin writer were never freed. Guard on the asan lane.
//
// The worker starts `sh` (never a shell builtin, so it is a real external
// process), waits until the child proves it is alive by writing flag.txt,
// then posts back; the parent terminates the worker while the child blocks.
async function expectNoLeakAfterTerminate(workerSource: string) {
  using dir = tempDir("shell-worker-terminate-leak", {
    "main.ts": `
      const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
      await new Promise(resolve => (worker.onmessage = resolve));
      await worker.terminate();
    `,
    "worker.ts": workerSource,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_DESTRUCT_VM_ON_EXIT: "1",
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
      LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dirname, "../../../leaksan.supp")}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
}

test.skipIf(!isASAN || isWindows)(
  "worker.terminate() with a live Bun.$ subprocess does not leak its pipe readers",
  async () => {
    await expectNoLeakAfterTerminate(`
      const running = Bun.$\`sh -c "echo ok > flag.txt && exec sleep 100"\`.nothrow();
      // Shell promises are lazy; awaiting starts the interpreter.
      (async () => {
        await running;
      })();
      while (!(await Bun.file("flag.txt").exists())) {
        await Bun.sleep(5);
      }
      postMessage("ok");
    `);
  },
  // LSan's report symbolization alone can take tens of seconds on the debug
  // binary, so the failure mode needs far more than the default timeout.
  90_000,
);

test.skipIf(!isASAN || isWindows)(
  "worker.terminate() with a live Bun.$ subprocess does not leak a pending buffer-stdin writer",
  async () => {
    // Stdin is far larger than the pipe capacity and the child never reads
    // it, so the shell's static stdin writer is still mid-write at terminate.
    await expectNoLeakAfterTerminate(`
      const stdin = Buffer.alloc(1 << 20, "x");
      const running = Bun.$\`sh -c "echo ok > flag.txt && exec sleep 100" < \${stdin}\`.nothrow();
      (async () => {
        await running;
      })();
      while (!(await Bun.file("flag.txt").exists())) {
        await Bun.sleep(5);
      }
      postMessage("ok");
    `);
  },
  90_000,
);

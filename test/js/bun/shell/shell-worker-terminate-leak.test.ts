import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, isWindows, tempDir } from "harness";
import { join } from "path";

// Terminating a worker while a Bun.$ command's external subprocess is still
// running used to leak the whole in-flight exec: the shell interpreter's VM
// shutdown finalizer dropped its node arena without deiniting live Cmd nodes,
// so the ShellSubprocess box, its stdout/stderr PipeReaders, a pending
// buffer-stdin writer and any redirection fd were never freed. Leak variants
// guard on the asan lane; the kill test runs on every Linux lane.
//
// Each worker starts `sh` (never a shell builtin, so it is a real external
// process), waits until the child proves it is alive by writing its flag
// file, then posts back; the parent terminates the worker while the child
// blocks.
async function runTerminateScenario(workerSource: string, extraEnv: Record<string, string> = {}) {
  using dir = tempDir("shell-worker-terminate-leak", {
    "main.ts": `
      const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
      const { promise, resolve, reject } = Promise.withResolvers();
      worker.onmessage = resolve;
      worker.onerror = e => reject(e.error ?? e.message);
      await promise;
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
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
}

// LSan's report symbolization alone can take tens of seconds on the debug
// binary, so the failure mode needs far more than the default timeout.
const LEAK_TEST_TIMEOUT = 90_000;

test.skipIf(!isASAN || isWindows)(
  "worker.terminate() with a live Bun.$ subprocess does not leak its pipe readers",
  async () => {
    await runTerminateScenario(`
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
  LEAK_TEST_TIMEOUT,
);

test.skipIf(!isASAN || isWindows)(
  "worker.terminate() with a live Bun.$ subprocess does not leak a pending buffer-stdin writer",
  async () => {
    // Stdin is far larger than the pipe capacity and the child never reads
    // it, so the shell's static stdin writer is still mid-write at terminate.
    await runTerminateScenario(`
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
  LEAK_TEST_TIMEOUT,
);

test.skipIf(!isASAN || isWindows)(
  "worker.terminate() with a live Bun.$ pipeline does not leak either subprocess",
  async () => {
    // Two live externals in one pipeline: exercises the finalizer walk over
    // several occupied Cmd slots plus the Pipeline node's duped child envs.
    await runTerminateScenario(`
      const running = Bun.$\`sh -c "echo ok > flag1.txt && exec sleep 100" | sh -c "echo ok > flag2.txt && exec sleep 100"\`.nothrow();
      (async () => {
        await running;
      })();
      while (!(await Bun.file("flag1.txt").exists()) || !(await Bun.file("flag2.txt").exists())) {
        await Bun.sleep(5);
      }
      postMessage("ok");
    `);
  },
  LEAK_TEST_TIMEOUT,
);

test.skipIf(!isASAN || isWindows)(
  "worker.terminate() with a live Bun.$ file redirect does not leak the redirection fd",
  async () => {
    // `> out.txt` opens a CowFd on the Cmd that only Cmd::deinit releases.
    await runTerminateScenario(`
      const running = Bun.$\`sh -c "echo ok > flag.txt && exec sleep 100" > out.txt\`.nothrow();
      (async () => {
        await running;
      })();
      while (!(await Bun.file("flag.txt").exists())) {
        await Bun.sleep(5);
      }
      postMessage("ok");
    `);
  },
  LEAK_TEST_TIMEOUT,
);

test.skipIf(!isASAN || isWindows)(
  "worker.terminate() with a live Bun.$ arraybuffer redirect does not leak the pinned buffer",
  async () => {
    await runTerminateScenario(`
      const out = new Uint8Array(1 << 16);
      const running = Bun.$\`sh -c "echo ok > flag.txt && exec sleep 100" > \${out}\`.nothrow();
      (async () => {
        await running;
      })();
      while (!(await Bun.file("flag.txt").exists())) {
        await Bun.sleep(5);
      }
      postMessage("ok");
    `);
  },
  LEAK_TEST_TIMEOUT,
);

test.skipIf(!isASAN || isWindows)(
  "worker.terminate() with a live Bun.$ arraybuffer redirect does not unpin a finalized ArrayBuffer",
  async () => {
    // During lastChanceToFinalize the JSC::ArrayBuffer impls are already
    // deleted, so the teardown must not unpin through them. JSC memory is
    // libpas-backed and invisible to ASAN, so force system malloc; leak
    // detection stays off because Malloc=1 surfaces process-lifetime WTF
    // allocations LSan would misreport.
    await runTerminateScenario(
      `
      const out = new Uint8Array(1 << 16);
      const running = Bun.$\`sh -c "echo ok > flag.txt && exec sleep 100" > \${out}\`.nothrow();
      (async () => {
        await running;
      })();
      while (!(await Bun.file("flag.txt").exists())) {
        await Bun.sleep(5);
      }
      postMessage("ok");
    `,
      { Malloc: "1", ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":") },
    );
  },
  LEAK_TEST_TIMEOUT,
);

test.skipIf(!isLinux)(
  "worker.terminate() kills a live Bun.$ subprocess",
  async () => {
    // The interpreter teardown SIGKILLs the child the same way Cmd::deinit
    // does for a live child. Nothing reaps it afterwards (the watcher was
    // detached), so "killed" shows as zombie or gone, read from /proc.
    using dir = tempDir("shell-worker-terminate-kill", {
      "main.ts": `
        import { readFileSync } from "node:fs";
        const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
        const { promise, resolve, reject } = Promise.withResolvers<number>();
        worker.onmessage = e => resolve(e.data);
        worker.onerror = e => reject(e.error ?? e.message);
        const pid: number = await promise;
        await worker.terminate();
        const deadline = Date.now() + 20_000;
        let state = "alive";
        while (Date.now() < deadline) {
          try {
            // "pid (comm) State ..." — comm is sh/sleep, never contains ")".
            state = readFileSync(\`/proc/\${pid}/stat\`, "utf8").split(") ")[1][0];
          } catch {
            state = "gone";
          }
          if (state === "Z" || state === "gone") break;
          await Bun.sleep(10);
        }
        console.log(state === "Z" || state === "gone" ? "killed" : "alive:" + state);
      `,
      "worker.ts": `
        const running = Bun.$\`sh -c 'echo $$ > pid.txt && exec sleep 100'\`.nothrow();
        (async () => {
          await running;
        })();
        // Wait for the trailing newline so a partially-written pid is never
        // parsed.
        while (!(await Bun.file("pid.txt").exists()) || !(await Bun.file("pid.txt").text()).includes("\\n")) {
          await Bun.sleep(5);
        }
        postMessage(parseInt((await Bun.file("pid.txt").text()).trim(), 10));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "killed\n", stderr: "", exitCode: 0 });
  },
  60_000,
);

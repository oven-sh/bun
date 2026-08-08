import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isMacOS, tempDir } from "harness";

// Worker VM startup/teardown is much slower under debug and/or ASAN; the leak
// is exactly one port per cycle, so fewer cycles are still a clear signal.
const slow = isDebug || isASAN;
const cycles = slow ? 6 : 10;
const timeout = slow ? 90_000 : 30_000;

// On macOS every us_loop allocates a mach port as its cross-thread wakeup
// channel (registered with kqueue via EVFILT_MACHPORT). us_internal_async_close
// released only the port's send right, so the receive right (and with it the
// kernel port) leaked on every destroyed loop: each Worker create/terminate
// cycle grew the process's mach port table by one, marching long-lived
// processes toward port-space exhaustion.
//
// The child counts its own receive rights via mach_port_names (self-inspection
// needs no privileges) across Worker churn. Unfixed, the delta equals the
// cycle count; fixed, it stays near zero.
test.skipIf(!isMacOS)(
  "terminated Workers do not leak mach receive rights",
  async () => {
    using dir = tempDir("worker-machport-leak", {
      "worker.js": `postMessage("ready");\nsetInterval(() => {}, 1e9);\n`,
      "main.js": `
        import { dlopen, ptr, toArrayBuffer } from "bun:ffi";

        const { symbols } = dlopen("/usr/lib/libSystem.B.dylib", {
          task_self_trap: { args: [], returns: "u32" },
          mach_port_names: { args: ["u32", "ptr", "ptr", "ptr", "ptr"], returns: "i32" },
        });

        const task = symbols.task_self_trap();
        const MACH_PORT_TYPE_RECEIVE = 1 << 17;

        function countReceiveRights() {
          const names = new BigUint64Array(1);
          const namesCnt = new Uint32Array(1);
          const types = new BigUint64Array(1);
          const typesCnt = new Uint32Array(1);
          const kr = symbols.mach_port_names(task, ptr(names), ptr(namesCnt), ptr(types), ptr(typesCnt));
          if (kr !== 0) throw new Error("mach_port_names failed: " + kr);
          const cnt = typesCnt[0];
          const arr = new Uint32Array(toArrayBuffer(Number(types[0]), 0, cnt * 4));
          let n = 0;
          for (let i = 0; i < cnt; i++) {
            if (arr[i] & MACH_PORT_TYPE_RECEIVE) n++;
          }
          return n;
        }

        const workerUrl = new URL("./worker.js", import.meta.url).href;

        async function cycle() {
          const w = new Worker(workerUrl);
          await new Promise((resolve, reject) => {
            w.onmessage = resolve;
            w.onerror = e => reject(new Error("worker error: " + (e && e.message)));
          });
          await w.terminate();
        }

        // Warm up lazy one-time allocations (thread pools, dispatch state).
        for (let i = 0; i < 3; i++) await cycle();

        const CYCLES = ${cycles};
        const baseline = countReceiveRights();
        for (let i = 0; i < CYCLES; i++) await cycle();

        // The wakeup port is released on the worker thread's exit path, which
        // can lag terminate() resolving; poll with a deadline instead of
        // asserting once.
        const deadline = Date.now() + 15_000;
        let current = countReceiveRights();
        while (current - baseline > CYCLES / 2 && Date.now() < deadline) {
          await Bun.sleep(50);
          current = countReceiveRights();
        }

        if (current - baseline > CYCLES / 2) {
          console.log("LEAK baseline=" + baseline + " final=" + current + " cycles=" + CYCLES);
          process.exit(1);
        }
        console.log("OK baseline=" + baseline + " final=" + current);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toStartWith("OK ");
    expect(exitCode).toBe(0);
  },
  timeout,
);

// https://github.com/oven-sh/bun/issues/11760
//
// parentPort in a node:worker_threads worker is an emulated object that forwards to the
// worker's global scope. Registering a "message" listener on the global scope takes a ref on
// the worker's event loop (BunWorkerGlobalScope.cpp), but close()/ref()/unref() were no-ops,
// so the ref was never released and the worker (and therefore the parent process) hung forever.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";

// Without the fix the subprocess hangs forever; bound it so the fail-before run doesn't leave
// processes behind. With the fix each case finishes in well under a second on a release build.
const SUBPROCESS_TIMEOUT = isDebug ? 30_000 : 10_000;
// Per-test timeout must be longer than the subprocess kill so the SIGKILL actually fires; without
// this the default 5 s test timeout races the 10/30 s spawn timeout and the hung subprocess
// survives the fail-before run, starving later build steps.
const TEST_TIMEOUT = SUBPROCESS_TIMEOUT * 2;

async function run(workerBody: string, caller?: string) {
  using dir = tempDir("parentport", {
    "caller.mjs":
      caller ??
      /* js */ `
      import { Worker } from "node:worker_threads";
      const worker = new Worker("./worker.mjs");
      worker.on("exit", (code) => console.log("parent: exit", code));
      worker.postMessage("go");
    `,
    "worker.mjs": workerBody,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "caller.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    timeout: SUBPROCESS_TIMEOUT,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (proc.signalCode !== null || exitCode === null) {
    return {
      stdout,
      stderr,
      exitCode,
      error:
        `subprocess did not exit within ${SUBPROCESS_TIMEOUT}ms ` +
        `(signal ${proc.signalCode}, stdout=${JSON.stringify(stdout)}, stderr=${JSON.stringify(stderr)})`,
    };
  }
  return { stdout, stderr, exitCode, error: "" };
}

function check({ stdout, stderr, exitCode, error }: Awaited<ReturnType<typeof run>>, expectedLines: string[]) {
  expect(error).toBe("");
  expect(stderr).toBe("");
  expect(stdout.split("\n").filter(Boolean)).toEqual(expectedLines);
  expect(exitCode).toBe(0);
}

test.concurrent(
  "parentPort.close() inside a message handler lets the process exit",
  async () => {
    check(
      await run(/* js */ `
        import { parentPort } from "node:worker_threads";
        parentPort.on("message", () => {
          parentPort.close();
        });
      `),
      ["parent: exit 0"],
    );
  },
  TEST_TIMEOUT,
);

test.concurrent(
  "parentPort.close() stops delivery: late postMessage is dropped",
  async () => {
    check(
      await run(
        /* js */ `
        import { parentPort } from "node:worker_threads";
        parentPort.on("message", (m) => {
          console.log("worker: got", m);
          // Ack so the parent's once('message') handler fires and actually sends "late".
          parentPort.postMessage("ack");
          parentPort.close();
        });
        // keep the worker up past the late post so, if close() were a no-op, it would arrive
        setTimeout(() => {}, 200);
      `,
        /* js */ `
        import { Worker } from "node:worker_threads";
        const worker = new Worker("./worker.mjs");
        worker.on("exit", (code) => console.log("parent: exit", code));
        worker.postMessage("stop");
        worker.once("message", () => {
          // posted after close(); must never be delivered
          worker.postMessage("late");
        });
      `,
      ),
      ["worker: got stop", "parent: exit 0"],
    );
  },
  TEST_TIMEOUT,
);

test.concurrent(
  "parentPort.close() emits 'close' and lets other handles drain",
  async () => {
    // close() returns synchronously, 'close' fires on nextTick, and the worker stays up until
    // the interval is cleared because close() only drops parentPort's own ref.
    check(
      await run(/* js */ `
        import { parentPort } from "node:worker_threads";
        parentPort.on("close", () => console.log("worker: close"));
        parentPort.on("message", () => {
          parentPort.close();
          console.log("worker: after close()");
        });
        // An unrelated handle must keep the worker alive after close() drops parentPort's ref.
        const i = setInterval(() => {}, 1_000_000);
        parentPort.on("close", () => {
          // Tear it down only after we've observed the 'close' event so the test isn't racy.
          setImmediate(() => {
            console.log("worker: still alive after close");
            clearInterval(i);
          });
        });
      `),
      ["worker: after close()", "worker: close", "worker: still alive after close", "parent: exit 0"],
    );
  },
  TEST_TIMEOUT,
);

test.concurrent(
  "parentPort.unref() still delivers messages while another handle holds the loop",
  async () => {
    // unref() must drop the loop ref without removing the forwarder — the whole reason the
    // compensating incEventLoopRef path exists. If unref() were reimplemented as
    // dropForwarder(), 'go' would never be dispatched and this test would fail.
    check(
      await run(/* js */ `
        import { parentPort } from "node:worker_threads";
        parentPort.on("message", (m) => console.log("worker: got", m));
        parentPort.unref();
        // Hold the loop so 'go' has time to arrive; parentPort is NOT what keeps us alive.
        setTimeout(() => {}, 200);
      `),
      ["worker: got go", "parent: exit 0"],
    );
  },
  TEST_TIMEOUT,
);

test.concurrent(
  "parentPort.unref() lets the worker exit while a listener is still installed",
  async () => {
    check(
      await run(/* js */ `
        import { parentPort } from "node:worker_threads";
        parentPort.on("message", () => {});
        parentPort.unref();
        console.log("worker: hasRef", parentPort.hasRef());
      `),
      ["worker: hasRef false", "parent: exit 0"],
    );
  },
  TEST_TIMEOUT,
);

test.concurrent(
  "parentPort.ref() keeps the worker alive without a listener",
  async () => {
    // ref() with no listener should hold the event loop open on its own. The setImmediate is
    // unref'd so parentPort.ref() is the only thing keeping the loop alive: if ref() didn't
    // actually take a loop ref, the worker would exit before the callback runs.
    check(
      await run(/* js */ `
        import { parentPort } from "node:worker_threads";
        parentPort.ref();
        console.log("worker: hasRef", parentPort.hasRef());
        setImmediate(() => {
          console.log("worker: still alive");
          parentPort.unref();
        }).unref();
      `),
      ["worker: hasRef true", "worker: still alive", "parent: exit 0"],
    );
  },
  TEST_TIMEOUT,
);

test.concurrent(
  "parentPort.hasRef() tracks listener/ref/unref/close transitions",
  async () => {
    check(
      await run(/* js */ `
        import { parentPort } from "node:worker_threads";
        const log = [];
        log.push(parentPort.hasRef());            // false: no listener yet
        parentPort.on("message", () => {});
        log.push(parentPort.hasRef());            // true: listener registered
        parentPort.unref();
        log.push(parentPort.hasRef());            // false
        parentPort.ref();
        log.push(parentPort.hasRef());            // true
        parentPort.close();
        log.push(parentPort.hasRef());            // true: close() doesn't clear the flag
        console.log(JSON.stringify(log));
      `),
      ["[false,true,false,true,true]", "parent: exit 0"],
    );
  },
  TEST_TIMEOUT,
);

test.concurrent(
  "parentPort.onmessage keeps the worker alive and close() releases it",
  async () => {
    check(
      await run(/* js */ `
        import { parentPort } from "node:worker_threads";
        parentPort.onmessage = (ev) => {
          console.log("worker: onmessage", ev.data);
          parentPort.close();
        };
      `),
      ["worker: onmessage go", "parent: exit 0"],
    );
  },
  TEST_TIMEOUT,
);

test.concurrent(
  "removing the last parentPort message listener lets the worker exit",
  async () => {
    check(
      await run(/* js */ `
        import { parentPort } from "node:worker_threads";
        const handler = (msg) => {
          console.log("worker: got", msg);
          parentPort.off("message", handler);
        };
        parentPort.on("message", handler);
      `),
      ["worker: got go", "parent: exit 0"],
    );
  },
  TEST_TIMEOUT,
);

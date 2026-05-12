// https://github.com/oven-sh/bun/issues/11760
//
// parentPort in a node:worker_threads worker is an emulated object that forwards to the
// worker's global scope. Registering a "message" listener on the global scope takes a ref on
// the worker's event loop (BunWorkerGlobalScope.cpp), but close()/ref()/unref() were no-ops,
// so the ref was never released and the worker — and therefore the parent process — hung
// forever.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function run(workerBody: string) {
  using dir = tempDir("parentport", {
    "caller.mjs": /* js */ `
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
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("parentPort.close() inside a message handler lets the process exit", async () => {
  const { stdout, stderr, exitCode } = await run(/* js */ `
    import { parentPort } from "node:worker_threads";
    parentPort.on("message", () => {
      parentPort.close();
    });
  `);
  expect(stderr).toBe("");
  expect(stdout).toBe("parent: exit 0\n");
  expect(exitCode).toBe(0);
});

test.concurrent("parentPort.close() emits 'close' and lets other handles drain", async () => {
  const { stdout, stderr, exitCode } = await run(/* js */ `
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
  `);
  expect(stderr).toBe("");
  // close() returns synchronously, 'close' fires on nextTick, and the worker stays up until
  // the interval is cleared because close() only drops parentPort's own ref.
  expect(stdout.split("\n").filter(Boolean)).toEqual([
    "worker: after close()",
    "worker: close",
    "worker: still alive after close",
    "parent: exit 0",
  ]);
  expect(exitCode).toBe(0);
});

test.concurrent("parentPort.unref() lets the worker exit while a listener is still installed", async () => {
  const { stdout, stderr, exitCode } = await run(/* js */ `
    import { parentPort } from "node:worker_threads";
    parentPort.on("message", () => {});
    parentPort.unref();
    console.log("worker: hasRef", parentPort.hasRef());
  `);
  expect(stderr).toBe("");
  expect(stdout.split("\n").filter(Boolean)).toEqual(["worker: hasRef false", "parent: exit 0"]);
  expect(exitCode).toBe(0);
});

test.concurrent("parentPort.ref() keeps the worker alive without a listener", async () => {
  // ref() with no listener should hold the event loop open on its own; we flip it back with
  // unref() from a queued task so the test isn't timing-dependent.
  const { stdout, stderr, exitCode } = await run(/* js */ `
    import { parentPort } from "node:worker_threads";
    parentPort.ref();
    console.log("worker: hasRef", parentPort.hasRef());
    setImmediate(() => {
      console.log("worker: still alive");
      parentPort.unref();
    });
  `);
  expect(stderr).toBe("");
  expect(stdout.split("\n").filter(Boolean)).toEqual(["worker: hasRef true", "worker: still alive", "parent: exit 0"]);
  expect(exitCode).toBe(0);
});

test.concurrent("parentPort.hasRef() tracks listener/ref/unref/close transitions", async () => {
  const { stdout, stderr, exitCode } = await run(/* js */ `
    import { parentPort } from "node:worker_threads";
    const log = [];
    log.push(parentPort.hasRef());            // false — no listener yet
    parentPort.on("message", () => {});
    log.push(parentPort.hasRef());            // true — listener registered
    parentPort.unref();
    log.push(parentPort.hasRef());            // false
    parentPort.ref();
    log.push(parentPort.hasRef());            // true
    parentPort.close();
    log.push(parentPort.hasRef());            // true — close() doesn't clear the flag
    console.log(JSON.stringify(log));
  `);
  expect(stderr).toBe("");
  expect(stdout.split("\n").filter(Boolean)).toEqual(["[false,true,false,true,true]", "parent: exit 0"]);
  expect(exitCode).toBe(0);
});

test.concurrent("parentPort.onmessage keeps the worker alive and close() releases it", async () => {
  const { stdout, stderr, exitCode } = await run(/* js */ `
    import { parentPort } from "node:worker_threads";
    parentPort.onmessage = (ev) => {
      console.log("worker: onmessage", ev.data);
      parentPort.close();
    };
  `);
  expect(stderr).toBe("");
  expect(stdout.split("\n").filter(Boolean)).toEqual(["worker: onmessage go", "parent: exit 0"]);
  expect(exitCode).toBe(0);
});

test.concurrent("removing the last parentPort message listener lets the worker exit", async () => {
  const { stdout, stderr, exitCode } = await run(/* js */ `
    import { parentPort } from "node:worker_threads";
    const handler = (msg) => {
      console.log("worker: got", msg);
      parentPort.off("message", handler);
    };
    parentPort.on("message", handler);
  `);
  expect(stderr).toBe("");
  expect(stdout.split("\n").filter(Boolean)).toEqual(["worker: got go", "parent: exit 0"]);
  expect(exitCode).toBe(0);
});

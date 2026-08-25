import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
import { join } from "node:path";

// The server's first frame is written in the same cork as the 101 response, so
// the client receives handshake-overflow bytes and queues them as a native
// microtask. Exiting (or terminating a worker) from inside `onopen` tears the
// VM down before that microtask runs; the queued context must be freed with the
// discarded queue rather than leaked. LeakSanitizer only exists on ASAN builds;
// elsewhere this asserts the scenario exits cleanly.

const env = {
  ...bunEnv,
  BUN_DESTRUCT_VM_ON_EXIT: "1",
  ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
  LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dirname, "../../../leaksan.supp")}`,
};

async function withServerThatSendsOnOpen(fn: (url: string) => Promise<void>) {
  using server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("not a websocket", { status: 400 });
    },
    websocket: {
      open(ws) {
        ws.send("connected");
      },
      message() {},
    },
  });
  await fn(`ws://127.0.0.1:${server.port}`);
}

async function runAndExpectClean(script: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (isASAN) expect(stderr).not.toContain("LeakSanitizer");
  expect(stdout.trim()).toBe("open");
  expect(exitCode).toBe(0);
}

// LSan's report symbolization alone can take tens of seconds on a debug build.
const TIMEOUT = isASAN ? 90_000 : undefined;

describe("WebSocket client initial-data microtask discarded at VM teardown", () => {
  test.concurrent(
    "process.exit() from onopen",
    async () => {
      await withServerThatSendsOnOpen(url =>
        runAndExpectClean(`
          const ws = new WebSocket(${JSON.stringify(url)});
          ws.onopen = () => {
            console.log("open");
            ws.close();
            process.exit(0);
          };
          ws.onerror = e => {
            console.error(e?.message);
            process.exit(1);
          };
        `),
      );
    },
    TIMEOUT,
  );

  test.concurrent(
    "worker.terminate() from onopen",
    async () => {
      await withServerThatSendsOnOpen(url =>
        runAndExpectClean(`
          const { Worker } = require("node:worker_threads");
          const worker = new Worker(
            \`
              const { parentPort } = require("node:worker_threads");
              const ws = new WebSocket(${JSON.stringify(url)});
              ws.onopen = () => {
                parentPort.postMessage("open");
                // Stay inside onopen until the parent terminates us.
                const until = Date.now() + 30_000;
                while (Date.now() < until) {}
              };
              ws.onerror = () => process.exit(1);
            \`,
            { eval: true },
          );
          worker.on("message", async message => {
            console.log(message);
            await worker.terminate();
            process.exit(0);
          });
        `),
      );
    },
    TIMEOUT,
  );
});

import { spawn, spawnSync } from "bun";
import { beforeAll, describe, expect, it } from "bun:test";
import { existsSync, statSync } from "fs";
import { bunEnv, bunExe, canBuildNodeAddons, isASAN, isDebug, isWindows, nodeExeMatchingAbi, tempDir } from "harness";
import { join } from "path";

// An addon reads its napi_set_instance_data pointer from its other callbacks:
// the finalizer of a value, the complete callback of async work, the close
// callback of a uv handle, the call_js of a threadsafe function. When a Worker
// exits with such a callback queued, Node runs the callback before the addon's
// cleanup hooks and before the instance data finalizer.
//
// The fixture's cleanup hook and its instance data finalizer print what ran
// before them. A callback that runs after the instance data finalizer prints
// a line of its own.
//
// The rows run one at a time: each starts a Bun and a Node with a Worker, and
// a debug build is slow to start either.

const napiAppDir = join(__dirname, "napi-app");
const source = join(napiAppDir, "test_instance_data_finalizer_order.c");
const targets = ["test_instance_data_finalizer_order", "test_instance_data_finalizer_order_experimental"];
const addonPath = (target: string) => join(napiAppDir, `build/Debug/${target}.node`);

function isBuilt() {
  const sourceTime = statSync(source).mtimeMs;
  return targets.every(target => existsSync(addonPath(target)) && statSync(addonPath(target)).mtimeMs >= sourceTime);
}

beforeAll(async () => {
  if (!canBuildNodeAddons()) return;
  await nodeExeMatchingAbi();
  // napi.test.ts or an earlier run usually has built the addons already. They
  // do not link against bun, so an existing binary stays valid across builds.
  if (isBuilt()) return;
  const run = (cmd: string[]) =>
    spawnSync({ cmd, cwd: napiAppDir, env: bunEnv, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  // `bun install` runs a full `node-gyp rebuild` of every target in
  // binding.gyp. Install the toolchain without that script and build only the
  // two targets of this file.
  if (!existsSync(join(napiAppDir, "node_modules/node-gyp"))) {
    run([bunExe(), "install", "--ignore-scripts", "--verbose"]);
  }
  run([bunExe(), "--bun", "node-gyp", "configure", "build", "--debug", "-j", "max", ...targets]);
  if (isBuilt()) return;
  // Fallback: the full install and rebuild of everything.
  if (!run([bunExe(), "install", "--verbose"]).success || !isBuilt()) {
    throw new Error("building the napi-app addons failed");
  }
}, 300_000);

const everyKind = [
  "external",
  "wrap",
  "wrap_ref",
  "add_finalizer",
  "add_finalizer_ref",
  "external_buffer",
  "empty_external_buffer",
  "external_arraybuffer",
];

// What the instance data finalizer prints.
const finalized = (kinds: string[], count = 3) =>
  kinds.map(kind => `${kind}: ${count} of ${count} finalized before the instance data finalizer`);
// What the cleanup hook prints: Node runs the queued finalizers before the env's cleanup hooks.
const hook = (count: number) => `cleanup hook: ${count} of ${count} values finalized before it`;

// BUN_DESTRUCT_VM_ON_EXIT destroys the VM of the main thread like a Worker's. The sanitizer lanes set it for every
// child, so a row about the default exit turns it off, and the leak check that goes with it.
const destruct = { BUN_DESTRUCT_VM_ON_EXIT: "1" };
// Debug builds: holds the post of a completion back until the Worker's VM waits for its thread pool, which is after
// the cleanup hooks.
const gate = { BUN_DEBUG_TEST_WORKER_TEARDOWN_GATE: "draining" };
const noDestruct = {
  BUN_DESTRUCT_VM_ON_EXIT: "0",
  ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
};

async function run(exe: string, code: string, env: Record<string, string> = {}) {
  await using proc = spawn({
    cmd: [exe, "--expose-gc", "-e", code],
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim().split(/\r?\n/), stderr, exitCode };
}

function scripts(target: string) {
  const prelude = `
    const collect = () => (typeof Bun === "object" ? Bun.gc(true) : global.gc());
    // Bun's thread pool holds a ticket of the VM until it has posted the completion of async work. Node waits for
    // the work when it tears the env down.
    const untilPosted = () => {
      if (typeof Bun !== "object") return;
      const { getEventLoopStats } = require("bun:internal-for-testing");
      while (getEventLoopStats().ticketsOutstanding > 0);
    };
    const addon = require(${JSON.stringify(addonPath(target))});
    const create = () => ${JSON.stringify(everyKind)}.map(kind => addon.create(kind, 3));
  `;
  return {
    // For the main thread, or for a Worker that the caller starts.
    script: (code: string) => prelude + code,
    inWorker: (code: string) => `
      const worker = new (require("node:worker_threads").Worker)(${JSON.stringify(prelude + code)}, { eval: true });
      worker.on("error", () => {});
      worker.on("message", () => worker.terminate());
    `,
  };
}

// The Worker tells its parent to terminate it, and does not return to its event loop.
const untilTerminated = `require("node:worker_threads").parentPort.postMessage("ready"); for (;;) {}`;

type Row = {
  name: string;
  code: string;
  stdout: string[];
  env?: Record<string, string>;
  // On Windows the handle is libuv's, and its close callback runs when the loop of the Worker is closed. #47776
  // replaces libuv there.
  todoOnWindows?: boolean;
};

// Bun prints what Node prints.
function likeNode(rows: Row[]) {
  for (const { name, code, stdout, env, todoOnWindows } of rows) {
    it.todoIf(!!todoOnWindows && isWindows)(`like Node: ${name}`, async () => {
      const [bun, node] = await Promise.all([run(bunExe(), code, env), run(await nodeExeMatchingAbi(), code, env)]);
      expect(bun).toEqual(node);
      expect(bun).toEqual({ stdout, stderr: "", exitCode: 0 });
    });
  }
}

function onlyBun(rows: Row[]) {
  for (const { name, code, stdout, env, todoOnWindows } of rows) {
    it.todoIf(!!todoOnWindows && isWindows)(name, async () => {
      expect(await run(bunExe(), code, env)).toEqual({ stdout, stderr: "", exitCode: 0 });
    });
  }
}

// Not covered: the callbacks of uv_queue_work and uv_async_send, which Bun drops at the exit, and the finalizer of a
// value that is alive at the exit. Also not covered: a queued finalizer or completion that joins a thread which ends
// only when a call of its threadsafe function returns napi_closing. The functions are open then, as in Node, and the
// join does not return, in Node or in Bun.
describe.skipIf(!canBuildNodeAddons())(
  "finalizers, completions, uv_close callbacks and threadsafe function calls that are queued when a VM exits run before the cleanup of the env",
  () => {
    describe("a regular module", () => {
      const { script, inWorker } = scripts(targets[0]);
      const created = `addon.reportCleanupHook(); let values = create();`;
      const collected = created + ` values = null; collect();`;
      const queuedWork = `addon.queueWork(); while (!addon.workExecuted());`;
      const completedWork = queuedWork + ` untilPosted();`;
      const everyValue = [hook(3 * everyKind.length), ...finalized(everyKind)];
      const completion = [
        "cleanup hook: async work completed before it",
        "async work: completed before the instance data finalizer",
      ];
      const closedHandle = [
        "cleanup hook: uv handle closed before it",
        "uv handle: closed before the instance data finalizer",
      ];
      const calls = (count: number) => [
        `cleanup hook: ${count} of ${count} threadsafe function calls delivered before it`,
        `threadsafe function: ${count} of ${count} calls delivered before the instance data finalizer`,
      ];
      const writesALine = `() => require("node:fs").writeSync(1, "a JavaScript function ran\\n")`;
      const threadsafeFunction = `addon.reportCleanupHook(); addon.createThreadsafeFunction();`;

      likeNode([
        {
          name: "values collected before process.exit() in a Worker",
          code: inWorker(collected + `process.exit(0);`),
          stdout: everyValue,
        },
        {
          name: "values collected before worker.terminate()",
          code: inWorker(collected + untilTerminated),
          stdout: everyValue,
        },
        {
          name: "values collected in an 'exit' listener of a Worker",
          code: inWorker(created + `process.on("exit", () => { values = null; collect(); });`),
          stdout: everyValue,
        },
        {
          name: "async work whose completion is queued when a Worker exits",
          code: inWorker(`addon.reportCleanupHook(); ${completedWork} process.exit(0);`),
          stdout: completion,
        },
        {
          name: "async work whose completion is queued before worker.terminate()",
          code: inWorker(`addon.reportCleanupHook(); ${completedWork} ${untilTerminated}`),
          stdout: completion,
        },
        {
          // The thread pool can post the completion after the cleanup hooks have run.
          name: "async work that completes as a Worker exits",
          code: inWorker(queuedWork + `process.exit(0);`),
          stdout: ["async work: completed before the instance data finalizer"],
        },
        {
          name: "a uv handle whose close callback is queued when a Worker exits",
          code: inWorker(
            `addon.reportCleanupHook(); addon.callFunctionFromCallbacks(${writesALine}); addon.closeUvHandle(); process.exit(0);`,
          ),
          stdout: [...closedHandle, "a call into JavaScript from a uv close callback returned 10"],
          todoOnWindows: true,
        },
        {
          name: "a uv handle whose close callback is queued before worker.terminate()",
          code: inWorker(`addon.reportCleanupHook(); addon.closeUvHandle(); ${untilTerminated}`),
          stdout: closedHandle,
          todoOnWindows: true,
        },
        {
          name: "a uv handle that a queued finalizer closes when a Worker exits",
          code: inWorker(`addon.reportCleanupHook(); addon.closeUvHandleInFinalizer(); collect(); process.exit(0);`),
          stdout: [
            hook(1),
            "cleanup hook: uv handle closed before it",
            ...finalized(["external"], 1),
            "uv handle: closed before the instance data finalizer",
          ],
          todoOnWindows: true,
        },
        ...[
          ["when a Worker exits", `process.exit(0);`],
          ["before worker.terminate()", untilTerminated],
        ].flatMap(([when, exit]) => [
          {
            name: `threadsafe function calls that are queued ${when}`,
            code: inWorker(`${threadsafeFunction} addon.callThreadsafeFunction(3); ${exit}`),
            stdout: calls(3),
          },
          {
            // The addon gets the two other calls back without an env.
            name: `a queued threadsafe function call that aborts the function ${when}`,
            code: inWorker(`${threadsafeFunction} addon.callThreadsafeFunction(3, true); ${exit}`),
            stdout: [
              "threadsafe function called without an env",
              "threadsafe function called without an env",
              "cleanup hook: 1 of 3 threadsafe function calls delivered before it",
              "threadsafe function: 1 of 3 calls delivered before the instance data finalizer",
            ],
          },
          {
            // The addon gets the calls back without an env, before the cleanup hooks.
            name: `threadsafe function calls that are queued behind an abort ${when}`,
            code: inWorker(`${threadsafeFunction} addon.abortThreadsafeFunction(3); ${exit}`),
            stdout: [
              "threadsafe function called without an env",
              "threadsafe function called without an env",
              "threadsafe function called without an env",
              "cleanup hook: 0 of 3 threadsafe function calls delivered before it",
              "threadsafe function: 0 of 3 calls delivered before the instance data finalizer",
            ],
          },
          {
            name: `a threadsafe function that a queued finalizer calls ${when}`,
            code: inWorker(`${threadsafeFunction} addon.callThreadsafeFunctionInFinalizer(); collect(); ${exit}`),
            stdout: [
              hook(1),
              calls(1)[0],
              ...finalized(["external"], 1),
              calls(1)[1],
              "threadsafe function: the call from a finalizer returned 0",
            ],
          },
        ]),
        {
          name: "a threadsafe function call that queues the next call when a Worker exits",
          code: inWorker(
            `${threadsafeFunction} addon.requeueInCall(4); addon.callThreadsafeFunction(1); process.exit(0);`,
          ),
          stdout: calls(5),
        },
        {
          // The hook is newer than the function, so Node runs it while the function is open. The call comes back
          // without an env when the function closes.
          name: "a threadsafe function that a cleanup hook calls when a Worker exits",
          code: inWorker(
            `addon.createThreadsafeFunction(); addon.callThreadsafeFunctionInCleanupHook(); addon.reportCleanupHook(); process.exit(0);`,
          ),
          stdout: [
            "cleanup hook: its call of the threadsafe function returned 0",
            "threadsafe function called without an env",
            "threadsafe function: 0 of 1 calls delivered before the instance data finalizer",
          ],
        },
        {
          name: "threadsafe function calls that are queued when an unhandled rejection ends a Worker",
          code: inWorker(
            `${threadsafeFunction} addon.callThreadsafeFunction(3); Promise.reject(new Error("unhandled"));`,
          ),
          stdout: calls(3),
        },
        {
          name: "values, async work and threadsafe function calls that are queued when an uncaught exception ends a Worker",
          code: inWorker(
            `${created} addon.createThreadsafeFunction(); setImmediate(() => { values = null; collect(); addon.callThreadsafeFunction(3); ${completedWork} throw new Error("uncaught"); });`,
          ),
          stdout: [hook(24), completion[0], calls(3)[0], ...finalized(everyKind), completion[1], calls(3)[1]],
        },
        {
          // Node runs the queued finalizers first, then turns its loop: the close callbacks, the completions of the
          // thread pool, then the calls of the threadsafe functions.
          name: "the order of the callbacks that are queued when a Worker exits",
          code: inWorker(
            `addon.reportEveryCallback(); addon.createThreadsafeFunction(); addon.closeUvHandle(); ${completedWork} let values = addon.create("external", 1); values = null; collect(); addon.callThreadsafeFunction(2); process.exit(0);`,
          ),
          stdout: [
            "external finalizer ran",
            "uv handle: close callback ran",
            "async work: complete ran",
            "threadsafe function: call ran",
            "threadsafe function: call ran",
            ...finalized(["external"], 1),
            completion[1],
            closedHandle[1],
            calls(2)[1],
          ],
          todoOnWindows: true,
        },
        {
          // Node delivers the queued calls of every env before the cleanup hooks of any env.
          name: "threadsafe function calls of two addons that are queued when a Worker exits",
          code: inWorker(`
            const second = require(${JSON.stringify(addonPath(targets[1]))});
            addon.reportCleanupHook();
            second.reportEveryCallback();
            for (const each of [addon, second]) {
              each.createThreadsafeFunction();
              each.callThreadsafeFunction(3);
            }
            process.exit(0);
          `),
          stdout: [
            "threadsafe function: call ran",
            "threadsafe function: call ran",
            "threadsafe function: call ran",
            ...calls(3),
            calls(3)[1],
          ],
        },
        {
          // The status is napi_pending_exception: the env refuses a call into JavaScript, and the function does not run.
          name: "a queued finalizer and a queued completion that call a JavaScript function when a Worker exits",
          code: inWorker(
            `addon.callFunctionFromCallbacks(${writesALine}); let values = addon.create("external", 1); values = null; collect(); ${completedWork} process.exit(0);`,
          ),
          stdout: [
            ...finalized(["external"], 1),
            "async work: completed before the instance data finalizer",
            "a call into JavaScript from a finalizer returned 10",
            "a call into JavaScript from complete returned 10",
          ],
        },
        {
          // Node tears down no env here, and Bun runs no callback of the addon.
          name: "process.exit() on the main thread with callbacks queued",
          code: script(
            `addon.reportEveryCallback(); let values = create(); values = null; collect(); ${completedWork} ${isWindows ? "" : "addon.closeUvHandle();"} process.exit(0);`,
          ),
          stdout: [""],
          env: noDestruct,
        },
      ]);

      onlyBun([
        {
          // Node stops at a count of its own. The call that is left comes back without an env.
          name: "a threadsafe function call that always queues the next call when a Worker exits",
          code: inWorker(
            `${threadsafeFunction} addon.requeueInCall(-1); addon.callThreadsafeFunction(1); process.exit(0);`,
          ),
          stdout: [
            "cleanup hook: 1001 of 1002 threadsafe function calls delivered before it",
            "threadsafe function called without an env",
            "threadsafe function: 1001 of 1002 calls delivered before the instance data finalizer",
          ],
        },
        {
          // The status is napi_generic_failure, as after the teardown of the env: Bun closes the threadsafe functions
          // of an env after its cleanup hooks, so a new one would stay open for each of them. Node creates it.
          name: "a threadsafe function that a queued finalizer creates when a Worker exits",
          code: inWorker(
            `addon.reportCleanupHook(); addon.createThreadsafeFunctionInFinalizer(); collect(); process.exit(0);`,
          ),
          stdout: [
            hook(1),
            ...finalized(["external"], 1),
            "threadsafe function: its creation in a finalizer returned 9",
          ],
        },
        {
          // Not a Worker: as at a process exit, the call is accepted and no call_js runs.
          name: "a threadsafe function that a queued finalizer calls when process.exit() destroys the VM of the main thread",
          code: script(`${threadsafeFunction} addon.callThreadsafeFunctionInFinalizer(); collect(); process.exit(0);`),
          stdout: [
            hook(1),
            "cleanup hook: 0 of 1 threadsafe function calls delivered before it",
            ...finalized(["external"], 1),
            "threadsafe function: 0 of 1 calls delivered before the instance data finalizer",
            "threadsafe function: the call from a finalizer returned 0",
          ],
          env: destruct,
        },
        {
          name: "values collected before process.exit() destroys the VM of the main thread",
          code: script(collected + `process.exit(0);`),
          stdout: everyValue,
          env: destruct,
        },
        {
          name: "async work that completes as process.exit() destroys the VM of the main thread",
          code: script(queuedWork + `process.exit(0);`),
          stdout: ["async work: completed before the instance data finalizer"],
          env: destruct,
        },
        {
          // The exit begins inside complete(), which does not return. The work object stays allocated. The row
          // passes on main: it guards the env's count of async work, which an assertion of debug builds checks.
          name: "a completion that calls process.exit() when the VM of the main thread is destroyed",
          code: script(`addon.callFunctionFromCallbacks(() => process.exit(0)); addon.queueWork();`),
          stdout: [
            "async work: completed before the instance data finalizer",
            "a call into JavaScript from complete did not return",
          ],
          env: { ...destruct, ASAN_OPTIONS: noDestruct.ASAN_OPTIONS },
        },
        {
          name: "a uv handle whose close callback is queued when process.exit() destroys the VM of the main thread",
          code: script(`addon.reportCleanupHook(); addon.closeUvHandle(); process.exit(0);`),
          stdout: closedHandle,
          env: destruct,
          todoOnWindows: true,
        },
      ]);

      // The thread calls a threadsafe function with room for one call, and waits for room each time. Its calls run
      // with an env only before the cleanup hooks: what it queues later comes back without an env. Node delivers in
      // the same way, but it can then deadlock: it finalizes the live wrap, whose finalizer joins the thread, while
      // it holds the mutex of the function that the thread needs to wake. So the row runs on Bun only.
      it("a thread that calls a threadsafe function while a Worker exits", async () => {
        const code = inWorker(
          `addon.reportCleanupHook(); globalThis.producer = addon.startProducer(); while (addon.producerCalls() < 1); process.exit(0);`,
        );
        expect(await run(bunExe(), code)).toEqual({
          stdout: ["cleanup hook: 0 of 1 values finalized before it", ...finalized(["wrap"], 1)],
          stderr: "",
          exitCode: 0,
        });
      });

      // No VM teardown follows the default exit of the main thread, so the env must not wait for one. Node runs the
      // completion here and Bun does not: the row checks only that the instance data finalizer runs.
      it("async work that an 'exit' listener of the main thread queues", async () => {
        const { stdout, stderr, exitCode } = await run(
          bunExe(),
          script(`process.on("exit", () => { ${completedWork} });`),
          noDestruct,
        );
        expect({ finalizers: stdout.filter(line => line.startsWith("async work: ")).length, stderr, exitCode }).toEqual(
          {
            finalizers: 1,
            stderr: "",
            exitCode: 0,
          },
        );
      });

      it.skipIf(!isDebug && !isASAN)("async work whose completion arrives while the VM of a Worker waits", async () => {
        const { stdout, stderr, exitCode } = await run(bunExe(), inWorker(queuedWork + `process.exit(0);`), gate);
        const late = stderr.split(/\r?\n/).filter(line => line.startsWith("[vm] late completion from "));
        expect({ stdout, late: late.map(line => line.includes("napi_body.rs")), exitCode }).toEqual({
          stdout: ["async work: completed before the instance data finalizer"],
          late: [true],
          exitCode: 0,
        });
      });

      // The release of the addon's callbacks sets every other queued task aside. A completed fs.open() that is
      // released closes its descriptor, so a task that is not put back leaves one open.
      it.skipIf(isWindows)("fs jobs that are queued beside an addon's finalizers when a Worker exits", async () => {
        const worker = script(`
        const fs = require("node:fs");
        const descriptors = () => fs.readdirSync("/dev/fd").length;
        addon.reportCleanupHook();
        let values = addon.create("external", 3);
        const before = descriptors();
        for (let i = 0; i < 8; i++) fs.open(process.execPath, "r", () => console.log("an open() callback ran"));
        while (descriptors() < before + 8);
        values = null;
        collect();
        process.exit(0);
      `);
        // The first Worker makes the process open what it opens once for every Worker.
        const code = `
        const { Worker } = require("node:worker_threads");
        const descriptors = () => require("node:fs").readdirSync("/dev/fd").length;
        new Worker("", { eval: true }).on("exit", () => {
          const before = descriptors();
          const worker = new Worker(${JSON.stringify(worker)}, { eval: true });
          worker.on("exit", () => console.log("descriptors left open: " + (descriptors() - before)));
        });
      `;
        expect(await run(bunExe(), code)).toEqual({
          stdout: [hook(3), ...finalized(["external"]), "descriptors left open: 0"],
          stderr: "",
          exitCode: 0,
        });
      });

      // A macro runs on an event loop of its own, which stops when the macro returns.
      it("values collected inside a macro, when the VM of the main thread is destroyed", async () => {
        const kinds = ["external", "wrap", "add_finalizer_ref"];
        using dir = tempDir("napi-finalizer-order-macro", {
          "macro.ts": `
          export function collectInMacro() {
            const module = { exports: {} };
            process.dlopen(module, ${JSON.stringify(addonPath(targets[0]))});
            let values = ${JSON.stringify(kinds)}.map(kind => module.exports.create(kind, 3));
            values = null;
            Bun.gc(true);
            return 0;
          }
        `,
          "main.ts": `
          import { collectInMacro } from "./macro.ts" with { type: "macro" };
          collectInMacro();
        `,
        });
        await using proc = spawn({
          cmd: [bunExe(), "main.ts"],
          cwd: String(dir),
          env: { ...bunEnv, ...destruct },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        // A debug build logs each macro call.
        const lines = stdout.split(/\r?\n/).filter(line => line && !line.startsWith("[macro]"));
        expect({ stdout: lines, stderr, exitCode }).toEqual({ stdout: finalized(kinds), stderr: "", exitCode: 0 });
      });
    });

    // The finalizer of a value runs inside the collection here, so only
    // node_api_post_finalizer queues one.
    describe("an experimental module", () => {
      const { inWorker } = scripts(targets[1]);
      const posted = [hook(3), ...finalized(["posted"])];

      likeNode([
        {
          name: "node_api_post_finalizer before process.exit() in a Worker",
          code: inWorker(`addon.reportCleanupHook(); addon.post(3); process.exit(0);`),
          stdout: posted,
        },
        {
          name: "node_api_post_finalizer in an 'exit' listener of a Worker",
          code: inWorker(`addon.reportCleanupHook(); process.on("exit", () => addon.post(3));`),
          stdout: posted,
        },
        {
          name: "a posted finalizer that posts the next one when a Worker exits",
          code: inWorker(`addon.reportCleanupHook(); addon.postChain(3); process.exit(0);`),
          stdout: posted,
        },
      ]);

      // The env holds the finalizer of the wrap until the VM has waited for the completion. Node runs the posted
      // finalizer before the instance data finalizer. Bun runs it after: the row checks only that it runs.
      it.skipIf(!isDebug && !isASAN)("a finalizer that a held finalizer posts", async () => {
        const { stdout, exitCode } = await run(
          bunExe(),
          inWorker(
            `globalThis.keep = addon.createWrapThatPosts(); addon.queueWork(); while (!addon.workExecuted()); process.exit(0);`,
          ),
          gate,
        );
        const ran = [
          "posted: 1 of 1 finalized before the instance data finalizer",
          "posted finalized after the instance data finalizer",
        ];
        expect({ posted: stdout.filter(line => ran.includes(line)).length, exitCode }).toEqual({
          posted: 1,
          exitCode: 0,
        });
      });
    });
  },
);

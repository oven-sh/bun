import { spawn, spawnSync } from "bun";
import { beforeAll, describe, expect, it } from "bun:test";
import { existsSync, statSync } from "fs";
import { bunEnv, bunExe, canBuildNodeAddons, isASAN, isWindows, nodeExeMatchingAbi, tempDir } from "harness";
import { join } from "path";

// An addon reads its napi_set_instance_data pointer from its other callbacks:
// the finalizer of a value, the complete callback of async work, the close
// callback of a uv handle. Node runs these before the finalizer of instance
// data that the addon sets in its init. Where Node's env teardown finalizes
// the values that are still alive, it takes the newest first.
//
// The fixture's instance data finalizer prints what ran before it. A callback
// that runs after it prints a line of its own.
//
// The rows run one at a time: each starts a Bun and a Node, most of them with
// a Worker, and a debug build is slow to start either.

const napiAppDir = join(__dirname, "napi-app");
const source = join(napiAppDir, "test_instance_data_finalizer_order.c");
const targets = ["test_instance_data_finalizer_order", "test_instance_data_finalizer_order_experimental"];
// The same addon as a native plugin for Bun.build().
const pluginTarget = "test_instance_data_finalizer_order_plugin";
const addonPath = (target: string) => join(napiAppDir, `build/Debug/${target}.node`);

function isBuilt() {
  const sourceTime = statSync(source).mtimeMs;
  return [...targets, pluginTarget].every(
    target => existsSync(addonPath(target)) && statSync(addonPath(target)).mtimeMs >= sourceTime,
  );
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
  // targets of this file.
  if (!existsSync(join(napiAppDir, "node_modules/node-gyp"))) {
    run([bunExe(), "install", "--ignore-scripts", "--verbose"]);
  }
  run([bunExe(), "--bun", "node-gyp", "configure", "build", "--debug", "-j", "max", ...targets, pluginTarget]);
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
// The default exit of Bun's main thread finalizes the live values of these
// kinds. It leaves the others to the end of the process.
const kindsOfEveryExit = ["wrap", "wrap_ref", "external_buffer", "external_arraybuffer"];

const finalized = (kinds: string[], count = 3, of = count) =>
  kinds.map(kind => `${kind}: ${count} of ${of} finalized before the instance data finalizer`);

const noLeakCheck = { ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":") };
// BUN_DESTRUCT_VM_ON_EXIT (the sanitizer lanes set it for every child)
// destroys the main thread's VM like a Worker's, and tears the envs down
// first, on every exit. A row about the default exit opts out of it and of
// the leak check that goes with it.
const noDestruct = { BUN_DESTRUCT_VM_ON_EXIT: "0", ...noLeakCheck };
// A collection every few allocations, so that one runs inside the teardown of
// the env. ASAN does not see the allocator of JavaScriptCore, so it is off,
// and with it off LeakSanitizer reports what JavaScriptCore keeps for the
// life of the process.
const collectOften = {
  BUN_JSC_slowPathAllocsBetweenGCs: "17",
  ...(isASAN ? { Malloc: "1", ...noLeakCheck } : {}),
};

type Row = { name: string; code: string; stdout: string[]; env?: Record<string, string>; skip?: boolean };

describe.skipIf(!canBuildNodeAddons()).each([
  ["a regular module", targets[0]],
  ["an experimental module", targets[1]],
])("the instance data finalizer of %s runs after its other callbacks", (_, target) => {
  const experimental = target === targets[1];
  const prelude = `
    const collect = () => (typeof Bun === "object" ? Bun.gc(true) : global.gc());
    const addon = require(${JSON.stringify(addonPath(target))});
    const everyKind = ${JSON.stringify(everyKind)};
    const kindsOfEveryExit = ${JSON.stringify(kindsOfEveryExit)};
    // Three values of each kind: a forced collection can miss one.
    const create = kinds => kinds.map(kind => addon.create(kind, 3));
  `;
  const workerOf = (code: string) =>
    `new (require("node:worker_threads").Worker)(${JSON.stringify(prelude + code)}, { eval: true })`;
  const onMainThread = (code: string) => prelude + code;
  const inWorker = (code: string) => `
    const worker = ${workerOf(code)};
    worker.on("error", () => {});
    worker.on("message", () => worker.terminate());
  `;
  const collected = `addon.reportCleanupHook(); let values = create(everyKind); values = null; collect();`;
  // Node runs the finalizers that a collection queued before the env's cleanup hooks.
  const hook = "cleanup hook: after the queued finalizers";

  const run = async (exe: string, code: string, env: Record<string, string> = {}) => {
    await using proc = spawn({
      cmd: [exe, "--expose-gc", "-e", code],
      env: { ...bunEnv, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim().split(/\r?\n/), stderr, exitCode };
  };

  const likeNode: Row[] = [
    {
      name: "values collected in an 'exit' listener of a Worker",
      code: inWorker(
        `addon.reportCleanupHook(); let values = create(everyKind); process.on("exit", () => { values = null; collect(); });`,
      ),
      stdout: [hook, ...finalized(everyKind)],
    },
    {
      name: "values collected before process.exit() in a Worker",
      code: inWorker(collected + `process.exit(0);`),
      stdout: [hook, ...finalized(everyKind)],
    },
    {
      name: "values collected before worker.terminate()",
      code: inWorker(collected + `require("node:worker_threads").parentPort.postMessage("ready"); for (;;) {}`),
      stdout: [hook, ...finalized(everyKind)],
    },
    {
      name: "values collected before an uncaught exception in a Worker",
      code: inWorker(collected + `throw new Error("uncaught");`),
      stdout: [hook, ...finalized(everyKind)],
    },
    {
      name: "values alive when a Worker exits",
      code: inWorker(`globalThis.values = create(everyKind);`),
      stdout: finalized(everyKind),
    },
    {
      // The newest first, after the cleanup hooks. Node finalizes an external
      // buffer before the hooks, so the row has none.
      name: "the order of the finalizers of values alive when a Worker exits",
      code: inWorker(`
        addon.reportCleanupHook();
        globalThis.values = addon.createInOrder(
          ["external", "wrap", "add_finalizer", "wrap_ref", "external", "add_finalizer_ref", "wrap"],
        );
      `),
      stdout: [
        "cleanup hook: before every finalizer",
        ...finalized(["external", "wrap"], 2),
        ...finalized(["wrap_ref", "add_finalizer", "add_finalizer_ref"], 1),
        "order: wrap add_finalizer_ref external wrap_ref add_finalizer wrap external",
      ],
    },
    {
      name: "values alive in a Worker that exits while its own Worker runs",
      // Node stops the inner Worker before the outer one tears its envs down.
      code: `new (require("node:worker_threads").Worker)(${JSON.stringify(`
        ${prelude}
        globalThis.values = create(["external", "add_finalizer"]);
        const inner = ${workerOf(`
          globalThis.values = create(["wrap"]);
          const { parentPort } = require("node:worker_threads");
          parentPort.on("message", () => {});
          parentPort.postMessage("ready");
        `)};
        inner.on("message", () => process.exit(0));
      `)}, { eval: true });`,
      stdout: [...finalized(["wrap"]), ...finalized(["external", "add_finalizer"])],
    },
    {
      name: "finalizers that the addon took back before a Worker exits",
      code: inWorker(
        `globalThis.values = ["wrap", "wrap_ref", "add_finalizer_ref"].map(kind => addon.createCancelled(kind, 3));`,
      ),
      stdout: finalized(["wrap", "wrap_ref", "add_finalizer_ref"], 0, 3),
    },
    {
      name: "finalizers that the addon took back before the loop of the main thread runs dry",
      code: onMainThread(
        `globalThis.values = ["wrap", "wrap_ref", "add_finalizer_ref"].map(kind => addon.createCancelled(kind, 3));`,
      ),
      stdout: finalized(["wrap", "wrap_ref", "add_finalizer_ref"], 0, 3),
    },
    {
      name: "values collected in an 'exit' listener of the main thread",
      code: onMainThread(
        `addon.reportCleanupHook(); let values = create(kindsOfEveryExit); process.on("exit", () => { values = null; collect(); });`,
      ),
      stdout: [hook, ...finalized(kindsOfEveryExit)],
    },
    {
      name: "async work that completes as a Worker exits",
      // The completion is on its way to the loop, or queued on it, when the Worker exits.
      code: inWorker(`addon.queueWork(); while (!addon.workExecuted()); process.exit(0);`),
      stdout: ["async work: completed before the instance data finalizer"],
    },
    {
      name: "a uv handle whose close callback is queued as a Worker exits",
      code: inWorker(`addon.reportCleanupHook(); addon.closeUvHandle(); process.exit(0);`),
      stdout: ["cleanup hook: uv handle closed before it", "uv handle: closed before the instance data finalizer"],
      // On Windows the handle is libuv's, and its close callback runs when the Worker's loop is closed.
      skip: isWindows,
    },
    {
      name: "a uv handle that a queued finalizer closes as a Worker exits",
      // The value is created in an earlier turn, so that the collection finds nothing of it on the stack.
      code: inWorker(
        `addon.reportCleanupHook(); addon.closeUvHandleInFinalizer(); setImmediate(() => { collect(); process.exit(0); });`,
      ),
      stdout: [
        hook,
        "cleanup hook: uv handle closed before it",
        ...finalized(["external"], 1),
        "uv handle: closed before the instance data finalizer",
      ],
      skip: isWindows,
    },
    {
      name: "an escapable handle scope in the instance data finalizer of a Worker",
      code: inWorker(`addon.openScopeInInstanceDataFinalizer();`),
      stdout: ["escapable handle scope: open=0 escape=0 close=0"],
    },
    {
      name: "an escapable handle scope in the instance data finalizer of the main thread",
      code: onMainThread(`addon.openScopeInInstanceDataFinalizer();`),
      stdout: ["escapable handle scope: open=0 escape=0 close=0"],
    },
    {
      // Node tears down no env there, so no finalizer runs.
      name: "process.exit() on the main thread",
      code: onMainThread(collected + `process.exit(0);`),
      stdout: [""],
      env: noDestruct,
    },
  ];
  if (experimental) {
    const posted = [hook, "posted: 3 of 3 finalized before the instance data finalizer"];
    likeNode.push(
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
        name: "node_api_post_finalizer in the instance data finalizer",
        code: inWorker(`addon.postFromInstanceDataFinalizer();`),
        stdout: ["the finalizer that the instance data finalizer posted ran"],
      },
    );
  }
  for (const { name, code, stdout, env, skip } of likeNode) {
    it.skipIf(!!skip)(`like Node: ${name}`, async () => {
      const [bun, node] = await Promise.all([run(bunExe(), code, env), run(await nodeExeMatchingAbi(), code)]);
      expect(bun).toEqual(node);
      expect(bun).toEqual({ stdout, stderr: "", exitCode: 0 });
    });
  }

  const onlyBun: Row[] = [
    {
      // Node finalizes instance data that is set after a value before that
      // value, and the value's finalizer then reads freed instance data.
      name: "when the instance data is set again after values exist",
      code: inWorker(`globalThis.values = create(everyKind); addon.setInstanceDataAgain();`),
      stdout: finalized(everyKind),
    },
    {
      // Node finalizes a live external buffer before the cleanup hooks.
      name: "the order of the finalizers of live values and external buffers",
      code: inWorker(`
        addon.reportCleanupHook();
        globalThis.values = addon.createInOrder(
          ["external_buffer", "external", "external_arraybuffer", "wrap", "empty_external_buffer"],
        );
      `),
      stdout: [
        "cleanup hook: before every finalizer",
        ...finalized(["external", "wrap", "external_buffer", "empty_external_buffer", "external_arraybuffer"], 1),
        "order: empty_external_buffer wrap external_arraybuffer external external_buffer",
      ],
    },
    {
      // Node finalizes every kind here. Bun's default exit of the main thread
      // tears down no VM, and leaves these values to the end of the process.
      name: "values alive when the loop of the main thread runs dry",
      code: onMainThread(`globalThis.values = create(everyKind);`),
      stdout: everyKind.flatMap(kind => finalized([kind], kindsOfEveryExit.includes(kind) ? 3 : 0, 3)),
      env: noDestruct,
    },
    {
      name: "when process.exit() destroys the VM of the main thread",
      code: onMainThread(collected + `process.exit(0);`),
      stdout: [hook, ...finalized(everyKind)],
      env: { BUN_DESTRUCT_VM_ON_EXIT: "1" },
    },
    {
      name: "async work that completes as process.exit() destroys the VM of the main thread",
      code: onMainThread(`addon.queueWork(); while (!addon.workExecuted()); process.exit(0);`),
      stdout: ["async work: completed before the instance data finalizer"],
      env: { BUN_DESTRUCT_VM_ON_EXIT: "1" },
    },
    {
      // Node crashes when the work completes.
      name: "async work that the finalizer of a live value queues when a Worker exits",
      code: inWorker(`globalThis.value = addon.queueWorkInFinalizer();`),
      stdout: [...finalized(["external"], 1), "async work: completed before the instance data finalizer"],
    },
    {
      name: "collections inside the teardown of a Worker",
      code: inWorker(`let values = everyKind.map(kind => addon.create(kind, 100)); values = null; process.exit(0);`),
      stdout: finalized(everyKind, 100),
      env: collectOften,
    },
    {
      name: "collections inside the teardown of the main thread",
      code: onMainThread(`let values = kindsOfEveryExit.map(kind => addon.create(kind, 100)); values = null;`),
      stdout: finalized(kindsOfEveryExit, 100),
      env: collectOften,
    },
  ];
  for (const { name, code, stdout, env } of onlyBun) {
    it(name, async () => {
      expect(await run(bunExe(), code, env)).toEqual({ stdout, stderr: "", exitCode: 0 });
    });
  }

  // A macro runs on an event loop of its own. The finalizers of an
  // experimental module do not wait for a loop.
  describe.skipIf(experimental)("values collected inside a macro", () => {
    const load = `
      const module = { exports: {} };
      process.dlopen(module, ${JSON.stringify(addonPath(target))});
      const addon = module.exports;
    `;
    const runBun = async (args: string[], files: Record<string, string>, env: Record<string, string> = {}) => {
      using dir = tempDir("napi-finalizer-order-macro", files);
      await using proc = spawn({
        cmd: [bunExe(), ...args],
        cwd: String(dir),
        env: { ...bunEnv, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // A debug build logs each macro call.
      const lines = stdout.split(/\r?\n/).filter(line => line && !line.startsWith("[macro]"));
      return { stdout: lines, stderr, exitCode };
    };

    // The macro's loop stops when the macro returns. The finalizers then run on the loop of the program.
    it("a macro that returns at once", async () => {
      const result = await runBun(["main.ts"], {
        "macro.ts": `
          export function collectInMacro() {
            ${load}
            let values = ["wrap", "wrap_ref"].map(kind => addon.create(kind, 3));
            values = null;
            Bun.gc(true);
            return 0;
          }
        `,
        "main.ts": `
          import { collectInMacro } from "./macro.ts" with { type: "macro" };
          collectInMacro();
          const addon = require(${JSON.stringify(addonPath(target))});
          for (let turns = 0; addon.finalizedInProcess() === 0 && turns < 100; turns++) {
            await new Promise(resolve => setImmediate(resolve));
          }
          console.log("finalizers ran on the loop:", addon.finalizedInProcess() > 0);
        `,
      });
      expect(result).toEqual({
        stdout: ["finalizers ran on the loop: true", ...finalized(["wrap", "wrap_ref"])],
        stderr: "",
        exitCode: 0,
      });
    });

    // While a macro waits for a promise, only its own loop turns. The VM of a
    // build, or of a module that another thread transpiles, has no other loop.
    // Bun never tears that VM down, so LeakSanitizer reports what the env of
    // an addon holds.
    const asyncMacro = {
      "macro.ts": `
        export async function collectInMacro() {
          ${load}
          let values = ["wrap", "wrap_ref", "external_buffer"].map(kind => addon.create(kind, 10));
          values = null;
          for (let turns = 0; addon.finalizedInProcess() < 30 && turns < 500; turns++) {
            Bun.gc(true);
            await new Promise(resolve => setTimeout(resolve, 1));
          }
          return addon.finalizedInProcess() + " of 30 finalized while the macro waited";
        }
      `,
      "lib.ts": `
        import { collectInMacro } from "./macro.ts" with { type: "macro" };
        export const finalized = collectInMacro();
      `,
      "main.ts": `
        import { finalized } from "./lib.ts";
        console.log(finalized);
      `,
    };
    it("a macro that waits, in a module that the main thread does not transpile", async () => {
      const result = await runBun(["main.ts"], asyncMacro, noLeakCheck);
      expect(result).toEqual({ stdout: ["30 of 30 finalized while the macro waited"], stderr: "", exitCode: 0 });
    });
    it("a macro that waits, in bun build", async () => {
      const { stdout, stderr, exitCode } = await runBun(["build", "main.ts"], asyncMacro, noLeakCheck);
      expect({ stdout: stdout.join("\n"), stderr, exitCode }).toEqual({
        stdout: expect.stringContaining(`"30 of 30 finalized while the macro waited"`),
        stderr: "",
        exitCode: 0,
      });
    });
  });
});

// Threads of the bundler call a native plugin until its build ends. The
// plugin's first call returns after a cleanup hook of the env has run, and
// then waits for a moment to see the instance data finalizer.
it.skipIf(!canBuildNodeAddons())("a build that is inside a native bundler plugin when a Worker exits", async () => {
  const worker = `
    const addon = require(${JSON.stringify(addonPath(pluginTarget))});
    addon.holdPluginUntilCleanupHook();
    globalThis.values = ${JSON.stringify(everyKind)}.map(kind => addon.create(kind, 3));
    Bun.build({
      entrypoints: [${JSON.stringify(join(napiAppDir, "main.js"))}],
      plugins: [{
        name: "native",
        setup(build) {
          build.onBeforeParse({ filter: /./ }, { napiModule: addon, symbol: "plugin_on_before_parse" });
        },
      }],
    });
    (async () => {
      while (!addon.pluginEntered()) await new Promise(resolve => setImmediate(resolve));
      process.exit(0);
    })();
  `;
  await using proc = spawn({
    cmd: [bunExe(), "-e", `new (require("node:worker_threads").Worker)(${JSON.stringify(worker)}, { eval: true });`],
    // process.dlopen() never frees what it keeps for a native plugin.
    env: { ...bunEnv, ...noLeakCheck },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim().split(/\r?\n/), stderr, exitCode }).toEqual({
    stdout: ["native bundler plugin: returned before the instance data finalizer", ...finalized(everyKind)],
    stderr: "",
    exitCode: 0,
  });
});

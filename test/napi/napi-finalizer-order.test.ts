import { spawn, spawnSync } from "bun";
import { beforeAll, describe, expect, it } from "bun:test";
import { existsSync, statSync } from "fs";
import { bunEnv, bunExe, canBuildNodeAddons, isWindows, nodeExeMatchingAbi, tempDir } from "harness";
import { join } from "path";

// Node's env teardown (node_napi_env__::DeleteMe) runs the finalizers that a
// collection queued, then the finalizer of every value that is still alive,
// newest first. The instance data that an addon sets in its init is the oldest
// entry, so its finalizer runs last. A finalize callback, and the complete
// callback of async work, can therefore read the instance data whenever they
// run. The fixture's instance data finalizer prints how many callbacks of each
// kind ran before it. A callback that runs after it prints a line of its own.
//
// The rows run one at a time: each starts a Bun and a Node, most of them with
// a Worker, and a debug build is slow to start either.

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

describe.skipIf(!canBuildNodeAddons()).each([
  ["a regular module", targets[0]],
  ["an experimental module", targets[1]],
])("the instance data finalizer of %s runs after its other callbacks", (_, target) => {
  const experimental = target === targets[1];
  const kinds = [
    "external",
    "wrap",
    "wrap_ref",
    "add_finalizer",
    "add_finalizer_ref",
    "external_buffer",
    "empty_external_buffer",
    "external_arraybuffer",
  ];
  const prelude = `
    const collect = () => (typeof Bun === "object" ? Bun.gc(true) : global.gc());
    const addon = require(${JSON.stringify(addonPath(target))});
    // Three values of each kind: a forced collection can miss one.
    const create = () => ${JSON.stringify(kinds)}.map(kind => addon.create(kind, 3));
  `;
  const onMainThread = (body: string) => prelude + body;
  const inWorker = (body: string) => `
    const worker = new (require("node:worker_threads").Worker)(${JSON.stringify(prelude + body)}, { eval: true });
    worker.on("error", () => {});
    worker.on("message", () => worker.terminate());
  `;
  const collected = `addon.reportCleanupHook(); let values = create(); values = null; collect();`;
  const inExitListener = `addon.reportCleanupHook(); let values = create(); process.on("exit", () => { values = null; collect(); });`;
  // Node runs the queued finalizers before the env's cleanup hooks.
  const hook = "cleanup hook: after the finalizers of the collected values";
  const all = kinds.map(kind => `${kind}: 3 of 3 finalized before the instance data finalizer`);
  const posted = [hook, "posted: 3 of 3 finalized before the instance data finalizer"];
  // BUN_DESTRUCT_VM_ON_EXIT (the sanitizer lanes set it for every child)
  // destroys the main thread's VM like a Worker's, and tears the envs down
  // first, on every exit. A row that expects no teardown opts out of it and of
  // the leak check that goes with it.
  const noDestruct = {
    BUN_DESTRUCT_VM_ON_EXIT: "0",
    ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
  };

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

  const rows: Array<{ name: string; code: string; stdout: string[]; env?: Record<string, string>; skip?: boolean }> = [
    {
      name: "values collected in an 'exit' listener of a Worker",
      code: inWorker(inExitListener),
      stdout: [hook, ...all],
    },
    {
      name: "values collected before process.exit() in a Worker",
      code: inWorker(collected + `process.exit(0);`),
      stdout: [hook, ...all],
    },
    {
      name: "values collected before worker.terminate()",
      code: inWorker(collected + `require("node:worker_threads").parentPort.postMessage("ready"); for (;;) {}`),
      stdout: [hook, ...all],
    },
    {
      name: "values collected before an uncaught exception in a Worker",
      code: inWorker(collected + `throw new Error("uncaught");`),
      stdout: [hook, ...all],
    },
    { name: "values alive when a Worker exits", code: inWorker(`globalThis.values = create();`), stdout: all },
    {
      name: "values collected in an 'exit' listener of the main thread",
      code: onMainThread(inExitListener),
      stdout: [hook, ...all],
    },
    {
      name: "values alive when the loop of the main thread runs dry",
      code: onMainThread(`globalThis.values = create();`),
      stdout: all,
    },
    {
      name: "async work that completes as a Worker exits",
      // The loop waits for execute() to return, so the completion is queued when the Worker exits.
      code: inWorker(`addon.queueWork(); while (!addon.workExecuted()); process.exit(0);`),
      stdout: ["async work: completed before the instance data finalizer"],
    },
    {
      name: "a uv handle whose close callback is queued as a Worker exits",
      code: inWorker(`addon.closeUvHandle(); process.exit(0);`),
      stdout: ["uv handle: closed before the instance data finalizer"],
      // On Windows the handle is libuv's, and its close callback runs when the Worker's loop is closed.
      skip: isWindows,
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
    rows.push(
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
  for (const { name, code, stdout, env, skip } of rows) {
    it.skipIf(!!skip)(`like Node: ${name}`, async () => {
      const [bun, node] = await Promise.all([run(bunExe(), code, env), run(await nodeExeMatchingAbi(), code)]);
      expect(bun).toEqual(node);
      expect(bun).toEqual({ stdout, stderr: "", exitCode: 0 });
    });
  }

  // Node finalizes instance data that is set after a value before that value,
  // and the value's finalizer then reads freed instance data. Bun keeps the
  // instance data finalizer last.
  it("when the instance data is set again after values exist", async () => {
    const code = inWorker(`globalThis.values = create(); addon.setInstanceDataAgain();`);
    expect(await run(bunExe(), code)).toEqual({ stdout: all, stderr: "", exitCode: 0 });
  });

  it("when process.exit() destroys the VM of the main thread", async () => {
    const code = onMainThread(collected + `process.exit(0);`);
    expect(await run(bunExe(), code, { BUN_DESTRUCT_VM_ON_EXIT: "1" })).toEqual({
      stdout: [hook, ...all],
      stderr: "",
      exitCode: 0,
    });
  });

  // A macro runs on an event loop of its own, which stops turning when the
  // macro returns. The finalizers of an experimental module do not wait for a
  // loop.
  it.skipIf(experimental)("when values are collected inside a macro", async () => {
    using dir = tempDir("napi-finalizer-order-macro", {
      "macro.ts": `
        export function collectInMacro() {
          const module = { exports: {} };
          process.dlopen(module, ${JSON.stringify(addonPath(target))});
          let values = ["wrap_ref", "add_finalizer_ref"].map(kind => module.exports.create(kind, 3));
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
    await using proc = spawn({
      cmd: [bunExe(), "main.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // A debug build logs each macro call.
    const lines = stdout.split(/\r?\n/).filter(line => line && !line.startsWith("[macro]"));
    expect({ stdout: lines, stderr, exitCode }).toEqual({
      stdout: [
        "finalizers ran on the loop: true",
        "wrap_ref: 3 of 3 finalized before the instance data finalizer",
        "add_finalizer_ref: 3 of 3 finalized before the instance data finalizer",
      ],
      stderr: "",
      exitCode: 0,
    });
  });
});

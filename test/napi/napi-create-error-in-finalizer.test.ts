import { spawn, spawnSync } from "bun";
import { beforeAll, expect, it } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

const addonPath = join(__dirname, "napi-app/build/Debug/test_create_error_in_finalizer.node");

// Every call node-addon-api's Napi::Error::New(env) + Error::ThrowAsJavaScriptException
// chain makes, reported by the addon finalizer that runs during environment
// cleanup at process exit. Node returns napi_ok for all of them even while an
// exception is pending, because none of these functions perform a
// pending-exception check (js_native_api_v8.cc). Bun used to fail them with
// napi_pending_exception, which node-addon-api escalates to
// "NAPI FATAL ERROR: Error::New napi_create_error" and aborts the process.
const allOk =
  "create_error_in_finalizer: get_last_error_info=0 is_exception_pending=0 " +
  "create_string_utf8=0 create_string_utf8_non_ascii=0 create_string_latin1=0 " +
  "create_string_utf16=0 create_error=0 create_type_error=0 " +
  "create_range_error=0 create_syntax_error=0 create_reference=0 " +
  "get_reference_value=0 reference_ref=0 reference_unref=0 delete_reference=0 " +
  "results_non_null=1";

beforeAll(() => {
  // Build the native addons in napi-app, but only if the one this test needs
  // is missing (napi.test.ts or a previous run usually has built it already).
  // The addon doesn't link against bun, so an existing binary stays valid
  // across bun builds; skipping the install avoids re-running the node-gyp
  // rebuild, which is slow and occasionally flaky under resource pressure.
  if (existsSync(addonPath)) {
    return;
  }
  for (let attempt = 0; ; attempt++) {
    const install = spawnSync({
      cmd: [bunExe(), "install", "--verbose"],
      cwd: join(__dirname, "napi-app"),
      stderr: "inherit",
      env: bunEnv,
      stdout: "inherit",
      stdin: "inherit",
    });
    if (install.success && existsSync(addonPath)) {
      return;
    }
    if (attempt >= 1) {
      throw new Error("building napi-app addons failed");
    }
  }
}, 300_000);

function testEnv() {
  const { BUN_INSPECT_CONNECT_TO: _, ASAN_OPTIONS, ...rest } = bunEnv;
  return {
    ...rest,
    // If a NAPI abort wrongly fires, die with a plain abort instead of
    // hanging in the crash reporter / ASAN symbolizer.
    BUN_INTERNAL_SUPPRESS_CRASH_ON_NAPI_ABORT: "1",
    ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=1:symbolize=0",
  };
}

it("error creation works in exit finalizers after worker.terminate()", async () => {
  // terminate() fires the JSC termination exception to interrupt the running
  // worker script. Worker shutdown must clear that exception before running
  // 'exit' handlers and NAPI environment cleanup; otherwise the finalizer
  // registered by napi_wrap runs with a pending exception and every
  // error-creation call fails.
  using dir = tempDir("napi-error-new-terminate", {
    "worker.js": `
      const addon = require(${JSON.stringify(addonPath)});
      globalThis.keptAlive = {};
      addon.wrapKeptAlive(globalThis.keptAlive);
      process.on("exit", () => console.log("worker exit event"));
      postMessage("ready");
      // Spin so terminate() lands while JS is executing and the
      // TerminationException is actually thrown.
      while (true) {}
    `,
    "main.js": `
      const worker = new Worker(new URL("./worker.js", import.meta.url).href);
      worker.onmessage = async () => {
        await worker.terminate();
        console.log("terminated");
      };
    `,
  });
  await using proc = spawn({
    cmd: [bunExe(), "main.js"],
    cwd: String(dir),
    env: testEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(allOk);
  // The termination exception previously also skipped the worker's 'exit'
  // event (dispatchExitInternal returns early when an exception is pending).
  expect(stdout).toContain("worker exit event");
  expect(stdout).toContain("terminated");
  expect(exitCode).toBe(0);
}, 30_000);

it("error creation works in exit finalizers while an exception is pending", async () => {
  // An environment cleanup hook calls into JS and the call throws. Cleanup
  // hooks run before the environment's finalizers, so the wrap finalizer
  // observes a pending exception. Node still returns napi_ok from every
  // error-creation and reference call in this state.
  const code = `
    const addon = require(${JSON.stringify(addonPath)});
    globalThis.keptAlive = {};
    addon.wrapKeptAlive(globalThis.keptAlive);
    addon.setupThrowingCleanupHook(() => {
      throw new Error("thrown from cleanup hook");
    });
    console.log("main done");
  `;
  await using proc = spawn({
    cmd: [bunExe(), "-e", code],
    env: testEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Proves the cleanup hook really ran and really threw (napi_call_function
  // correctly reports napi_pending_exception, matching Node).
  expect(stderr).toContain("cleanup_hook_call_status=10");
  expect(stderr).toContain(allOk);
  expect(stdout).toContain("main done");
  expect(exitCode).toBe(0);
}, 30_000);

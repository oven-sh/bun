// node_api_create_external_string_{latin1,utf16} install an ExternalStringImpl
// free callback that calls env->doFinalizer(). The lambda must hold a
// WTF::Ref<NapiEnv> (like napi_add_finalizer / napi_create_external_buffer do),
// not the raw napi_env pointer: NapiEnv is RefCounted and its primary owner is
// Zig::GlobalObject::m_napiEnvs, dropped in ~GlobalObject(). If the env is
// freed before the string's ExternalStringImpl is released, the finalizer
// dereferences a dead NapiEnv.
//
// Whether that ordering actually occurs depends on JSC heap layout:
// ~GlobalObject runs from MarkedSpace::lastChanceToFinalize()'s
// PreciseAllocation pass, which iterates m_preciseAllocations sorted by
// pointer address (prepareForConservativeScan() re-sorts it every full GC).
// Under current allocation patterns the GlobalObject's allocation sorts last,
// so ~GlobalObject (and ~NapiEnv) run after every JSString/holder and the UAF
// doesn't fire. The Ref capture makes the finalizer correct regardless of that
// ordering. This test exercises both finalizer paths through worker teardown
// with Malloc=1 so ASAN instruments the TZONE-allocated NapiEnv: if heap
// layout ever reorders the sweep, the UAF surfaces here.

import { spawnSync } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";

const napiAppDir = join(import.meta.dir, "napi-app");
const addon = join(napiAppDir, "build", "Debug", "external_string_addon.node");

describe("node_api_create_external_string_* finalizer holds Ref<NapiEnv>", () => {
  beforeAll(() => {
    if (existsSync(addon)) return;
    const install = spawnSync({
      cmd: [bunExe(), "install", "--verbose"],
      cwd: napiAppDir,
      env: bunEnv,
      stderr: "inherit",
      stdout: "inherit",
      stdin: "inherit",
    });
    if (!install.success) throw new Error("node-gyp build failed");
  }, 120_000);

  // NapiEnv is WTF_MAKE_STRUCT_TZONE_ALLOCATED (bmalloc). `Malloc=1` routes
  // bmalloc through the system allocator so ASAN observes its free; the
  // bmalloc system-heap path misbehaves on Windows (see
  // websocket-server-upgrade-reentrant.test.ts), and routing WTF allocations
  // through system malloc surfaces unrelated process-lifetime leaks under
  // LSan, so this is Linux-only with LSan disabled. Other platforms still
  // assert the finalizers run and the worker exits cleanly.
  const childEnv: Record<string, string | undefined> = {
    ...bunEnv,
    BUN_JSC_validateExceptionChecks: undefined,
    BUN_JSC_dumpSimulatedThrows: undefined,
  };
  if (isLinux) {
    childEnv.Malloc = "1";
    childEnv.ASAN_OPTIONS = [bunEnv.ASAN_OPTIONS, "symbolize=0", "detect_leaks=0"].filter(Boolean).join(":");
  }

  test.concurrent.each(["createLatin1", "createUtf16"])(
    "worker teardown runs the %s finalizer with a live env",
    async fn => {
      using dir = tempDir("napi-ext-string-env", {
        "fixture.js": `
          const { Worker, isMainThread, parentPort } = require("worker_threads");
          if (isMainThread) {
            const w = new Worker(__filename);
            w.on("message", m => console.log("worker: " + m));
            w.on("error", e => { console.error("worker error", e); process.exit(1); });
            w.on("exit", code => {
              // Addon is shared across workers in one process; the counter
              // persists, so the main thread can observe the worker-run
              // finalizers after teardown.
              const addon = require(${JSON.stringify(addon)});
              console.log("finalized=" + addon.finalizedCount());
              process.exit(code);
            });
          } else {
            const addon = require(${JSON.stringify(addon)});
            globalThis.__strings = [];
            globalThis.__holders = [];
            for (let i = 0; i < 64; i++) {
              const s = addon.${fn}();
              globalThis.__strings.push(s);
              // DOMException stores the message as a WTF::String (shares the
              // StringImpl), so the ExternalStringImpl's last ref can drop
              // from ~DOMException during the PreciseAllocation sweep.
              globalThis.__holders.push(new DOMException(s));
            }
            parentPort.postMessage("created " + globalThis.__strings.length +
              " sample=" + globalThis.__strings[0]);
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "fixture.js"],
        env: childEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      const expectedContent =
        fn === "createLatin1" ? "external-latin1-string-xxxxxxxx" : "external-utf16-string-xxxxxxxxx";
      // Every external string created in the worker must have had its finalizer
      // invoked by the time the worker's VM is torn down. The combined-object
      // assertion surfaces all three values in one diff when the child crashes
      // or ASAN writes to stderr.
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: expect.stringContaining("finalized=64"),
        stderr: "",
        exitCode: 0,
      });
      expect(stdout).toContain("worker: created 64 sample=" + expectedContent);
    },
  );
});

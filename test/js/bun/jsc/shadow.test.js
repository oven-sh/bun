import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows } from "harness";
import { join } from "path";

it("shadow realm works", () => {
  const red = new ShadowRealm();
  globalThis.someValue = 1;
  // Affects only the ShadowRealm's global
  const result = red.evaluate("globalThis.someValue = 2;");
  expect(globalThis.someValue).toBe(1);
  expect(result).toBe(2);
});

// Every global object (the thread's own, and one per ShadowRealm) installs a
// console client on itself. Those clients used to have no owner and outlived
// their global. They are fastMalloc'd, which LeakSanitizer only sees with
// bmalloc routed to the system allocator (Malloc=1), and only once the VM is
// really torn down at exit (BUN_DESTRUCT_VM_ON_EXIT). The realms are created
// from setImmediate because leaksan.supp suppresses everything allocated while
// the entry module itself is being evaluated.
describe.concurrent.skipIf(!isASAN || isWindows)("globals are freed together with their console client", () => {
  const leakEnv = {
    ...bunEnv,
    Malloc: "1",
    BUN_DESTRUCT_VM_ON_EXIT: "1",
    ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
    LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dirname, "../../../leaksan.supp")}`,
  };

  // The realm's console.log is what exercises the console client; it writes
  // straight to fd 1, so its output is complete before the script (or the
  // worker running it) finishes.
  const createRealms = /* js */ `
    setImmediate(() => {
      for (let i = 0; i < 3; i++) {
        const result = new ShadowRealm().evaluate('console.log("from realm"); 1 + 1');
        if (result !== 2) throw new Error("unexpected evaluate() result: " + result);
      }
    });
  `;
  const realmOutput = "from realm\n".repeat(3);

  // LSan spends several seconds symbolizing a report against the debug binary:
  // a failing run here, and today every run of the worker case (see below).
  const timeout = 60_000;

  it(
    "on the main thread",
    async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", createRealms],
        env: leakEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: realmOutput, stderr: "", exitCode: 0 });
    },
    timeout,
  );

  it(
    "in a worker",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const { Worker } = require("worker_threads");
            const worker = new Worker(${JSON.stringify(createRealms)}, { eval: true });
            worker.on("exit", code => console.log("worker exited", code));
          `,
        ],
        env: leakEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe(realmOutput + "worker exited 0\n");
      // Under Malloc=1 every worker thread still leaks its EventNames table
      // (oven-sh/bun#38164), so the exit code cannot be asserted yet. Instead,
      // nothing allocated while creating the worker's global or its realms'
      // globals may show up in the report.
      expect(stderr).not.toContain("deriveShadowRealmGlobalObject");
      expect(stderr).not.toContain("Zig__GlobalObject__create");
    },
    timeout,
  );
});

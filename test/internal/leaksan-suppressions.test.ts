// CI runs the ASAN build with LeakSanitizer on and test/leaksan.supp applied
// (scripts/runner.node.mjs). An LSan suppression matches when its pattern is a
// substring of ANY frame of an allocation's stack, so an entry naming a frame
// that is on the stack while ordinary code runs hides every leak that code
// makes. The frames that run a module's top level and the VM's microtask-tick
// hook are the important cases: everything a fixture does at its top level
// (-e script, CJS or ESM entry, require()d or imported module, worker eval
// script, the top level of a test file) or from a nextTick/promise
// continuation runs under one of them.
//
// Each row below leaks one malloc'd block (lsanIntentionalLeak, attributed to
// jsFunction_lsanIntentionalLeak) from one of those contexts and expects LSan,
// with the real suppressions file, to report it. The setImmediate row is the
// control: neither kind of frame is on its stack.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, tempDir } from "harness";
import { join } from "node:path";

const suppressions = join(import.meta.dir, "..", "leaksan.supp");
const leakCJS = `require("bun:internal-for-testing").lsanIntentionalLeak();`;
const leakESM = `import { lsanIntentionalLeak } from "bun:internal-for-testing";\nlsanIntentionalLeak();`;

type Row = {
  name: string;
  files: Record<string, string>;
  cmd: string[];
};

const ROWS: Row[] = [
  { name: "bun -e script", files: {}, cmd: ["-e", leakCJS] },
  { name: "CommonJS entry point", files: { "entry.cjs": leakCJS }, cmd: ["entry.cjs"] },
  { name: "ES module entry point", files: { "entry.mjs": leakESM }, cmd: ["entry.mjs"] },
  {
    name: "require()d CommonJS module",
    files: { "entry.cjs": `require("./dep.cjs");`, "dep.cjs": leakCJS },
    cmd: ["entry.cjs"],
  },
  {
    name: "imported ES module",
    files: { "entry.mjs": `import "./dep.mjs";`, "dep.mjs": leakESM },
    cmd: ["entry.mjs"],
  },
  {
    name: "worker_threads eval script",
    files: {
      "entry.cjs": `new (require("node:worker_threads").Worker)(${JSON.stringify(leakCJS)}, { eval: true });`,
    },
    cmd: ["entry.cjs"],
  },
  {
    name: "top level of a bun test file",
    files: { "leak.test.js": `${leakCJS}\nrequire("bun:test").test("registered", () => {});` },
    cmd: ["test", "leak.test.js"],
  },
  // Microtasks and nextTick callbacks run under the VM's microtask-tick hook.
  {
    name: "process.nextTick callback",
    files: { "entry.cjs": `process.nextTick(() => { ${leakCJS} });` },
    cmd: ["entry.cjs"],
  },
  {
    name: "await continuation",
    files: { "entry.mjs": `await Promise.resolve();\n${leakESM}` },
    cmd: ["entry.mjs"],
  },
  {
    name: "setImmediate callback (control)",
    files: { "entry.cjs": `setImmediate(() => { ${leakCJS} });` },
    cmd: ["entry.cjs"],
  },
];

describe.skipIf(!isASAN || !isLinux)("test/leaksan.supp does not hide leaks made by the code under test", () => {
  for (const row of ROWS) {
    test.concurrent(
      row.name,
      async () => {
        using dir = tempDir("leaksan-supp", row.files);
        await using proc = Bun.spawn({
          cmd: [bunExe(), ...row.cmd],
          cwd: String(dir),
          env: {
            ...bunEnv,
            BUN_DESTRUCT_VM_ON_EXIT: "1",
            ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
            // Same stack depth as CI; a suppression can only match a frame LSan recorded.
            // exitcode/abort_on_error pin down how a detected leak ends the process so
            // the assertion below does not depend on the ASAN_OPTIONS inherited from CI.
            LSAN_OPTIONS: `malloc_context_size=30:print_suppressions=0:abort_on_error=0:exitcode=23:suppressions=${suppressions}`,
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        const reported =
          stderr.includes("LeakSanitizer: detected memory leaks") && stderr.includes("jsFunction_lsanIntentionalLeak");
        expect({ reported, exitCode, detail: reported && exitCode === 23 ? "" : stdout + stderr }).toEqual({
          reported: true,
          exitCode: 23,
          detail: "",
        });
      },
      // Symbolizing the report dominates: tens of seconds on a loaded machine with the debug binary.
      90_000,
    );
  }
});

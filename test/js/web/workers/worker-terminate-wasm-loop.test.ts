import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression: worker.terminate() could not preempt a Worker running a pure
// WebAssembly loop (no JS re-entry). VM::notifyNeedTermination() poisons the
// trap-aware soft stack limit, but the Wasm tiers only checked it at function
// prologues, never at loop back-edges, so `loop { br 0 }` spun forever and the
// terminate() promise never settled. JS loops and Wasm loops that call an
// imported JS function per iteration were already preemptible because they hit
// a JS-side trap check.

// (module (func (export "spin") (loop (br 0))))
const PURE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 7, 8, 1, 4, 115, 112, 105, 110, 0, 0, 10, 9, 1, 7, 0, 3,
  64, 12, 0, 11, 11,
]);
// (module (import "e" "tick" (func)) (func (export "spin") (loop (call 0) (br 0))))
const CALL = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 2, 10, 1, 1, 101, 4, 116, 105, 99, 107, 0, 0, 3, 2, 1, 0, 7, 8, 1, 4,
  115, 112, 105, 110, 0, 1, 10, 11, 1, 9, 0, 3, 64, 16, 0, 12, 0, 11, 11,
]);

function workerSourceFor(kind: "js" | "wasm" | "wasmcall"): string {
  if (kind === "js") {
    return `require("worker_threads").parentPort.postMessage("go"); for(;;){}`;
  }
  const bytes = kind === "wasm" ? PURE : CALL;
  const imports = kind === "wasm" ? "undefined" : "{ e: { tick() {} } }";
  return `
    const { parentPort } = require("worker_threads");
    const bytes = Buffer.from(${JSON.stringify(Buffer.from(bytes).toString("base64"))}, "base64");
    const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), ${imports});
    parentPort.postMessage("go");
    inst.exports.spin();
  `;
}

async function runCase(kind: "js" | "wasm" | "wasmcall", warmMs: number, capMs: number) {
  const body = `
    import { Worker } from "node:worker_threads";
    const w = new Worker(${JSON.stringify(workerSourceFor(kind))}, { eval: true });
    let exited = -1;
    w.on("exit", code => { exited = code; });
    await new Promise((resolve, reject) => { w.on("message", resolve); w.on("error", reject); });
    // Let the loop tier up past IPInt before terminate(); once spin() is entered there is no
    // observable readiness signal (a pure Wasm loop has no JS re-entry to postMessage from).
    await new Promise(r => setTimeout(r, ${warmMs}));
    const t0 = performance.now();
    const outcome = await Promise.race([
      w.terminate().then(code => ({ terminated: true, code })),
      new Promise(r => setTimeout(() => r({ terminated: false }), ${capMs})),
    ]);
    const dt = Math.round(performance.now() - t0);
    console.log(JSON.stringify({ ...outcome, dt, exited }));
    process.exit(0);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", body],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const result = JSON.parse(stdout.trim());
  expect(exitCode).toBe(0);
  return result;
}

describe.concurrent("worker.terminate() preempts infinite loops", () => {
  for (const kind of ["js", "wasmcall", "wasm"] as const) {
    test(
      kind,
      async () => {
        const warm = kind === "wasm" ? 300 : 100;
        // cap must be long enough for debug+ASAN to settle but short enough that
        // the unfixed pure-wasm hang (never terminates) is clearly distinguished.
        const { terminated, code, dt, exited } = await runCase(kind, warm, 8000);
        expect({ terminated, code, exited }).toEqual({ terminated: true, code: 1, exited: 1 });
        expect(dt).toBeLessThan(8000);
      },
      20_000,
    );
  }
});

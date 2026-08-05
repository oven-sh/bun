import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// process.chdir() on the main thread used to rewrite the resolver FileSystem
// singleton's top_level_dir buffer in place and re-slice it in two steps.
// A Worker resolving a relative dynamic import between those steps saw the
// old slice length with a fresh NUL byte inside it, rejecting with a path
// like ".../d1\0/mod.mjs" (and aborting on assert builds).
test("process.chdir on main thread does not tear Worker relative import() resolution", async () => {
  using dir = tempDir("worker-chdir-resolve-race", {
    "d1/mod.mjs": `export const tag = "ONE";\n`,
    "d2/mod.mjs": `export const tag = "TWO";\n`,
    "run.mjs": /* js */ `
      import path from "node:path";
      import { Worker } from "node:worker_threads";
      const base = path.dirname(import.meta.filename);
      const D1 = path.join(base, "d1"), D2 = path.join(base, "d2");
      process.chdir(D1);
      const wsrc =
        'const { parentPort } = require("node:worker_threads");\\n' +
        'let ok = 0; const errs = [];\\n' +
        'for (let i = 0; i < 2000; i++) {\\n' +
        '  try { await import("./mod.mjs?i=" + i); ok++; }\\n' +
        '  catch (e) { errs.push(String(e.message).slice(0, 160)); }\\n' +
        '}\\n' +
        'parentPort.postMessage({ ok, nerr: errs.length, errs: errs.slice(0, 3) });\\n';
      let stop = false, n = 0;
      const churn = (async () => {
        while (!stop) {
          n++;
          process.chdir(n & 1 ? D2 : D1);
          if ((n & 255) === 0) await new Promise(r => setImmediate(r));
        }
      })();
      const results = await Promise.all(Array.from({ length: 2 }, () => new Promise(res => {
        const w = new Worker(wsrc, { eval: true });
        w.on("message", m => { res(m); w.terminate(); });
        w.on("error", e => { res({ ok: 0, nerr: 1, errs: [String(e.message)] }); w.terminate(); });
        w.on("exit", code => res({ ok: 0, nerr: 1, errs: ["worker exited " + code] }));
      })));
      stop = true; await churn;
      console.log(JSON.stringify({
        nerr: results.reduce((a, r) => a + r.nerr, 0),
        errs: results.flatMap(r => r.errs).slice(0, 3),
      }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const out = JSON.parse(stdout.trim());
  // Both d1 and d2 contain mod.mjs, so every import must succeed: any failure
  // here observed a torn cwd. The pre-fix failure mode shows an interior NUL
  // ("\u0000") in the rejected module path.
  expect(out).toEqual({ nerr: 0, errs: [] });
  expect(exitCode).toBe(0);
}, 60_000);

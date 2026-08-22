import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

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

// The same race from the other side: a Web Worker may call process.chdir(),
// and the main thread (which never calls chdir) reads the cached cwd through
// fs.realpathSync("."), Bun.pathToFileURL(), path.resolve() and Bun.which().
// With the in-place buffer rewrite, the main thread saw a mix of the two
// directory names ("yy", "y", "x\0yyyy...") and assert builds aborted on the
// interior NUL.
test("process.chdir in a Web Worker does not tear main-thread cwd readers", async () => {
  const tool = isWindows ? "" : "#!/bin/sh\n";
  using dir = tempDir("worker-chdir-cwd-readers", {
    "x/rel/tool": tool,
    "y/.keep": "",
    "yy/.keep": "",
    "yyyyyyyyyyyyyyyy/rel/tool": tool,
    "flip.cjs": /* js */ `
      const path = require("node:path");
      const A = path.join(__dirname, "x");
      const B = path.join(__dirname, "yyyyyyyyyyyyyyyy");
      let i = 0;
      const tick = () => {
        for (let k = 0; k < 200; k++) process.chdir(i++ & 1 ? A : B);
        setImmediate(tick);
      };
      tick();
    `,
    "run.mjs": /* js */ `
      import fs from "node:fs";
      import path from "node:path";
      const base = path.dirname(import.meta.filename);
      const A = path.join(base, "x"), B = path.join(base, "yyyyyyyyyyyyyyyy");
      process.chdir(A);
      const realA = fs.realpathSync(A), realB = fs.realpathSync(B);
      // Every reader below must produce one of these two values.
      const ok = new Set([
        realA, realB,
        Bun.pathToFileURL(path.join(realA, "rel")).href, Bun.pathToFileURL(path.join(realB, "rel")).href,
        path.join(realA, "f"), path.join(realB, "f"),
        path.join(realA, "rel", "tool"), path.join(realB, "rel", "tool"),
      ]);
      const which = process.platform !== "win32";
      if (which) for (const d of [A, B]) fs.chmodSync(path.join(d, "rel", "tool"), 0o755);
      const workers = Array.from({ length: 4 }, () => new Worker(path.join(base, "flip.cjs")));
      const bad = {};
      const check = v => { if (!ok.has(v)) bad[v] = (bad[v] || 0) + 1; };
      for (let i = 0; i < 2000; i++) {
        try { check(fs.realpathSync(".")); } catch (e) { check("realpath:" + e.code); }
        check(Bun.pathToFileURL("rel").href);
        check(path.resolve("f"));
        if (which) check(Bun.which("tool", { PATH: "rel" }));
      }
      for (const w of workers) w.terminate();
      console.log(JSON.stringify(bad));
      process.exit(0);
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
  // Only the two directories the workers chdir into can ever be the cwd. Any
  // other key is a torn path (the pre-fix output has "/yy", "/y" and "%00").
  expect(JSON.parse(stdout.trim())).toEqual({});
  expect(exitCode).toBe(0);
}, 60_000);

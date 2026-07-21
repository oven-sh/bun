import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Diagnostic mirror of test-primitive-timer-leak.js with observable phases:
// prints CREATED per timer, FIRED per callback, POLL per gc tick, then
// ALL_ONGC or PARTIAL k/N at the deadline. Never fails on retention — the
// output discriminates never-fired vs never-collected vs delivery-jammed.
test("timer gc diagnostic mirror", async () => {
  using dir = tempDir("timer-diag", {
    "mirror.js": `
      const N = 10;
      let fired = 0, collected = 0;
      const reg = new FinalizationRegistry(() => {
        collected++;
        if (collected === N) { console.log("ALL_ONGC"); process.exit(0); }
      });
      globalThis.__keepReg = reg;
      for (let i = 0; i < N; i++) {
        let t = setTimeout(() => { fired++; console.log("FIRED " + fired); }, 1);
        console.log("CREATED " + +t);
        reg.register(t, i);
        t = null;
      }
      let polls = 0;
      const iv = setInterval(() => {
        globalThis.gc ? globalThis.gc() : Bun.gc(true);
        polls++;
        console.log("POLL " + polls + " fired=" + fired + " collected=" + collected);
        if (polls >= 100) { console.log("PARTIAL " + collected + "/" + N + " fired=" + fired); process.exit(0); }
      }, 100);
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--expose-gc", "mirror.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  console.log("=== MIRROR STDOUT ===\n" + stdout + "\n=== MIRROR STDERR ===\n" + stderr + "\n=== EXIT " + exitCode + " ===");
  expect(exitCode).toBe(0);
}, 30_000);

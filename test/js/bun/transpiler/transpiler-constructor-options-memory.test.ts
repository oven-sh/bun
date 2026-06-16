import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The Rust port of `new Bun.Transpiler(opts)` called `config.transform.clone()`
// when handing the parsed `api::TransformOptions` to `Transpiler::init`, then
// also moved the original `config` (still holding the populated `transform`
// field) into the long-lived `JSTranspiler`. `TransformOptions` derives
// `Clone`, so every `Vec<Box<[u8]>>` field (define keys/values, external, drop,
// ...) was deep-copied and both copies lived for the lifetime of the
// Transpiler object. The Zig original passes the struct by value, which is a
// bitwise copy that shares slice backing memory.
test("new Bun.Transpiler() does not retain a second deep copy of TransformOptions", async () => {
  const N = 2000;
  // V+2 = 10240 so each value `Box<[u8]>` lands exactly on a mimalloc size
  // class, keeping release and debug/ASAN ratios close enough for a single
  // threshold.
  const V = 10238;
  // One full copy of the define *value* payload, in bytes.
  const payload = N * (V + 2);

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const N = ${N};
        const V = ${V};
        const big = {};
        // Distinct value string per key so the JS heap already holds N*V
        // bytes before the baseline RSS read; the delta then measures only
        // the native-side copies the constructor makes.
        for (let i = 0; i < N; i++) {
          big["process.env.K" + i] = JSON.stringify(Buffer.alloc(V, "v").toString());
        }
        Bun.gc(true);
        const before = process.memoryUsage().rss;
        const t = new Bun.Transpiler({ define: big });
        Bun.gc(true);
        const delta = process.memoryUsage().rss - before;

        const out = t.transformSync("console.log(process.env.K0)");
        if (!out.includes(big["process.env.K0"])) {
          console.error("define not applied:", out.slice(0, 80));
          process.exit(1);
        }
        console.log(JSON.stringify({ delta }));
        globalThis.__keep = t;
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const { delta } = JSON.parse(stdout.trim());
  const ratio = Number((delta / payload).toFixed(2));
  // With the redundant `.clone()` the constructor retains one extra full copy
  // of the define map, pushing the ratio to >= 6.0x (release) / >= 6.5x
  // (debug+ASAN). Without it the ratio sits at ~5.0-5.1x on both builds.
  // Threshold at 5.6x leaves ~9 MB of headroom on each side.
  expect(ratio).toBeLessThan(5.6);
  expect(exitCode).toBe(0);
});

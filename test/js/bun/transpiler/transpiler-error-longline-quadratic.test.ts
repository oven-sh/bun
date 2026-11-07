// A single long line that produces many "has already been declared" errors
// (the shape of a truncated or concatenated minified bundle) used to be
// quadratic in line length: each redeclaration's "originally declared here"
// note jumps back to one of a handful of early offsets, and when that offset
// stream isn't monotonic the LineColumnTracker fell back to a full
// scan-to-end-of-line on every diagnostic. 256KB took ~8s, 512KB ~33s.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

test("long single line with many redeclarations reports errors in bounded time", async () => {
  const fixture = `
    const chunk = i => \`const a_\${i%10}=1,b_\${(i+1)%10}=[1,2,3],c_\${(i+2)%10}={x:'\${String(i).padStart(8,"0")}'},d_\${(i+1)%10}=(e)=>e*2;\`;
    let src = "";
    let i = 0;
    while (src.length < 128 * 1024) src += chunk(i++);
    const T = new Bun.Transpiler({ loader: "ts" });
    const t0 = performance.now();
    let err;
    try { T.transformSync(src); } catch (e) { err = e; }
    const ms = performance.now() - t0;
    const first = err?.errors?.[0];
    console.log(JSON.stringify({
      ms: Math.round(ms),
      errors: err?.errors?.length,
      message: first?.message,
      line: first?.position?.line,
      column: first?.position?.column,
    }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const out = JSON.parse(stdout);
  expect({
    errors: out.errors,
    message: out.message,
    line: out.line,
    column: out.column,
  }).toEqual({
    errors: 256,
    message: '"a_0" has already been declared',
    line: 1,
    // Each chunk is 56 bytes; first redeclared `a_0` is in chunk 10 after
    // "const " (6 bytes), 1-based.
    column: 567,
  });
  // 128KB before the fix: ~1.1s release, ~10s+ debug+ASAN.
  const limit = isDebug || isASAN ? 3_000 : 500;
  expect(out.ms).toBeLessThan(limit);
  expect(exitCode).toBe(0);
});

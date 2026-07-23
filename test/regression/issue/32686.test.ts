import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/32686
// Path-like values are not valid JSON and not valid identifier chains, so they
// must be JSON-encoded by the caller (matching esbuild). This file guards that
// the 1.4.0-canary regression (these values throwing a generic parse error) is
// now a deliberate, actionable error instead.
test.concurrent.each(["./src/worker.ts", "../src/worker.ts", "/abs/path", "/$bunfs/root/worker", ".", "/", "/=foo"])(
  "bare define value %j is rejected; JSON.stringify() round-trips",
  async value => {
    using dir = tempDir("bun-build-define-32686", {
      "entry.ts": `declare const X: string; console.log(X);`,
    });
    let threw: unknown;
    try {
      await Bun.build({
        entrypoints: [join(String(dir), "entry.ts")],
        define: { X: value },
      });
    } catch (e) {
      threw = e;
    }
    expect(String((threw as AggregateError)?.errors?.[0] ?? threw)).toContain(
      `define value "${value}" must be a valid JSON literal or identifier`,
    );

    const result = await Bun.build({
      entrypoints: [join(String(dir), "entry.ts")],
      define: { X: JSON.stringify(value) },
    });
    expect(result.success).toBe(true);
    const out = await result.outputs[0].text();
    expect(out).toContain(JSON.stringify(value));
  },
);

test.concurrent("--define CLI rejects a bare path value with an actionable error", async () => {
  using dir = tempDir("bun-build-define-32686-cli", {
    "entry.ts": `declare const X: string; console.log(X);`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--define", "X=./src/worker.ts", "entry.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain('define value "./src/worker.ts" must be a valid JSON literal or identifier');
  expect(stdout).not.toContain("./src/worker.ts");
  expect(exitCode).not.toBe(0);
});

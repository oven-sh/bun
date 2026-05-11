/**
 * React Compiler (experimental, Rust port via OXC) — bundler integration.
 *
 * These tests only make sense when Bun was built with the Cargo feature
 * `react-compiler` enabled on `bun_bundler` (see src/bundler/Cargo.toml).
 * Without it, `reactCompiler: true` is accepted but is a no-op — the
 * compiler never runs and the assertions below on `_c(` / the
 * `react/compiler-runtime` import would fail. Hence the feature probe +
 * `describe.skipIf` gate.
 *
 * Default builds do NOT enable the feature; to run these locally:
 *
 *     cargo build -p bun_bin --features bun_bundler/react-compiler   # or
 *     BUN_CARGO_FEATURES=bun_bundler/react-compiler bun bd \
 *         test test/bundler/bundler_react_compiler.test.ts
 *
 * (the latter depends on `scripts/build/rust.ts` threading the env var).
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// ── feature probe ──────────────────────────────────────────────────────────
// There is no runtime flag that says "react-compiler was compiled in", so
// probe it: bundle a trivial component with `--react-compiler` and look for
// the memo-cache hook in the output. If it's absent the feature is off and
// every test below is meaningless.
async function hasReactCompiler(): Promise<boolean> {
  using dir = tempDir("react-compiler-probe", {
    "App.jsx": `
      import { useState } from 'react';
      export function App() {
        const [n] = useState(0);
        return <div>{n}</div>;
      }
    `,
  });
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "--react-compiler",
      "--external",
      "react",
      "--external",
      "react/*",
      join(String(dir), "App.jsx"),
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout] = await Promise.all([proc.stdout.text(), proc.exited]);
  return /\b_c\s*\(/.test(stdout) || stdout.includes("react/compiler-runtime");
}

const featureEnabled = await hasReactCompiler();

describe.skipIf(!featureEnabled)("Bun.build reactCompiler", () => {
  test("auto-memoizes a component that calls a hook", async () => {
    using dir = tempDir("react-compiler-basic", {
      "Counter.jsx": `
        import { useState } from 'react';
        export function Counter() {
          const [n, setN] = useState(0);
          return <button onClick={() => setN(n + 1)}>{n}</button>;
        }
      `,
    });

    const build = await Bun.build({
      entrypoints: [join(String(dir), "Counter.jsx")],
      external: ["react", "react/*"],
      // @ts-expect-error experimental, not in the public .d.ts yet
      reactCompiler: true,
    });

    expect(build.success).toBe(true);
    expect(build.outputs).toHaveLength(1);
    const out = await build.outputs[0].text();

    // The React Compiler injects the memo cache (`_c(n)`) and imports it
    // from `react/compiler-runtime`. Bun's own JSX transform runs *after*
    // so the JSX itself is already lowered here; we only assert on the
    // compiler-specific signature.
    expect(out).toMatch(/\b_c\s*\(/);
    expect(out).toContain("react/compiler-runtime");
  });

  test("leaves non-component files untouched", async () => {
    using dir = tempDir("react-compiler-passthrough", {
      "math.jsx": `export function add(a, b) { return a + b; }\n`,
    });

    const build = await Bun.build({
      entrypoints: [join(String(dir), "math.jsx")],
      external: ["react", "react/*"],
      // @ts-expect-error experimental
      reactCompiler: true,
    });

    expect(build.success).toBe(true);
    const out = await build.outputs[0].text();
    expect(out).not.toContain("react/compiler-runtime");
    expect(out).not.toMatch(/\b_c\s*\(/);
  });

  test("--react-compiler CLI flag", async () => {
    using dir = tempDir("react-compiler-cli", {
      "App.jsx": `
        import { useRef } from 'react';
        export function App() {
          const ref = useRef(null);
          return <div ref={ref} />;
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--react-compiler",
        "--external",
        "react",
        "--external",
        "react/*",
        join(String(dir), "App.jsx"),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("react/compiler-runtime");
    expect(exitCode).toBe(0);
  });
});

// When the feature is off, `--react-compiler` must still be an accepted
// flag (so scripts don't break across builds) — it just does nothing.
describe.skipIf(featureEnabled)("Bun.build reactCompiler (feature disabled)", () => {
  test("--react-compiler is accepted and no-ops", async () => {
    using dir = tempDir("react-compiler-noop", {
      "App.jsx": `
        import { useState } from 'react';
        export function App() {
          const [n] = useState(0);
          return <div>{n}</div>;
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--react-compiler",
        "--external",
        "react",
        "--external",
        "react/*",
        join(String(dir), "App.jsx"),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    // Flag accepted, build succeeds, but no compiler signature in output.
    expect(stderr).not.toContain("Unknown option");
    expect(stdout).not.toContain("react/compiler-runtime");
    expect(exitCode).toBe(0);
  });
});

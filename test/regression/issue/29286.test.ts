// Regression test for https://github.com/oven-sh/bun/issues/29286
//
// `bun build --bytecode --format=esm --target=bun --outdir` should emit:
//   - dist/index.js     (ESM bundle with `// @bun @bytecode` header)
//   - dist/index.js.jsc (serialized JSC bytecode)
//   - dist/index.js.jsm (serialized module_info for analyze-phase skipping)
//
// Before the fix this combination errored out with:
//   "ESM bytecode requires --compile"
// and top-level `await` couldn't be combined with --bytecode unless the
// whole runtime was embedded via --compile.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

test("issue #29286: --bytecode --format=esm --outdir emits .jsc + .jsm sidecars", async () => {
  using dir = tempDir("29286", {
    "index.ts": `
      async function getConfig() {
        return { port: 3000 };
      }
      const config = await getConfig();
      console.log(\`Server starting on port \${config.port}\`);
    `,
  });

  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "./index.ts", "--bytecode", "--format=esm", "--target=bun", "--outdir=dist"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [buildStdout, buildStderr, buildExit] = await Promise.all([
    build.stdout.text(),
    build.stderr.text(),
    build.exited,
  ]);

  expect(buildStderr).not.toContain("ESM bytecode requires");
  expect(buildStderr).not.toContain('"await" can only be used');
  expect(buildExit).toBe(0);

  const distDir = join(String(dir), "dist");
  const jsPath = join(distDir, "index.js");
  // Bytecode + module-info sidecars are named .js.jsc / .js.jsm (same
  // convention as the existing CJS bytecode sidecar — the extension is
  // appended to the full chunk filename, not a substitution of .js).
  const jscPath = join(distDir, "index.js.jsc");
  const jsmPath = join(distDir, "index.js.jsm");

  expect(existsSync(jsPath)).toBe(true);
  expect(existsSync(jscPath)).toBe(true);
  expect(existsSync(jsmPath)).toBe(true);

  // ESM bytecode header — CJS wrapper must NOT be present.
  const jsContents = readFileSync(jsPath, "utf8");
  expect(jsContents).toContain("// @bun @bytecode");
  expect(jsContents).not.toContain("@bun-cjs");

  // Bytecode + module_info should both be non-empty.
  expect(readFileSync(jscPath).byteLength).toBeGreaterThan(0);
  expect(readFileSync(jsmPath).byteLength).toBeGreaterThan(0);

  // End-to-end: running the bundle must work (top-level await included).
  await using run = Bun.spawn({
    cmd: [bunExe(), jsPath],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [runStdout, , runExit] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);

  expect(runStdout.trim()).toBe("Server starting on port 3000");
  expect(runExit).toBe(0);
});

test("issue #29286: Bun.build({ bytecode: true, format: 'esm' }) no longer requires compile", async () => {
  using dir = tempDir("29286-api", {
    "entry.ts": `
      const x = await Promise.resolve(42);
      console.log('answer:', x);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const result = await Bun.build({
          entrypoints: ['${join(String(dir), "entry.ts").replace(/\\/g, "\\\\")}'],
          outdir: '${join(String(dir), "dist").replace(/\\/g, "\\\\")}',
          target: 'bun',
          format: 'esm',
          bytecode: true,
        });
        if (!result.success) {
          for (const log of result.logs) console.error(String(log));
          process.exit(1);
        }
        console.log('outputs:', result.outputs.map(o => o.path.split('/').pop()).sort().join(','));
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("ESM bytecode requires");
  expect(stdout).toContain("entry.js");
  expect(stdout).toContain("entry.js.jsc");
  expect(stdout).toContain("entry.js.jsm");
  expect(exitCode).toBe(0);
});

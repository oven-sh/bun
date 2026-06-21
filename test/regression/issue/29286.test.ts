// Regression test for https://github.com/oven-sh/bun/issues/29286
//
// `bun build --bytecode --format=esm --target=bun --outdir` previously
// errored with "ESM bytecode requires --compile"; it now emits the ESM
// bundle plus a `.js.jsc` bytecode sidecar that `bun dist/index.js`
// loads, so top-level `await` works without embedding the runtime.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

test.concurrent("issue #29286: --bytecode --format=esm --outdir emits .jsc sidecar", async () => {
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

  const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);

  expect(buildStderr).not.toContain("ESM bytecode requires");
  expect(buildStderr).not.toContain('"await" can only be used');
  expect(buildExit).toBe(0);

  const distDir = join(String(dir), "dist");
  const jsPath = join(distDir, "index.js");
  // Bytecode sidecar is named .js.jsc (same convention as the existing
  // CJS bytecode sidecar — the extension is appended to the full chunk
  // filename, not a substitution of .js).
  const jscPath = join(distDir, "index.js.jsc");

  expect(existsSync(jsPath)).toBe(true);
  expect(existsSync(jscPath)).toBe(true);

  // ESM bytecode header — CJS wrapper must NOT be present.
  const jsContents = readFileSync(jsPath, "utf8");
  expect(jsContents).toContain("// @bun @bytecode");
  expect(jsContents).not.toContain("@bun-cjs");

  // Bytecode should be non-empty.
  expect(readFileSync(jscPath).byteLength).toBeGreaterThan(0);

  // End-to-end: running the bundle must work with top-level await,
  // loading the .jsc sidecar bytecode.
  await using run = Bun.spawn({
    cmd: [bunExe(), jsPath],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [runStdout, runStderr, runExit] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);

  expect({ stdout: runStdout.trim(), stderr: runStderr, exitCode: runExit }).toEqual({
    stdout: "Server starting on port 3000",
    stderr: expect.any(String),
    exitCode: 0,
  });
});

test.concurrent("issue #29286: Bun.build({ bytecode: true, format: 'esm' }) no longer requires compile", async () => {
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
          // Normalize separators so the test works on Windows — BuildArtifact.path
          // uses backslashes there.
          console.log('outputs:', result.outputs.map(o => o.path.replaceAll('\\\\', '/').split('/').pop()).sort().join(','));
        `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("ESM bytecode requires");
  // Match on comma-delimited tokens so `entry.js` isn't a false positive
  // for the prefix of `entry.js.jsc`.
  expect(stdout).toMatch(/outputs: (entry\.js),/);
  expect(stdout).toContain("entry.js.jsc");
  expect(exitCode).toBe(0);
});

// Two entrypoints sharing an import produce a separate non-entry chunk with
// its own .jsc sidecar; running an entry loads that chunk at runtime. Covers
// the multi-chunk ESM bytecode path (code splitting + sidecar load), which the
// single-file cases above don't reach.
test.concurrent("issue #29286: shared ESM bytecode chunk loads and runs", async () => {
  using dir = tempDir("29286-split", {
    "shared.ts": `export const value = await Promise.resolve(42);`,
    "a.ts": `import { value } from "./shared.ts"; console.log("a:", value);`,
    "b.ts": `import { value } from "./shared.ts"; console.log("b:", value);`,
  });

  await using build = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "./a.ts",
      "./b.ts",
      "--bytecode",
      "--format=esm",
      "--target=bun",
      "--splitting",
      "--outdir=dist",
    ],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  expect(buildStderr).not.toContain("ESM bytecode requires");
  expect(buildExit).toBe(0);

  // A shared chunk (distinct from a.js / b.js) must exist with a .jsc sidecar.
  const distDir = join(String(dir), "dist");
  const entries = readdirSync(distDir);
  const sharedJsc = entries.find(f => f.endsWith(".jsc") && !/^(a|b)\.js\.jsc$/.test(f));
  expect(sharedJsc).toBeDefined();

  // Running the entry loads the shared chunk's .jsc sidecar at runtime.
  await using run = Bun.spawn({
    cmd: [bunExe(), join(distDir, "a.js")],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [runStdout, runStderr, runExit] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
  expect({ stdout: runStdout.trim(), stderr: runStderr, exitCode: runExit }).toEqual({
    stdout: "a: 42",
    stderr: expect.any(String),
    exitCode: 0,
  });
});

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

function filterAsanWarning(stderr: string): string {
  return stderr
    .split("\n")
    .filter(line => !line.startsWith("WARNING: ASAN"))
    .join("\n")
    .trim();
}

test.concurrent("onResolve plugin can append query string to file namespace path", async () => {
  using dir = tempDir("issue-28625-query", {
    "entry.js": `import txt from './data.txt'; console.log(txt);`,
    "data.txt": `hello world`,
    "build.js": `
      import path from 'path';

      const result = await Bun.build({
        entrypoints: ['./entry.js'],
        outdir: './out',
        loader: { '.txt': 'text' },
        plugins: [{
          name: 'txt-query-plugin',
          setup(build) {
            build.onResolve({filter: /\\.txt$/}, args => {
              const resolvedPath = path.resolve(args.resolveDir, args.path) + '?version=1';
              return { path: resolvedPath };
            });
          }
        }]
      });

      if (!result.success) {
        for (const msg of result.logs) console.error(msg);
        process.exit(1);
      }
      console.log("BUILD_OK");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(filterAsanWarning(stderr)).toBe("");
  expect(stdout).toContain("BUILD_OK");
  expect(exitCode).toBe(0);
});

// '#' is a valid filename character on POSIX; stripping a plugin-appended
// '?query' must not truncate inside the basename when it contains '#'.
test.concurrent.skipIf(isWindows)("onResolve plugin can append query string when filename contains '#'", async () => {
  using dir = tempDir("issue-28625-sharp", {
    "entry.js": `import txt from './C#.txt'; console.log(txt);`,
    "C#.txt": `hello sharp`,
    "build.js": `
      import path from 'path';

      const result = await Bun.build({
        entrypoints: ['./entry.js'],
        outdir: './out',
        loader: { '.txt': 'text' },
        plugins: [{
          name: 'txt-query-plugin',
          setup(build) {
            build.onResolve({filter: /\\.txt$/}, args => {
              const resolvedPath = path.resolve(args.resolveDir, args.path) + '?version=1';
              return { path: resolvedPath };
            });
          }
        }]
      });

      if (!result.success) {
        for (const msg of result.logs) console.error(msg);
        process.exit(1);
      }
      console.log("BUILD_OK");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(filterAsanWarning(stderr)).toBe("");
  expect(stdout).toContain("BUILD_OK");
  expect(exitCode).toBe(0);
});

// Same, but the plugin appends a '#fragment' — the strip must cut at the
// last '#' (the appended suffix), not the first one inside the filename.
test.concurrent.skipIf(isWindows)("onResolve plugin can append hash fragment when filename contains '#'", async () => {
  using dir = tempDir("issue-28625-sharp-hash", {
    "entry.js": `import txt from './C#.txt'; console.log(txt);`,
    "C#.txt": `hello sharp`,
    "build.js": `
      import path from 'path';

      const result = await Bun.build({
        entrypoints: ['./entry.js'],
        outdir: './out',
        loader: { '.txt': 'text' },
        plugins: [{
          name: 'txt-hash-plugin',
          setup(build) {
            build.onResolve({filter: /\\.txt$/}, args => {
              const resolvedPath = path.resolve(args.resolveDir, args.path) + '#section';
              return { path: resolvedPath };
            });
          }
        }]
      });

      if (!result.success) {
        for (const msg of result.logs) console.error(msg);
        process.exit(1);
      }
      console.log("BUILD_OK");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(filterAsanWarning(stderr)).toBe("");
  expect(stdout).toContain("BUILD_OK");
  expect(exitCode).toBe(0);
});

test.concurrent("onResolve plugin can append hash fragment to file namespace path", async () => {
  using dir = tempDir("issue-28625-hash", {
    "entry.js": `import txt from './data.txt'; console.log(txt);`,
    "data.txt": `hello world`,
    "build.js": `
      import path from 'path';

      const result = await Bun.build({
        entrypoints: ['./entry.js'],
        outdir: './out',
        loader: { '.txt': 'text' },
        plugins: [{
          name: 'txt-hash-plugin',
          setup(build) {
            build.onResolve({filter: /\\.txt$/}, args => {
              const resolvedPath = path.resolve(args.resolveDir, args.path) + '#section';
              return { path: resolvedPath };
            });
          }
        }]
      });

      if (!result.success) {
        for (const msg of result.logs) console.error(msg);
        process.exit(1);
      }
      console.log("BUILD_OK");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(filterAsanWarning(stderr)).toBe("");
  expect(stdout).toContain("BUILD_OK");
  expect(exitCode).toBe(0);
});

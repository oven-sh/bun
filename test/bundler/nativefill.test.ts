import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

test("nativefill replaces strip-ansi with Bun.stripAnsi when target is bun", async () => {
  using dir = tempDir("nativefill-strip-ansi", {
    "index.js": `
      import stripAnsi from 'strip-ansi';
      console.log(stripAnsi('\\x1b[31mHello\\x1b[0m'));
    `,
    "package.json": JSON.stringify({
      name: "test-app",
      dependencies: {
        "strip-ansi": "7.0.0",
      },
    }),
  });

  const outdir = path.join(String(dir), "out");
  
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./index.js", "--outdir", outdir, "--target", "bun", "--nativefill"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  
  // Read the output file
  const outputFile = path.join(outdir, "index.js");
  const output = await Bun.file(outputFile).text();
  
  // Should use Bun.stripAnsi, not the npm package
  expect(output).toContain("Bun.stripAnsi");
  expect(output).not.toContain("node_modules");
});

test("nativefill replaces string-width with Bun.stringWidth when target is bun", async () => {
  using dir = tempDir("nativefill-string-width", {
    "index.js": `
      import stringWidth from 'string-width';
      console.log(stringWidth('hello'));
    `,
    "package.json": JSON.stringify({
      name: "test-app",
      dependencies: {
        "string-width": "5.0.0",
      },
    }),
  });

  const outdir = path.join(String(dir), "out");
  
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./index.js", "--outdir", outdir, "--target", "bun", "--nativefill"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  
  // Read the output file
  const outputFile = path.join(outdir, "index.js");
  const output = await Bun.file(outputFile).text();
  
  // Should use Bun.stringWidth, not the npm package
  expect(output).toContain("Bun.stringWidth");
  expect(output).not.toContain("node_modules");
});

test("nativefill replaces better-sqlite3 with bun:sqlite when target is bun", async () => {
  using dir = tempDir("nativefill-better-sqlite3", {
    "index.js": `
      import Database from 'better-sqlite3';
      const db = new Database(':memory:');
      console.log(db);
    `,
    "package.json": JSON.stringify({
      name: "test-app",
      dependencies: {
        "better-sqlite3": "9.0.0",
      },
    }),
  });

  const outdir = path.join(String(dir), "out");
  
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./index.js", "--outdir", outdir, "--target", "bun", "--nativefill"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  
  // Read the output file
  const outputFile = path.join(outdir, "index.js");
  const output = await Bun.file(outputFile).text();
  
  // Should use bun:sqlite, not the npm package
  expect(output).toContain("bun:sqlite");
  expect(output).not.toContain("node_modules");
});

test("nativefill is disabled by default", async () => {
  using dir = tempDir("nativefill-disabled", {
    "index.js": `
      import stripAnsi from 'strip-ansi';
      console.log(stripAnsi('\\x1b[31mHello\\x1b[0m'));
    `,
    "package.json": JSON.stringify({
      name: "test-app",
      dependencies: {
        "strip-ansi": "7.0.0",
      },
    }),
  });

  // First install the dependency
  await using installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  
  await installProc.exited;

  const outdir = path.join(String(dir), "out");
  
  // Build without --nativefill flag
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./index.js", "--outdir", outdir, "--target", "bun"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  
  // Read the output file
  const outputFile = path.join(outdir, "index.js");
  const output = await Bun.file(outputFile).text();
  
  // Should NOT use Bun.stripAnsi since nativefill is disabled
  expect(output).not.toContain("Bun.stripAnsi");
  // Should contain the actual module import
  expect(output).toContain("strip-ansi");
});

test("nativefill fails when target is not bun", async () => {
  using dir = tempDir("nativefill-wrong-target", {
    "index.js": `
      import stripAnsi from 'strip-ansi';
      console.log(stripAnsi('\\x1b[31mHello\\x1b[0m'));
    `,
    "package.json": JSON.stringify({
      name: "test-app",
      dependencies: {
        "strip-ansi": "7.0.0",
      },
    }),
  });

  // First install the dependency
  await using installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  
  await installProc.exited;

  const outdir = path.join(String(dir), "out");
  
  // Try building with --nativefill but target is browser
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./index.js", "--outdir", outdir, "--target", "browser", "--nativefill"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  
  // Read the output file
  const outputFile = path.join(outdir, "index.js");
  const output = await Bun.file(outputFile).text();
  
  // Should NOT use Bun.stripAnsi when target is not bun
  expect(output).not.toContain("Bun.stripAnsi");
  // Should contain the actual module import
  expect(output).toContain("strip-ansi");
});

test("nativefill works with multiple imports", async () => {
  using dir = tempDir("nativefill-multiple", {
    "index.js": `
      import stripAnsi from 'strip-ansi';
      import stringWidth from 'string-width';
      import Database from 'better-sqlite3';
      
      console.log(stripAnsi('\\x1b[31mHello\\x1b[0m'));
      console.log(stringWidth('hello'));
      const db = new Database(':memory:');
    `,
    "package.json": JSON.stringify({
      name: "test-app",
      dependencies: {
        "strip-ansi": "7.0.0",
        "string-width": "5.0.0",
        "better-sqlite3": "9.0.0",
      },
    }),
  });

  const outdir = path.join(String(dir), "out");
  
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./index.js", "--outdir", outdir, "--target", "bun", "--nativefill"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  
  // Read the output file
  const outputFile = path.join(outdir, "index.js");
  const output = await Bun.file(outputFile).text();
  
  // Should use all Bun native implementations
  expect(output).toContain("Bun.stripAnsi");
  expect(output).toContain("Bun.stringWidth");
  expect(output).toContain("bun:sqlite");
  expect(output).not.toContain("node_modules");
});

test("nativefill works with JS API", async () => {
  using dir = tempDir("nativefill-js-api", {
    "build.js": `
      await Bun.build({
        entrypoints: ["./index.js"],
        outdir: "./out",
        target: "bun",
        nativefill: true,
      });
    `,
    "index.js": `
      import stripAnsi from 'strip-ansi';
      console.log(stripAnsi('test'));
    `,
    "package.json": JSON.stringify({
      name: "test-app",
      dependencies: {
        "strip-ansi": "7.0.0",
      },
    }),
  });

  // Run the build script
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  
  // Read the output file
  const outputFile = path.join(String(dir), "out", "index.js");
  const output = await Bun.file(outputFile).text();
  
  // Should use Bun.stripAnsi
  expect(output).toContain("Bun.stripAnsi");
  expect(output).not.toContain("node_modules");
});

test("nativefill correctly replaces imports in output", async () => {
  using dir = tempDir("nativefill-output-check", {
    "test.js": `
      import stripAnsi from 'strip-ansi';
      import stringWidth from 'string-width';
      import Database from 'better-sqlite3';
      
      // Use the imports
      const result = stripAnsi('test');
      const width = stringWidth('hello');
      const db = new Database(':memory:');
    `,
    "package.json": JSON.stringify({
      name: "test-app",
      dependencies: {
        "strip-ansi": "7.0.0",
        "string-width": "5.0.0",
        "better-sqlite3": "9.0.0",
      },
    }),
  });

  const outdir = path.join(String(dir), "out");
  
  // Build with nativefill
  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "./test.js", "--outdir", outdir, "--target", "bun", "--nativefill"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
    buildProc.stdout.text(),
    buildProc.stderr.text(),
    buildProc.exited,
  ]);

  expect(buildExitCode).toBe(0);

  // Check the output file contains the replacements
  const outputFile = path.join(outdir, "test.js");
  const output = await Bun.file(outputFile).text();
  
  // Verify all replacements are in the output
  expect(output).toContain("Bun.stripAnsi");
  expect(output).toContain("Bun.stringWidth");
  expect(output).toContain("bun:sqlite");
  
  // Verify the npm packages are not referenced as imports
  expect(output).not.toContain("node_modules");
  // The names might appear in comments, but shouldn't be imported from npm packages
  expect(output).not.toMatch(/from ["']strip-ansi["']/);
  expect(output).not.toMatch(/from ["']string-width["']/);
  expect(output).not.toMatch(/from ["']better-sqlite3["']/);
});
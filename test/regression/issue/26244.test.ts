import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/26244
// bun build --compile should default NODE_ENV to production for dead code elimination
describe("Issue #26244", () => {
  test("--compile defaults NODE_ENV to production (CLI)", async () => {
    using dir = tempDir("compile-node-env-cli", {
      // This simulates React's conditional require pattern
      "index.js": `
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./prod.js');
} else {
  module.exports = require('./dev.js');
}
`,
      "prod.js": `module.exports = { mode: "production" };`,
      // Note: dev.js intentionally not created to simulate Next.js standalone output
      // where development files are stripped
    });

    const outfile = join(dir + "", isWindows ? "app.exe" : "app");

    // This should succeed because NODE_ENV defaults to production,
    // enabling dead code elimination of the dev.js branch
    const buildProc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", join(dir + "", "index.js"), "--outfile", outfile],
      cwd: dir + "",
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
      new Response(buildProc.stdout).text(),
      new Response(buildProc.stderr).text(),
      buildProc.exited,
    ]);

    // Build should succeed - the dead branch with dev.js should be eliminated
    expect(buildStderr).not.toContain("Could not resolve");
    expect(buildExitCode).toBe(0);
  });

  test("--compile defaults NODE_ENV to production (API)", async () => {
    using dir = tempDir("compile-node-env-api", {
      // This simulates React's conditional require pattern
      "index.js": `
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./prod.js');
} else {
  module.exports = require('./dev.js');
}
`,
      "prod.js": `module.exports = { mode: "production" };`,
      // Note: dev.js intentionally not created to simulate Next.js standalone output
      // where development files are stripped
    });

    const outfile = join(dir + "", isWindows ? "app.exe" : "app");

    // This should succeed because NODE_ENV defaults to production,
    // enabling dead code elimination of the dev.js branch
    const result = await Bun.build({
      entrypoints: [join(dir + "", "index.js")],
      compile: {
        outfile,
      },
    });

    // Build should succeed - the dead branch with dev.js should be eliminated
    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);
  });

  test("--compile with conditional require eliminates dead branch (CLI)", async () => {
    using dir = tempDir("compile-dead-code-cli", {
      "entry.js": `
// This is the pattern used by React
if (process.env.NODE_ENV === 'production') {
  console.log("Using production build");
} else {
  // This branch references a non-existent file
  // and should be eliminated by dead code elimination
  require('./non-existent-dev-file.js');
}
`,
    });

    const outfile = join(dir + "", isWindows ? "app.exe" : "app");

    // Should succeed - the require('./non-existent-dev-file.js') should be
    // eliminated because NODE_ENV defaults to 'production'
    const buildProc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", join(dir + "", "entry.js"), "--outfile", outfile],
      cwd: dir + "",
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
      new Response(buildProc.stdout).text(),
      new Response(buildProc.stderr).text(),
      buildProc.exited,
    ]);

    expect(buildStderr).not.toContain("Could not resolve");
    expect(buildExitCode).toBe(0);
  });

  test("--compile can override NODE_ENV with --define", async () => {
    using dir = tempDir("compile-define-override", {
      "entry.js": `console.log(process.env.NODE_ENV);`,
    });

    const outfile = join(dir + "", isWindows ? "app.exe" : "app");

    // Use CLI to test --define override
    const buildProc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        join(dir + "", "entry.js"),
        "--outfile",
        outfile,
        "--define",
        'process.env.NODE_ENV="development"',
      ],
      cwd: dir + "",
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
      new Response(buildProc.stdout).text(),
      new Response(buildProc.stderr).text(),
      buildProc.exited,
    ]);

    expect(buildExitCode).toBe(0);

    // Run the compiled binary
    const runProc = Bun.spawn({
      cmd: [outfile],
      cwd: dir + "",
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(runProc.stdout).text(),
      new Response(runProc.stderr).text(),
      runProc.exited,
    ]);

    expect(stdout.trim()).toBe("development");
    expect(exitCode).toBe(0);
  });
});

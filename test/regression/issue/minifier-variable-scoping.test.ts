import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("minifier should preserve variable scoping for IIFE patterns", async () => {
  const dir = tempDirWithFiles("minifier-scoping", {
    "sys-pattern.js": `
      // This pattern is common in large JS files like TypeScript compiler
      var sys = (() => {
        function getNodeSystem() {
          return {
            tryEnableSourceMapsForHost: function() { console.log("sourcemaps enabled"); },
            setBlocking: function() { console.log("blocking enabled"); },
            getEnvironmentVariable: function(name) { return process.env[name] || ""; },
            write: function(s) { process.stdout.write(s); },
            newLine: "\\n"
          };
        }
        return getNodeSystem();
      })();

      // Global object that references sys
      var F = {
        loggingHost: {
          log: function(level, s) {
            sys.write((s || "") + sys.newLine);
          }
        },
        isDebugging: false,
        enableDebugInfo: function() {}
      };

      // This is the pattern that was failing
      if (sys.tryEnableSourceMapsForHost && /^development$/i.test(sys.getEnvironmentVariable("NODE_ENV"))) {
        sys.tryEnableSourceMapsForHost();
      }

      if (sys.setBlocking) {
        sys.setBlocking();
      }

      // Export sys for testing
      if (typeof module !== 'undefined' && module.exports) {
        module.exports = { sys, F };
      }
    `,
  });

  // Minify the file
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--minify", "--no-bundle", "sys-pattern.js", "--outfile=sys-pattern.min.js"],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
  });

  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  // Test that the minified file runs without errors
  await using testProc = Bun.spawn({
    cmd: ["node", "sys-pattern.min.js"],
    env: { ...bunEnv, NODE_ENV: "development" },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, testStderr, testExitCode] = await Promise.all([
    testProc.stdout.text(),
    testProc.stderr.text(),
    testProc.exited,
  ]);

  // Should not have any TypeError about undefined variables
  expect(testStderr).not.toContain("TypeError");
  expect(testStderr).not.toContain("Cannot read properties of undefined");
  expect(testExitCode).toBe(0);

  // Should have output from the sys functions
  expect(stdout).toContain("sourcemaps enabled");
  expect(stdout).toContain("blocking enabled");
});

test("minifier should handle hoisted variables in function scopes correctly", async () => {
  const dir = tempDirWithFiles("minifier-hoisting", {
    "hoisting-test.js": `
      // Test hoisted variable handling in function scopes
      function outer() {
        var hoistedVar = (() => {
          function inner() {
            return { value: 42 };
          }
          return inner();
        })();
        
        return hoistedVar.value;
      }
      
      console.log(outer());
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--minify", "--no-bundle", "hoisting-test.js", "--outfile=hoisting-test.min.js"],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
  });

  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  // Test that the minified file runs correctly
  await using testProc = Bun.spawn({
    cmd: ["node", "hoisting-test.min.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, testStderr, testExitCode] = await Promise.all([
    testProc.stdout.text(),
    testProc.stderr.text(),
    testProc.exited,
  ]);

  expect(testStderr).toBe("");
  expect(testExitCode).toBe(0);
  expect(stdout.trim()).toBe("42");
});

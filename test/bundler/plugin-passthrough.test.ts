import { test, expect } from "bun:test";
import { bunExe, bunEnv, tempDirWithFiles } from "harness";
import path from "path";

test("onLoad plugins can pass through to next plugin by returning undefined contents", async () => {
  const dir = tempDirWithFiles("plugin-passthrough", {
    "index.html": `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <h1>Test</h1>
</body>
</html>`,
    "styles.css": `body { color: red; }`,
    "build.js": `
      let observerCalled = false;
      let processorCalled = false;

      const observerPlugin = {
        name: "observer",
        setup(build) {
          build.onLoad({ filter: /\\.html$/ }, async (args) => {
            observerCalled = true;
            console.log("[observer] called");
            // Return object without contents to pass through
            return {};
          });
        }
      };

      const processorPlugin = {
        name: "processor", 
        setup(build) {
          build.onLoad({ filter: /\\.html$/ }, async (args) => {
            processorCalled = true;
            console.log("[processor] called");
            return {
              contents: await Bun.file(args.path).text(),
              loader: "html"
            };
          });
        }
      };

      const result = await Bun.build({
        entrypoints: ["./index.html"],
        outdir: "./dist",
        plugins: [observerPlugin, processorPlugin]
      });

      if (!result.success) {
        console.error("Build failed:", result.logs);
        process.exit(1);
      }

      if (!observerCalled) {
        console.error("Observer plugin was not called");
        process.exit(1);
      }

      if (!processorCalled) {
        console.error("Processor plugin was not called");
        process.exit(1);
      }

      console.log("SUCCESS: Both plugins were called");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("[observer] called");
  expect(stdout).toContain("[processor] called");
  expect(stdout).toContain("SUCCESS: Both plugins were called");
});

test("onLoad plugin returning contents stops subsequent plugins", async () => {
  const dir = tempDirWithFiles("plugin-blocking", {
    "index.html": `<!DOCTYPE html>
<html>
<body>
  <h1>Test</h1>
</body>
</html>`,
    "build.js": `
      let firstCalled = false;
      let secondCalled = false;

      const firstPlugin = {
        name: "first",
        setup(build) {
          build.onLoad({ filter: /\\.html$/ }, async (args) => {
            firstCalled = true;
            console.log("[first] called and returning contents");
            return {
              contents: await Bun.file(args.path).text(),
              loader: "html"
            };
          });
        }
      };

      const secondPlugin = {
        name: "second", 
        setup(build) {
          build.onLoad({ filter: /\\.html$/ }, async (args) => {
            secondCalled = true;
            console.log("[second] called");
            return {
              contents: "should not get here",
              loader: "html"
            };
          });
        }
      };

      const result = await Bun.build({
        entrypoints: ["./index.html"],
        outdir: "./dist",
        plugins: [firstPlugin, secondPlugin]
      });

      if (!result.success) {
        console.error("Build failed:", result.logs);
        process.exit(1);
      }

      if (!firstCalled) {
        console.error("First plugin was not called");
        process.exit(1);
      }

      if (secondCalled) {
        console.error("ERROR: Second plugin should not have been called");
        process.exit(1);
      }

      console.log("SUCCESS: Only first plugin was called");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("[first] called and returning contents");
  expect(stdout).not.toContain("[second] called");
  expect(stdout).toContain("SUCCESS: Only first plugin was called");
});
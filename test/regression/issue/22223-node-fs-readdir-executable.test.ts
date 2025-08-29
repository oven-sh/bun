// Tests for issue #22223: node:fs readdir and createReadStream should work in executables
import { test, expect } from "bun:test";
import { tempDirWithFiles, bunExe } from "harness";
import * as path from "path";

test("executable should support readdir and createReadStream", async () => {
  const tempDir = tempDirWithFiles("issue-22223", {
    "index.ts": `
      import { readdir, createReadStream, existsSync } from "node:fs";
      import { promisify } from "util";

      const readdirAsync = promisify(readdir);

      // Test readdir sync
      console.log("Testing readdir sync");
      const files = readdir("/$bunfs/", (err, files) => {
        if (err) {
          console.error("readdir error:", err.message);
          process.exit(1);
        }
        console.log("Files found:", files.length > 0 ? "yes" : "no");
      });

      // Test readdir sync  
      try {
        const fileSync = require("fs").readdirSync("/$bunfs/");
        console.log("Sync files found:", fileSync.length > 0 ? "yes" : "no");
      } catch (err) {
        console.error("readdirSync error:", err.message);
        process.exit(1);
      }

      // Test createReadStream
      console.log("Testing createReadStream");
      try {
        const stream = createReadStream("/$bunfs/index.ts");
        stream.on("data", () => {
          console.log("Stream data received: yes");
        });
        stream.on("error", (err) => {
          console.error("Stream error:", err.message);
          process.exit(1);
        });
        stream.on("end", () => {
          console.log("Stream ended: yes");
        });
      } catch (err) {
        console.error("createReadStream error:", err.message);
        process.exit(1);
      }
    `,
  });

  // Build executable
  const executablePath = path.join(tempDir, "test-executable");
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--outfile", executablePath, path.join(tempDir, "index.ts")],
    env: process.env,
    stderr: "pipe",
    stdout: "pipe",
    cwd: tempDir,
  });

  const [stderr, stdout, buildExitCode] = await Promise.all([
    build.stderr.text(),
    build.stdout.text(),
    build.exited,
  ]);

  if (buildExitCode !== 0) {
    console.error("Build stderr:", stderr);
    console.error("Build stdout:", stdout);
  }
  expect(buildExitCode).toBe(0);

  // Make executable
  await Bun.$`chmod +x ${executablePath}`;

  // Run the executable
  await using proc = Bun.spawn({
    cmd: [executablePath],
    env: process.env,
    stderr: "pipe", 
    stdout: "pipe",
    cwd: tempDir,
  });

  const [execStderr, execStdout, execExitCode] = await Promise.all([
    proc.stderr.text(),
    proc.stdout.text(), 
    proc.exited,
  ]);

  if (execExitCode !== 0) {
    console.error("Exec stderr:", execStderr);
    console.error("Exec stdout:", execStdout);
  }

  expect(execExitCode).toBe(0);
  expect(execStdout).toContain("Files found: yes");
  expect(execStdout).toContain("Sync files found: yes");
  expect(execStdout).toContain("Stream data received: yes");
  expect(execStdout).toContain("Stream ended: yes");
});
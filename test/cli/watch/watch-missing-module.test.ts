import { expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("watch mode should poll and reload when a missing required file is created", async () => {
  using dir = tempDir("watch-missing-module", {
    "file1.ts": `
      import { message } from "./file2.ts";
      console.log("SUCCESS:", message);
    `,
  });

  // Start bun in watch mode (file2.ts doesn't exist yet)
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--watch", "file1.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  let stdout = "";
  let stderr = "";

  const stdoutReader = (async () => {
    for await (const chunk of proc.stdout) {
      stdout += new TextDecoder().decode(chunk);
    }
  })();

  const stderrReader = (async () => {
    for await (const chunk of proc.stderr) {
      stderr += new TextDecoder().decode(chunk);
    }
  })();

  // Wait for polling to start and for output to be captured
  await Bun.sleep(1500);

  const combined1 = stdout + stderr;

  // Should see the polling message
  expect(combined1).toContain("Module not found");
  expect(combined1).toContain("Polling every 50ms");

  // Now create the missing file
  fs.writeFileSync(join(String(dir), "file2.ts"), `export const message = "Hello from file2!";\n`);

  // Wait for polling to detect it and reload
  await Bun.sleep(300);

  proc.kill();
  await Promise.race([proc.exited, Bun.sleep(2000)]);

  await Promise.race([Promise.all([stdoutReader, stderrReader]), Bun.sleep(500)]);

  const combined2 = stdout + stderr;

  // Should see the reload message
  // Note: The actual "SUCCESS" output happens after the process restart,
  // which creates a new process that we can't capture in this test.
  // But we can verify that the polling detected the file and triggered reload.
  expect(combined2).toContain("now exists, reloading");
}, 10000);

test("watch mode should handle relative path imports that don't exist", async () => {
  using dir = tempDir("watch-missing-relative", {
    "index.ts": `
      import { data } from "./lib/helper.ts";
      console.log("LOADED:", data);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--watch", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  let output = "";

  const reader = (async () => {
    for await (const chunk of proc.stdout) {
      output += new TextDecoder().decode(chunk);
    }
  })();

  const errReader = (async () => {
    for await (const chunk of proc.stderr) {
      output += new TextDecoder().decode(chunk);
    }
  })();

  await Bun.sleep(1500);

  // Should be polling for the missing file
  expect(output).toContain("Polling every 50ms");

  // Create the directory and file
  fs.mkdirSync(join(String(dir), "lib"), { recursive: true });
  fs.writeFileSync(join(String(dir), "lib", "helper.ts"), `export const data = 42;\n`);

  await Bun.sleep(300);

  proc.kill();
  await Promise.race([proc.exited, Bun.sleep(2000)]);
  await Promise.race([Promise.all([reader, errReader]), Bun.sleep(500)]);

  // Should see the reload message
  expect(output).toContain("now exists, reloading");
}, 10000);

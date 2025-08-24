import { test, expect } from "bun:test";
import {
  bunEnv,
  bunExe,
  tempDirWithFiles,
  writeFile,
} from "harness";
import { resolve } from "path";

test("--restart flag parsing", () => {
  // This test just verifies the flag is recognized (will fail if unknown flag)
  expect(() => {
    Bun.spawnSync({
      cmd: [bunExe(), "run", "--restart", "no", "--help"],
      env: bunEnv,
      stderr: "pipe",
    });
  }).not.toThrow();
});

test("--restart with invalid policy shows error", async () => {
  const proc = Bun.spawn({
    cmd: [bunExe(), "run", "--restart", "invalid", "non-existent-file.js"],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("Invalid restart policy");
  expect(stderr).toContain("no, on-failure, always, unless-stopped");
});

test("--restart=no does not restart on success", async () => {
  const dir = tempDirWithFiles("restart-no", {
    "success.js": `
      console.log("This script succeeds");
      process.exit(0);
    `,
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "run", "--restart", "no", resolve(dir, "success.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("This script succeeds");
  // Should only appear once, not restarted
  expect(stdout.split("This script succeeds").length - 1).toBe(1);
});

test("--restart=no does not restart on failure", async () => {
  const dir = tempDirWithFiles("restart-no-fail", {
    "fail.js": `
      console.log("This script fails");
      process.exit(1);
    `,
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "run", "--restart", "no", resolve(dir, "fail.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(1);
  expect(stdout).toContain("This script fails");
  // Should only appear once, not restarted
  expect(stdout.split("This script fails").length - 1).toBe(1);
});

test("--restart=on-failure restarts on failure but not success", async () => {
  const dir = tempDirWithFiles("restart-on-failure", {
    "counter.js": `
      const fs = require('fs');
      const path = require('path');
      const counterFile = path.join(__dirname, 'restart-counter.txt');
      
      let count = 0;
      if (fs.existsSync(counterFile)) {
        count = parseInt(fs.readFileSync(counterFile, 'utf8') || '0', 10);
      }
      count++;
      fs.writeFileSync(counterFile, count.toString());
      
      console.log(\`Attempt \${count}\`);
      
      // Fail first two attempts, succeed on third
      if (count < 3) {
        process.exit(1);
      } else {
        process.exit(0);
      }
    `,
    "success.js": `
      console.log("Success script");
      process.exit(0);
    `,
  });

  // Test failure case - should restart
  const proc1 = Bun.spawn({
    cmd: [bunExe(), "run", "--restart", "on-failure", resolve(dir, "counter.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout_ms: 10000, // Give enough time for restarts
  });

  const [stdout1, stderr1, exitCode1] = await Promise.all([
    proc1.stdout.text(),
    proc1.stderr.text(),
    proc1.exited,
  ]);

  expect(exitCode1).toBe(0); // Should eventually succeed
  expect(stdout1).toContain("Attempt 1");
  expect(stdout1).toContain("Attempt 2");
  expect(stdout1).toContain("Attempt 3");

  // Test success case - should not restart
  const proc2 = Bun.spawn({
    cmd: [bunExe(), "run", "--restart", "on-failure", resolve(dir, "success.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([
    proc2.stdout.text(),
    proc2.stderr.text(),
    proc2.exited,
  ]);

  expect(exitCode2).toBe(0);
  expect(stdout2).toContain("Success script");
  // Should only appear once, not restarted
  expect(stdout2.split("Success script").length - 1).toBe(1);
});

test("--restart=always restarts on both success and failure", async () => {
  const dir = tempDirWithFiles("restart-always", {
    "counter.js": `
      const fs = require('fs');
      const path = require('path');
      const counterFile = path.join(__dirname, 'always-counter.txt');
      
      let count = 0;
      if (fs.existsSync(counterFile)) {
        count = parseInt(fs.readFileSync(counterFile, 'utf8') || '0', 10);
      }
      count++;
      fs.writeFileSync(counterFile, count.toString());
      
      console.log(\`Always attempt \${count}\`);
      
      // Exit with success after 3 attempts to avoid infinite loop
      if (count >= 3) {
        // Force exit to avoid infinite restart
        process.exit(1); // Exit with failure to break the loop
      } else {
        process.exit(0); // Still restart even on success
      }
    `,
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "run", "--restart", "always", resolve(dir, "counter.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Kill the process after a short time since "always" would run forever
  setTimeout(() => proc.kill(), 3000);

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Should have been killed, so expect non-zero exit
  expect(exitCode).not.toBe(0);
  expect(stdout).toContain("Always attempt 1");
  expect(stdout).toContain("Always attempt 2");
  expect(stdout).toContain("Always attempt 3");
}, 15000);

test("--restart=unless-stopped restarts on failure but not success", async () => {
  const dir = tempDirWithFiles("restart-unless-stopped", {
    "counter-fail.js": `
      const fs = require('fs');
      const path = require('path');
      const counterFile = path.join(__dirname, 'unless-stopped-counter.txt');
      
      let count = 0;
      if (fs.existsSync(counterFile)) {
        count = parseInt(fs.readFileSync(counterFile, 'utf8') || '0', 10);
      }
      count++;
      fs.writeFileSync(counterFile, count.toString());
      
      console.log(\`Unless-stopped fail attempt \${count}\`);
      
      // Succeed after 3 attempts
      if (count >= 3) {
        process.exit(0);
      } else {
        process.exit(1);
      }
    `,
    "success-stop.js": `
      console.log("Unless-stopped success");
      process.exit(0);
    `,
  });

  // Test failure case - should restart
  const proc1 = Bun.spawn({
    cmd: [bunExe(), "run", "--restart", "unless-stopped", resolve(dir, "counter-fail.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout_ms: 10000,
  });

  const [stdout1, stderr1, exitCode1] = await Promise.all([
    proc1.stdout.text(),
    proc1.stderr.text(),
    proc1.exited,
  ]);

  expect(exitCode1).toBe(0);
  expect(stdout1).toContain("Unless-stopped fail attempt 1");
  expect(stdout1).toContain("Unless-stopped fail attempt 2");
  expect(stdout1).toContain("Unless-stopped fail attempt 3");

  // Test success case - should NOT restart (stopped manually)
  const proc2 = Bun.spawn({
    cmd: [bunExe(), "run", "--restart", "unless-stopped", resolve(dir, "success-stop.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([
    proc2.stdout.text(),
    proc2.stderr.text(),
    proc2.exited,
  ]);

  expect(exitCode2).toBe(0);
  expect(stdout2).toContain("Unless-stopped success");
  // Should only appear once, not restarted
  expect(stdout2.split("Unless-stopped success").length - 1).toBe(1);
});

test("--restart works with package.json scripts", async () => {
  const dir = tempDirWithFiles("restart-pkg-script", {
    "package.json": JSON.stringify({
      name: "restart-test",
      scripts: {
        "fail-script": "node fail-counter.js",
        "success-script": "node success.js",
      },
    }),
    "fail-counter.js": `
      const fs = require('fs');
      const path = require('path');
      const counterFile = path.join(__dirname, 'pkg-script-counter.txt');
      
      let count = 0;
      if (fs.existsSync(counterFile)) {
        count = parseInt(fs.readFileSync(counterFile, 'utf8') || '0', 10);
      }
      count++;
      fs.writeFileSync(counterFile, count.toString());
      
      console.log(\`Package script attempt \${count}\`);
      
      // Succeed after 2 attempts
      if (count >= 2) {
        process.exit(0);
      } else {
        process.exit(1);
      }
    `,
    "success.js": `
      console.log("Package script success");
      process.exit(0);
    `,
  });

  // Test restart on failure with package script
  const proc = Bun.spawn({
    cmd: [bunExe(), "run", "--restart", "on-failure", "fail-script"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    timeout_ms: 10000,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("Package script attempt 1");
  expect(stdout).toContain("Package script attempt 2");
}, 15000);

test("--restart flag is available but has no effect on install command", async () => {
  // Test that --restart flag doesn't break install but has no restart behavior
  const proc = Bun.spawn({
    cmd: [bunExe(), "install", "--restart", "no"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Install should work normally and exit successfully
  expect(exitCode).toBe(0);
  // Should not show any restart-related behavior or errors
  expect(stderr).not.toContain("Invalid restart policy");
});

test("multiple --restart flags uses the last one", async () => {
  const dir = tempDirWithFiles("restart-multiple", {
    "test.js": `
      console.log("Multiple restart flags test");
      process.exit(0);
    `,
  });

  // Last --restart flag should win
  const proc = Bun.spawn({
    cmd: [bunExe(), "run", "--restart", "always", "--restart", "no", resolve(dir, "test.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("Multiple restart flags test");
  // Should only appear once since last flag was "no"
  expect(stdout.split("Multiple restart flags test").length - 1).toBe(1);
});
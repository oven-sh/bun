import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterEach, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

let watchee: Subprocess | undefined;

async function waitForFile(filePath: string, timeout = 10_000): Promise<string> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const content = await Bun.file(filePath).text();
      if (content.length > 0) return content;
    } catch {}
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for file: ${filePath}`);
}

async function waitForFileChange(filePath: string, previous: string, timeout = 10_000): Promise<string> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const content = await Bun.file(filePath).text();
      if (content !== previous) return content;
    } catch {}
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for ${filePath} to change from: ${previous}`);
}

it("should exclude files matching --watch-excludes patterns", async () => {
  using dir = tempDir("watch-excludes-cli", {});
  const cwd = String(dir);
  const scriptPath = join(cwd, "script.js");
  const dataPath = join(cwd, "data.json");
  const logPath = join(cwd, "output.log");

  await Bun.write(scriptPath, `
    const fs = require("fs");
    fs.writeFileSync("${logPath}", "executed-" + Date.now());
    let count = 0;
    setInterval(() => {
      count++;
      fs.writeFileSync("${dataPath}", JSON.stringify({ count }));
    }, 100);
    process.on('SIGTERM', () => process.exit(0));
  `);

  await Bun.write(dataPath, "{}");

  watchee = spawn({
    cwd,
    cmd: [bunExe(), "--watch", "--watch-excludes", "*.json", "script.js"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });

  // Wait for initial execution
  const initialLog = await waitForFile(logPath);

  // Wait until data.json has been modified at least 5 times (excluded file changes)
  let prev = "{}";
  for (let i = 0; i < 5; i++) {
    prev = await waitForFileChange(dataPath, prev);
  }

  // Excluded file modifications should not have triggered a reload
  expect(await Bun.file(logPath).text()).toBe(initialLog);

  // Modify the watched file — should trigger reload
  await Bun.write(scriptPath, `
    require("fs").writeFileSync("${logPath}", "reloaded-" + Date.now());
    process.on('SIGTERM', () => process.exit(0));
  `);

  const finalLog = await waitForFileChange(logPath, initialLog);
  expect(finalLog).toContain("reloaded-");
});

it("should exclude files using bunfig.toml watch.excludes configuration", async () => {
  using dir = tempDir("watch-excludes-bunfig", {});
  const cwd = String(dir);
  const scriptPath = join(cwd, "script.js");
  const dataPath = join(cwd, "data.json");
  const logPath = join(cwd, "output.log");
  const bunfigPath = join(cwd, "bunfig.toml");

  await Bun.write(bunfigPath, `
[watch]
excludes = ["*.json"]
  `);

  await Bun.write(scriptPath, `
    const fs = require("fs");
    fs.writeFileSync("${logPath}", "executed-" + Date.now());
    let count = 0;
    setInterval(() => {
      count++;
      fs.writeFileSync("${dataPath}", JSON.stringify({ count }));
    }, 100);
    process.on('SIGTERM', () => process.exit(0));
  `);

  await Bun.write(dataPath, "{}");

  watchee = spawn({
    cwd,
    cmd: [bunExe(), "--watch", "script.js"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });

  // Wait for initial execution
  const initialLog = await waitForFile(logPath);

  // Wait until data.json has been modified at least 5 times (excluded file changes)
  let prev = "{}";
  for (let i = 0; i < 5; i++) {
    prev = await waitForFileChange(dataPath, prev);
  }

  // Excluded file modifications should not have triggered a reload
  expect(await Bun.file(logPath).text()).toBe(initialLog);

  // Modify the watched file — should trigger reload
  await Bun.write(scriptPath, `
    require("fs").writeFileSync("${logPath}", "reloaded-" + Date.now());
    process.on('SIGTERM', () => process.exit(0));
  `);

  const finalLog = await waitForFileChange(logPath, initialLog);
  expect(finalLog).toContain("reloaded-");
});

afterEach(() => {
  watchee?.kill();
  watchee = undefined;
});


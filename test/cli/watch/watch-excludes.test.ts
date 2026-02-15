import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterEach, expect, it } from "bun:test";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";

let watchee: Subprocess;

it("should exclude files matching --watch-excludes patterns", async () => {
  const cwd = tmpdirSync();
  const scriptPath = join(cwd, "script.js");
  const dataPath = join(cwd, "data.json");
  const logPath = join(cwd, "output.log");

  // Create script that continuously modifies excluded files
  await Bun.write(scriptPath, `
    require("fs").writeFileSync("${logPath}", "executed-" + Date.now());
    
    setInterval(() => {
      require("fs").writeFileSync("${dataPath}", JSON.stringify({ timestamp: Date.now() }));
    }, 500);
    
    process.on('SIGTERM', () => process.exit(0));
  `);

  await Bun.write(dataPath, "{}");

  // Start watching with *.json excluded
  watchee = spawn({
    cwd,
    cmd: [bunExe(), "--watch", "--watch-excludes", "*.json", "script.js"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });

  await Bun.sleep(1000);
  const initialLog = await Bun.file(logPath).text();

  // Wait for script to modify excluded files multiple times
  await Bun.sleep(2000);
  
  // Excluded file modifications should not trigger reload
  expect(await Bun.file(logPath).text()).toBe(initialLog);

  // Modify watched file - should trigger reload
  await Bun.write(scriptPath, `
    require("fs").writeFileSync("${logPath}", "reloaded-" + Date.now());
    process.on('SIGTERM', () => process.exit(0));
  `);

  await Bun.sleep(1000);

  // Should have reloaded
  const finalLog = await Bun.file(logPath).text();
  expect(finalLog).toContain("reloaded-");
  expect(finalLog).not.toBe(initialLog);

  // Cleanup
  rmSync(scriptPath, { force: true });
  rmSync(dataPath, { force: true });
  rmSync(logPath, { force: true });
}, 6000);

it("should exclude files using bunfig.toml watch.excludes configuration", async () => {
  const cwd = tmpdirSync();
  const scriptPath = join(cwd, "script.js");
  const dataPath = join(cwd, "data.json");
  const logPath = join(cwd, "output.log");
  const bunfigPath = join(cwd, "bunfig.toml");

  // Create bunfig.toml with watch excludes
  await Bun.write(bunfigPath, `
[watch]
excludes = ["*.json"]
  `);

  // Create script that continuously modifies excluded files
  await Bun.write(scriptPath, `
    require("fs").writeFileSync("${logPath}", "executed-" + Date.now());
    
    setInterval(() => {
      require("fs").writeFileSync("${dataPath}", JSON.stringify({ timestamp: Date.now() }));
    }, 500);
    
    process.on('SIGTERM', () => process.exit(0));
  `);

  // Create excluded data file
  await Bun.write(dataPath, "{}");

  // Start watching without CLI excludes - should use bunfig.toml
  watchee = spawn({
    cwd,
    cmd: [bunExe(), "--watch", "script.js"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });

  await Bun.sleep(1000);
  const initialLog = await Bun.file(logPath).text();

  // Wait for script to modify excluded files multiple times
  await Bun.sleep(2000);
  
  // Excluded file modifications should not trigger reload
  expect(await Bun.file(logPath).text()).toBe(initialLog);

  // Modify watched file - should trigger reload
  await Bun.write(scriptPath, `
    require("fs").writeFileSync("${logPath}", "reloaded-" + Date.now());
    process.on('SIGTERM', () => process.exit(0));
  `);

  await Bun.sleep(1000);

  // Should have reloaded
  const finalLog = await Bun.file(logPath).text();
  expect(finalLog).toContain("reloaded-");
  expect(finalLog).not.toBe(initialLog);

  // Cleanup
  rmSync(scriptPath, { force: true });
  rmSync(dataPath, { force: true });
  rmSync(logPath, { force: true });
  rmSync(bunfigPath, { force: true });
}, 6000);

afterEach(() => {
  watchee?.kill();
});

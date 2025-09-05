import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { bunEnv, bunExe, tempDir } from "harness";

describe("SQLite custom loading", () => {
  test("default SQLite loads successfully", () => {
    // Create a new process to ensure clean state
    const code = `
      import { Database } from "bun:sqlite";
      const db = new Database(":memory:");
      const result = db.query("SELECT sqlite_version() as version").get();
      console.log(result.version);
      db.close();
    `;
    
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString().trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("setCustomSQLite throws error after SQLite is already loaded", () => {
    // Create a new process to ensure clean state
    const code = `
      import { Database } from "bun:sqlite";
      const db = new Database(":memory:");
      db.close();
      
      try {
        Database.setCustomSQLite("/usr/lib/libsqlite3.so");
        console.log("ERROR: Should have thrown");
        process.exit(1);
      } catch (error) {
        console.log("SUCCESS");
      }
    `;
    
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString().trim()).toBe("SUCCESS");
  });

  // This test is only meaningful on systems with a separate SQLite library
  test.todoIf(process.platform === "linux", "setCustomSQLite can load dynamic library before first use", () => {
    // This test would require a known SQLite library path
    // and needs to run in a fresh process
    const code = `
      import { Database } from "bun:sqlite";
      import { existsSync } from "fs";
      
      const paths = [
        "/usr/lib/x86_64-linux-gnu/libsqlite3.so",
        "/usr/lib/aarch64-linux-gnu/libsqlite3.so",
        "/usr/lib/libsqlite3.so",
      ];
      
      let customPath = null;
      for (const path of paths) {
        if (existsSync(path)) {
          customPath = path;
          break;
        }
      }
      
      if (customPath) {
        Database.setCustomSQLite(customPath);
        const db = new Database(":memory:");
        const result = db.query("SELECT sqlite_version() as version").get();
        console.log(result.version);
        db.close();
      } else {
        console.log("NO_LIBRARY");
      }
    `;
    
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    
    expect(proc.exitCode).toBe(0);
    const output = proc.stdout.toString().trim();
    if (output === "NO_LIBRARY") {
      // Skip if no library found
      return;
    }
    expect(output).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
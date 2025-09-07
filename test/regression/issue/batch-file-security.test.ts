import { test, expect, describe } from "bun:test";
import { spawn, spawnSync, exec, execSync } from "node:child_process";
import { tempDir, bunEnv, bunExe } from "harness";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

describe("Batch file execution security on Windows", () => {
  // Only run these tests on Windows
  if (process.platform !== "win32") {
    test.skip("Windows-only test", () => {});
    return;
  }

  test("should prevent direct execution of .bat files without shell option", () => {
    using dir = tempDir("batch-security");
    const batFile = join(String(dir), "test.bat");
    writeFileSync(batFile, "@echo test output");

    // This should throw an error
    expect(() => {
      spawnSync(batFile, [], { env: bunEnv });
    }).toThrow();

    // Try with spawn (async)
    const child = spawn(batFile, [], { env: bunEnv });
    
    return new Promise((resolve, reject) => {
      child.on("error", (err) => {
        expect(err.code).toBe("EINVAL");
        resolve();
      });
      child.on("exit", () => {
        reject(new Error("Process should not have executed"));
      });
    });
  });

  test("should prevent direct execution of .cmd files without shell option", () => {
    using dir = tempDir("batch-security");
    const cmdFile = join(String(dir), "test.cmd");
    writeFileSync(cmdFile, "@echo test output");

    // This should throw an error
    expect(() => {
      spawnSync(cmdFile, [], { env: bunEnv });
    }).toThrow();

    // Try with spawn (async)
    const child = spawn(cmdFile, [], { env: bunEnv });
    
    return new Promise((resolve, reject) => {
      child.on("error", (err) => {
        expect(err.code).toBe("EINVAL");
        resolve();
      });
      child.on("exit", () => {
        reject(new Error("Process should not have executed"));
      });
    });
  });

  test("should allow execution of .bat files with shell: true", () => {
    using dir = tempDir("batch-security");
    const batFile = join(String(dir), "test.bat");
    writeFileSync(batFile, "@echo test output");

    // This should work
    const result = spawnSync(batFile, [], { 
      shell: true,
      encoding: "utf8",
      env: bunEnv 
    });
    
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("test output");
  });

  test("should allow execution of .cmd files with shell: true", () => {
    using dir = tempDir("batch-security");
    const cmdFile = join(String(dir), "test.cmd");
    writeFileSync(cmdFile, "@echo test output");

    // This should work
    const result = spawnSync(cmdFile, [], { 
      shell: true,
      encoding: "utf8",
      env: bunEnv 
    });
    
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("test output");
  });

  test("should prevent command injection in batch file arguments without shell", () => {
    using dir = tempDir("batch-security");
    const batFile = join(String(dir), "test.bat");
    writeFileSync(batFile, "@echo %1");

    // This should throw an error (batch files can't be executed without shell)
    expect(() => {
      spawnSync(batFile, ["&calc.exe"], { env: bunEnv });
    }).toThrow();

    // Also test with quotes
    expect(() => {
      spawnSync(batFile, ['"&calc.exe'], { env: bunEnv });
    }).toThrow();
  });

  test("exec and execSync should work with batch files (they use shell by default)", () => {
    using dir = tempDir("batch-security");
    const batFile = join(String(dir), "test.bat");
    writeFileSync(batFile, "@echo exec test");

    // execSync uses shell by default
    const result = execSync(`"${batFile}"`, {
      encoding: "utf8",
      env: bunEnv
    });
    
    expect(result).toContain("exec test");

    // exec uses shell by default
    return new Promise((resolve, reject) => {
      exec(`"${batFile}"`, { env: bunEnv }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          expect(stdout).toContain("exec test");
          resolve();
        }
      });
    });
  });

  test("should handle case-insensitive batch file extensions", () => {
    using dir = tempDir("batch-security");
    
    const extensions = [".BAT", ".bAt", ".BaT", ".CMD", ".cMd", ".CmD"];
    
    for (const ext of extensions) {
      const file = join(String(dir), `test${ext}`);
      writeFileSync(file, "@echo test");
      
      // Should throw without shell
      expect(() => {
        spawnSync(file, [], { env: bunEnv });
      }).toThrow();
      
      // Should work with shell
      const result = spawnSync(file, [], { 
        shell: true,
        encoding: "utf8",
        env: bunEnv 
      });
      expect(result.status).toBe(0);
    }
  });

  test("should allow normal executables without shell", () => {
    // Test that normal executables still work
    const result = spawnSync("cmd.exe", ["/c", "echo", "test"], {
      encoding: "utf8",
      env: bunEnv
    });
    
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("test");
  });

  test("should check the actual file being executed, not arguments", () => {
    using dir = tempDir("batch-security");
    const batFile = join(String(dir), "test.bat");
    writeFileSync(batFile, "@echo test");

    // Even if we have .bat in arguments, should work if the executable is not a batch file
    const result = spawnSync("cmd.exe", ["/c", "echo", "test.bat"], {
      encoding: "utf8",
      env: bunEnv
    });
    
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("test.bat");
  });
});
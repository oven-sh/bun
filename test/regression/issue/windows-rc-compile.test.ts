import { tempDirWithFiles, bunExe, bunEnv, isWindows } from "harness";
import { test, expect, describe } from "bun:test";
import path from "path";

describe("--windows-rc flag", () => {
  test.if(isWindows)("should apply custom RC file to compiled executable", async () => {
    const dir = tempDirWithFiles("windows-rc-test", {
      "index.js": `console.log("Hello from custom RC test!");`,
      "custom.rc": `#include "windows.h"

VS_VERSION_INFO VERSIONINFO
FILEVERSION 2,0,0,1
PRODUCTVERSION 2,0,0,1
FILEFLAGSMASK 0x3fL
#ifdef _DEBUG
FILEFLAGS 0x1L
#else
FILEFLAGS 0x0L
#endif
FILEOS 0x4L
FILETYPE 0x1L
FILESUBTYPE 0x0L
BEGIN
    BLOCK "StringFileInfo"
    BEGIN
        BLOCK "040904b0"
        BEGIN
            VALUE "FileDescription", "Custom Test Application\\0"
            VALUE "FileVersion", "2.0.0.1\\0"
            VALUE "InternalName", "test-app\\0"
            VALUE "OriginalFilename", "test-app.exe\\0"
            VALUE "ProductName", "My Custom Product\\0"
            VALUE "ProductVersion", "2.0.0.1\\0"
            VALUE "CompanyName", "Test Company Inc.\\0"
            VALUE "LegalCopyright", "Copyright (C) 2024 Test Company\\0"
        END
    END
    BLOCK "VarFileInfo"
    BEGIN
        VALUE "Translation", 0x409, 1200
    END
END`,
    });

    const outfile = path.join(dir, "test-app.exe");
    const rcFile = path.join(dir, "custom.rc");

    // Build the executable with custom RC file
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        path.join(dir, "index.js"),
        "--compile",
        "--windows-rc",
        rcFile,
        "--outfile",
        outfile,
      ],
      env: bunEnv,
      cwd: dir,
    });

    const [exitCode] = await Promise.all([proc.exited]);
    expect(exitCode).toBe(0);

    // Verify the executable exists
    expect(Bun.file(outfile).size).toBeGreaterThan(0);

    // Test that the executable runs
    const { exitCode: runExitCode, stdout } = Bun.spawnSync({
      cmd: [outfile],
      env: bunEnv,
      stdout: "pipe",
    });

    expect(runExitCode).toBe(0);
    expect(stdout.toString()).toContain("Hello from custom RC test!");
  });

  test.if(isWindows)("should handle non-existent RC file gracefully", async () => {
    const dir = tempDirWithFiles("windows-rc-fail-test", {
      "index.js": `console.log("Hello world!");`,
    });

    const outfile = path.join(dir, "test-app.exe");
    const nonExistentRc = path.join(dir, "nonexistent.rc");

    // Build should still succeed but warn about missing RC file
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        path.join(dir, "index.js"),
        "--compile",
        "--windows-rc",
        nonExistentRc,  
        "--outfile",
        outfile,
      ],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
    });

    const [exitCode, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toContain("Custom RC file not found");

    // Verify the executable still exists and runs
    expect(Bun.file(outfile).size).toBeGreaterThan(0);
    
    const { exitCode: runExitCode } = Bun.spawnSync({
      cmd: [outfile],
      env: bunEnv,
    });

    expect(runExitCode).toBe(0);
  });

  test.if(!isWindows)("should error when --windows-rc is used on non-Windows", async () => {
    const dir = tempDirWithFiles("windows-rc-non-win-test", {
      "index.js": `console.log("Hello world!");`,
      "custom.rc": "/* dummy rc file */",
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build", 
        path.join(dir, "index.js"),
        "--compile",
        "--windows-rc",
        path.join(dir, "custom.rc"),
        "--outfile",
        path.join(dir, "test-app"),
      ],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exitCode, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("--windows-rc is only available when compiling on Windows");
  });

  test.if(isWindows)("should error when --windows-rc is used without --compile", async () => {
    const dir = tempDirWithFiles("windows-rc-no-compile-test", {
      "index.js": `console.log("Hello world!");`,
      "custom.rc": "/* dummy rc file */",
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        path.join(dir, "index.js"),
        "--windows-rc",
        path.join(dir, "custom.rc"),
        "--outfile",
        path.join(dir, "test-app.js"),
      ],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
    });

    const [exitCode, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("--windows-rc requires --compile");
  });
});
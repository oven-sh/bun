import { $ } from "bun";
import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { tempDirWithFiles, bunExe, bunEnv, tmpdirSync, isWindows, isPosix } from "harness";
import { mkdirSync, writeFileSync, chmodSync, symlinkSync, existsSync } from "node:fs";
import path from "node:path";
import { sortedShellOutput } from "../util";

$.nothrow();

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
});

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await $`ls -d ${path}`;
    return true;
  } catch {
    return false;
  }
};

describe("rm edge cases and error paths", () => {
  // Test 1: Basic functionality covered by existing tests - marking as complete

  // Test 2: Permission errors (EPERM)
  test.skipIf(isWindows)("permission denied errors", async () => {
    const tmpdir = tmpdirSync();
    const protectedFile = path.join(tmpdir, "protected.txt");
    const protectedDir = path.join(tmpdir, "protected_dir");
    const fileInProtectedDir = path.join(protectedDir, "file.txt");

    // Create protected file
    writeFileSync(protectedFile, "test");
    chmodSync(protectedFile, 0o444); // Read-only

    // Create protected directory with file
    mkdirSync(protectedDir);
    writeFileSync(fileInProtectedDir, "test");
    chmodSync(protectedDir, 0o555); // Read/execute only

    // Try to remove read-only file without force
    {
      const { stderr, exitCode } = await $`rm ${protectedFile}`;
      // On macOS, removing read-only files might succeed
      if (exitCode !== 0) {
        expect(stderr.toString()).toContain("Permission denied");
      }
      // Cleanup - only if file still exists
      if (existsSync(protectedFile)) {
        chmodSync(protectedFile, 0o644);
      }
    }

    // Try to remove file in read-only directory
    {
      const { stderr, exitCode } = await $`rm ${fileInProtectedDir}`;
      expect(exitCode).toBe(1);
      expect(stderr.toString()).toContain("Permission denied");
    }

    // Cleanup
    chmodSync(protectedDir, 0o755);
  });

  // Test 3: Root directory protection
  test.skipIf(isWindows)("root directory protection", async () => {
    // Test various forms of root paths
    const rootPaths = isPosix ? ["/", "/../", "/./"] : ["C:\\", "C:\\..\\", "C:\\.\\"];

    for (const rootPath of rootPaths) {
      // Default behavior should prevent root deletion
      {
        const { stderr, exitCode } = await $`rm -rf ${rootPath}`;
        expect(exitCode).toBe(1);
        expect(stderr.toString()).toContain("may not be removed");
      }

      // Even with --no-preserve-root, Bun should protect root
      {
        const { stderr, exitCode } = await $`rm -rf --no-preserve-root ${rootPath}`;
        // Should still fail as an extra safety measure
        expect(exitCode).toBe(1);
      }
    }
  });

  // Test 4: Empty directory removal with -d
  test("empty directory removal with -d flag", async () => {
    const tmpdir = tmpdirSync();
    const emptyDir = path.join(tmpdir, "empty");

    mkdirSync(emptyDir);

    // -d should remove empty directory
    {
      const { exitCode } = await $`rm -d ${emptyDir}`;
      expect(exitCode).toBe(0);
      expect(existsSync(emptyDir)).toBe(false);
    }

    // -d on a file should work
    {
      const testFile = path.join(tmpdir, "test.txt");
      writeFileSync(testFile, "test");
      const { exitCode } = await $`rm -d ${testFile}`;
      expect(exitCode).toBe(0);
      expect(existsSync(testFile)).toBe(false);
    }
  });

  test("non-empty directory with -d flag", async () => {
    const tmpdir = tmpdirSync();
    const nonEmptyDir = path.join(tmpdir, "nonempty");
    const fileInDir = path.join(nonEmptyDir, "file.txt");

    mkdirSync(nonEmptyDir);
    writeFileSync(fileInDir, "test");

    // -d should fail on non-empty directory
    const { stderr, exitCode } = await $`rm -d ${nonEmptyDir}`;
    expect(exitCode).toBe(1);
    expect(stderr.toString()).toContain("Directory not empty");
    expect(existsSync(nonEmptyDir)).toBe(true);
  });

  test("non-existent file handling", async () => {
    const tmpdir = tmpdirSync();
    const nonExistent = path.join(tmpdir, "does_not_exist.txt");

    // Without -f should error
    {
      const { stderr, exitCode } = await $`rm ${nonExistent}`;
      expect(exitCode).toBe(1);
      expect(stderr.toString()).toContain("No such file or directory");
    }

    // With -f should succeed silently
    {
      const { stdout, stderr, exitCode } = await $`rm -f ${nonExistent}`;
      expect(exitCode).toBe(0);
      expect(stdout.toString()).toBe("");
      expect(stderr.toString()).toBe("");
    }

    // Multiple non-existent files with -f
    {
      const { exitCode } =
        await $`rm -f ${path.join(tmpdir, "fake1")} ${path.join(tmpdir, "fake2")} ${path.join(tmpdir, "fake3")}`;
      expect(exitCode).toBe(0);
    }
  });

  // Test 6: Deep recursive deletion
  test("deep recursive deletion", async () => {
    const tmpdir = tmpdirSync();
    const deepPath = path.join(tmpdir, "a", "b", "c", "d", "e", "f", "g");

    mkdirSync(deepPath, { recursive: true });

    // Create files at various depths
    writeFileSync(path.join(tmpdir, "a", "file1.txt"), "test");
    writeFileSync(path.join(tmpdir, "a", "b", "file2.txt"), "test");
    writeFileSync(path.join(tmpdir, "a", "b", "c", "file3.txt"), "test");
    writeFileSync(path.join(deepPath, "deep.txt"), "test");

    // Remove recursively with verbose
    {
      const { stdout, exitCode } = await $`rm -rv ${path.join(tmpdir, "a")}`;
      expect(exitCode).toBe(0);
      const output = stdout.toString();
      expect(output).toContain("file1.txt");
      expect(output).toContain("file2.txt");
      expect(output).toContain("file3.txt");
      expect(output).toContain("deep.txt");
      expect(existsSync(path.join(tmpdir, "a"))).toBe(false);
    }
  });

  // Test 7: Verbose mode output
  test("verbose mode output format", async () => {
    const tmpdir = tmpdirSync();
    const file1 = path.join(tmpdir, "file1.txt");
    const file2 = path.join(tmpdir, "file2.txt");
    const dir1 = path.join(tmpdir, "dir1");
    const fileInDir = path.join(dir1, "nested.txt");

    writeFileSync(file1, "test");
    writeFileSync(file2, "test");
    mkdirSync(dir1);
    writeFileSync(fileInDir, "test");

    // Verbose output for multiple files
    {
      const { stdout, exitCode } = await $`rm -v ${file1} ${file2}`;
      expect(exitCode).toBe(0);
      const lines = stdout.toString().trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(lines).toContain(file1);
      expect(lines).toContain(file2);
    }

    // Verbose recursive
    {
      const { stdout, exitCode } = await $`rm -rv ${dir1}`;
      expect(exitCode).toBe(0);
      const output = stdout.toString();
      expect(output).toContain(fileInDir);
      expect(output).toContain(dir1);
    }
  });

  // Test 8: Invalid command line options
  test("invalid command line options", async () => {
    // No arguments
    {
      const { stderr, exitCode } = await $`rm`;
      expect(exitCode).toBe(1);
      expect(stderr.toString()).toContain("usage:");
    }

    // Invalid flag
    {
      const { stderr, exitCode } = await $`rm -xyz test.txt`;
      expect(exitCode).toBe(1);
      expect(stderr.toString()).toContain("illegal option");
    }

    // Long invalid option
    {
      const { stderr, exitCode } = await $`rm --invalid-option test.txt`;
      expect(exitCode).toBe(1);
      expect(stderr.toString()).toContain("illegal option");
    }

    // Interactive mode not supported yet
    {
      const { stderr, exitCode } = await $`rm -i test.txt`;
      expect(exitCode).toBe(1);
      expect(stderr.toString()).toContain('-i" is not supported yet');
    }
  });

  // Test 9: Concurrent deletion
  test("concurrent deletion of multiple paths", async () => {
    const tmpdir = tmpdirSync();
    const paths: string[] = [];

    // Create 10 directories with files
    for (let i = 0; i < 10; i++) {
      const dir = path.join(tmpdir, `dir${i}`);
      mkdirSync(dir);
      for (let j = 0; j < 5; j++) {
        writeFileSync(path.join(dir, `file${j}.txt`), `content ${i}-${j}`);
      }
      paths.push(dir);
    }

    // Remove all concurrently
    {
      const { exitCode } = await $`rm -rf ${{ raw: paths.join(" ") }}`;
      expect(exitCode).toBe(0);

      // Verify all deleted
      for (const p of paths) {
        console.log(p);
        expect(existsSync(p)).toBe(false);
      }
    }
  });

  // Test for read-only files in nested directories
  test.skipIf(isWindows)("read-only file in nested directory", async () => {
    const tmpdir = tmpdirSync();
    const nestedPath = path.join(tmpdir, "level1", "level2", "level3");
    mkdirSync(nestedPath, { recursive: true });
    
    // Create read-only file deep in the structure
    const readOnlyFile = path.join(nestedPath, "readonly.txt");
    writeFileSync(readOnlyFile, "protected content");
    chmodSync(readOnlyFile, 0o444); // Read-only
    
    // Also create normal files at various levels
    writeFileSync(path.join(tmpdir, "level1", "normal1.txt"), "test");
    writeFileSync(path.join(tmpdir, "level1", "level2", "normal2.txt"), "test");
    
    // Try recursive deletion without force
    {
      const { stderr, exitCode } = await $`rm -r ${path.join(tmpdir, "level1")}`;
      // On macOS, removing read-only files might succeed
      if (exitCode !== 0) {
        expect(stderr.toString()).toContain("Permission denied");
        // Verify structure still exists
        expect(existsSync(path.join(tmpdir, "level1"))).toBe(true);
      }
    }
    
    // Try with force flag
    {
      const { exitCode } = await $`rm -rf ${path.join(tmpdir, "level1")}`;
      expect(exitCode).toBe(0);
      expect(existsSync(path.join(tmpdir, "level1"))).toBe(false);
    }
  });

  // Test for read-only directories in nested structure
  test.skipIf(isWindows)("read-only directory in nested structure", async () => {
    const tmpdir = tmpdirSync();
    const parentDir = path.join(tmpdir, "parent");
    const readOnlyDir = path.join(parentDir, "readonly_dir");
    const childDir = path.join(readOnlyDir, "child");
    
    // Create directory structure
    mkdirSync(childDir, { recursive: true });
    
    // Add files at various levels
    writeFileSync(path.join(parentDir, "parent_file.txt"), "test");
    writeFileSync(path.join(readOnlyDir, "readonly_file.txt"), "test");
    writeFileSync(path.join(childDir, "child_file.txt"), "test");
    
    // Make middle directory read-only
    chmodSync(readOnlyDir, 0o555); // Read/execute only
    
    // Try to remove the entire structure
    {
      const { stderr, exitCode } = await $`rm -r ${parentDir}`;
      expect(exitCode).toBe(1);
      expect(stderr.toString()).toContain("Permission denied");
      // Parent directory should still exist
      expect(existsSync(parentDir)).toBe(true);
    }
    
    // Try with force flag - should still fail because we can't delete files in read-only dir
    {
      const { stderr, exitCode } = await $`rm -rf ${parentDir}`;
      expect(exitCode).toBe(1);
      expect(stderr.toString()).toContain("Permission denied");
    }
    
    // Cleanup
    chmodSync(readOnlyDir, 0o755);
    await $`rm -rf ${parentDir}`;
  });

  // Test multiple read-only files/dirs in recursive deletion
  test.skipIf(isWindows)("multiple read-only items in recursive deletion", async () => {
    const tmpdir = tmpdirSync();
    const rootDir = path.join(tmpdir, "root");
    
    // Create complex structure with multiple read-only items
    const structure = {
      dir1: {
        files: ["file1.txt", "readonly1.txt"],
        subdirs: {
          subdir1: {
            files: ["file2.txt"],
            readonly: false
          }
        },
        readonly: false
      },
      readonly_dir: {
        files: ["file3.txt", "file4.txt"],
        subdirs: {
          subdir2: {
            files: ["file5.txt"],
            readonly: false
          }
        },
        readonly: true
      },
      dir2: {
        files: ["file6.txt", "readonly2.txt"],
        subdirs: {},
        readonly: false
      }
    };
    
    // Create the structure
    mkdirSync(rootDir);
    mkdirSync(path.join(rootDir, "dir1", "subdir1"), { recursive: true });
    mkdirSync(path.join(rootDir, "readonly_dir", "subdir2"), { recursive: true });
    mkdirSync(path.join(rootDir, "dir2"));
    
    // Create files
    writeFileSync(path.join(rootDir, "dir1", "file1.txt"), "test");
    writeFileSync(path.join(rootDir, "dir1", "readonly1.txt"), "test");
    writeFileSync(path.join(rootDir, "dir1", "subdir1", "file2.txt"), "test");
    writeFileSync(path.join(rootDir, "readonly_dir", "file3.txt"), "test");
    writeFileSync(path.join(rootDir, "readonly_dir", "file4.txt"), "test");
    writeFileSync(path.join(rootDir, "readonly_dir", "subdir2", "file5.txt"), "test");
    writeFileSync(path.join(rootDir, "dir2", "file6.txt"), "test");
    writeFileSync(path.join(rootDir, "dir2", "readonly2.txt"), "test");
    
    // Set permissions
    chmodSync(path.join(rootDir, "dir1", "readonly1.txt"), 0o444);
    chmodSync(path.join(rootDir, "dir2", "readonly2.txt"), 0o444);
    chmodSync(path.join(rootDir, "readonly_dir"), 0o555);
    
    // Try verbose recursive deletion to see what fails
    {
      const { stdout, stderr, exitCode } = await $`rm -rv ${rootDir}`;
      expect(exitCode).toBe(1);
      const stderrStr = stderr.toString();
      expect(stderrStr).toContain("Permission denied");
      
      // Some files should have been deleted (those in writable directories)
      const stdoutStr = stdout.toString();
      if (stdoutStr) {
        // On macOS, some files might be deleted
        console.log("Deleted files:", stdoutStr);
      }
    }
    
    // Force should handle read-only files but not read-only directories
    {
      const { stderr, exitCode } = await $`rm -rf ${rootDir}`;
      expect(exitCode).toBe(1);
      expect(stderr.toString()).toContain("Permission denied");
    }
    
    // Cleanup
    chmodSync(path.join(rootDir, "readonly_dir"), 0o755);
    await $`rm -rf ${rootDir}`;
  });

  // Test 10: Symlink handling
  test("symlink handling", async () => {
    const tmpdir = tmpdirSync();
    const targetFile = path.join(tmpdir, "target.txt");
    const targetDir = path.join(tmpdir, "targetdir");
    const linkToFile = path.join(tmpdir, "link_to_file");
    const linkToDir = path.join(tmpdir, "link_to_dir");

    writeFileSync(targetFile, "test");
    mkdirSync(targetDir);
    writeFileSync(path.join(targetDir, "file.txt"), "test");

    // Create symlinks
    symlinkSync(targetFile, linkToFile);
    symlinkSync(targetDir, linkToDir, "dir");

    // Remove symlink to file (should not remove target)
    {
      const { exitCode } = await $`rm ${linkToFile}`;
      expect(exitCode).toBe(0);
      expect(existsSync(linkToFile)).toBe(false);
      expect(existsSync(targetFile)).toBe(true);
    }

    // Remove symlink to directory without -r (should work)
    {
      const { exitCode } = await $`rm ${linkToDir}`;
      expect(exitCode).toBe(0);
      expect(existsSync(linkToDir)).toBe(false);
      expect(existsSync(targetDir)).toBe(true);
    }
  });

  // Test cross-platform path separators on Windows
  if (isWindows) {
    test("Windows path separator handling", async () => {
      const tmpdir = tmpdirSync();

      // Test with forward slashes
      const dirForward = tmpdir + "/test_dir";
      mkdirSync(dirForward);
      writeFileSync(dirForward + "/file.txt", "test");

      {
        const { exitCode } = await $`rm -rf ${dirForward}`;
        expect(exitCode).toBe(0);
        expect(existsSync(dirForward)).toBe(false);
      }

      // Test with backslashes
      const dirBackslash = tmpdir + "\\test_dir2";
      mkdirSync(dirBackslash);
      writeFileSync(dirBackslash + "\\file.txt", "test");

      {
        const { exitCode } = await $`rm -rf ${dirBackslash}`;
        expect(exitCode).toBe(0);
        expect(existsSync(dirBackslash)).toBe(false);
      }
    });
  }

  // Additional edge cases
  test("special characters in filenames", async () => {
    const tmpdir = tmpdirSync();
    const specialFiles = [
      "file with spaces.txt",
      "file-with-dashes.txt",
      "file_with_underscores.txt",
      "file.multiple.dots.txt",
      "file'with'quotes.txt",
      '"file"with"doublequotes.txt',
    ];

    for (const filename of specialFiles) {
      const filepath = path.join(tmpdir, filename);
      writeFileSync(filepath, "test");

      const { exitCode } = await $`rm ${filepath}`;
      expect(exitCode).toBe(0);
      expect(existsSync(filepath)).toBe(false);
    }
  });

  test("directory with many entries", async () => {
    const tmpdir = tmpdirSync();
    const bigDir = path.join(tmpdir, "big");
    mkdirSync(bigDir);

    // Create 1000 files
    for (let i = 0; i < 1000; i++) {
      writeFileSync(path.join(bigDir, `file${i}.txt`), `content ${i}`);
    }

    const start = Date.now();
    const { exitCode } = await $`rm -rf ${bigDir}`;
    const duration = Date.now() - start;

    expect(exitCode).toBe(0);
    expect(existsSync(bigDir)).toBe(false);

    // Should complete reasonably quickly even with many files
    expect(duration).toBeLessThan(10000); // 10 seconds
  });

  // Test force flag with non-existent files (safe version)
  test("force flag with non-existent files", async () => {
    const tmpdir = tmpdirSync();
    const nonExistent = path.join(tmpdir, "does_not_exist.txt");

    // With -f should succeed silently
    const { stdout, stderr, exitCode } = await $`rm -f ${nonExistent}`;
    expect(exitCode).toBe(0);
    expect(stdout.toString()).toBe("");
    expect(stderr.toString()).toBe("");
  });
});

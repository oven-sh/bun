import { write } from "bun";
import { describe, expect, test } from "bun:test";
import { mkdirSync, unlinkSync, writeFileSync, symlinkSync, mkdtempSync, rmSync, chmodSync, constants } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("Bun.file().exists()", () => {
  test("basic existence checks", async () => {
    expect(await Bun.file(import.meta.path).exists()).toBeTrue();
    expect(await Bun.file(import.meta.path + ".nonexistent").exists()).toBeFalse();
    expect(await Bun.file(import.meta.dir).exists()).toBeFalse(); // directory, not a file
    expect(await Bun.file(import.meta.dir + "/").exists()).toBeFalse();
  });

  test("does not cache results (bug #22484)", async () => {
    const temp = join(tmpdir(), "bun-file-exists-caching-" + Math.random() + ".txt");
    
    // Create a single Bun.file instance
    const file = Bun.file(temp);
    
    // Initially doesn't exist
    expect(await file.exists()).toBeFalse();
    
    // Create the file
    writeFileSync(temp, "hello world");
    expect(await file.exists()).toBeTrue(); // Should see it now exists
    
    // Delete the file
    unlinkSync(temp);
    expect(await file.exists()).toBeFalse(); // Should see it's gone
    
    // Recreate with different content
    writeFileSync(temp, "different content");
    expect(await file.exists()).toBeTrue(); // Should see it exists again
    
    // Clean up
    unlinkSync(temp);
  });

  test("multiple instances track file state independently", async () => {
    const temp = join(tmpdir(), "bun-file-multi-instance-" + Math.random() + ".txt");
    
    const file1 = Bun.file(temp);
    const file2 = Bun.file(temp);
    
    expect(await file1.exists()).toBeFalse();
    expect(await file2.exists()).toBeFalse();
    
    writeFileSync(temp, "content");
    
    // Both should see the file now exists
    expect(await file1.exists()).toBeTrue();
    expect(await file2.exists()).toBeTrue();
    
    unlinkSync(temp);
    
    // Both should see it's gone
    expect(await file1.exists()).toBeFalse();
    expect(await file2.exists()).toBeFalse();
  });

  test("handles rapid file state changes", async () => {
    const temp = join(tmpdir(), "bun-file-rapid-" + Math.random() + ".txt");
    const file = Bun.file(temp);
    
    // Rapid create/delete cycle
    for (let i = 0; i < 10; i++) {
      expect(await file.exists()).toBeFalse();
      
      writeFileSync(temp, `iteration ${i}`);
      expect(await file.exists()).toBeTrue();
      
      unlinkSync(temp);
      expect(await file.exists()).toBeFalse();
    }
  });

  test("works with symlinks", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "bun-file-symlink-"));
    const realFile = join(tempDir, "real.txt");
    const symlink = join(tempDir, "link.txt");
    const deadLink = join(tempDir, "dead.txt");
    
    try {
      // Create real file and symlink to it
      writeFileSync(realFile, "content");
      symlinkSync(realFile, symlink);
      
      // Both should exist
      expect(await Bun.file(realFile).exists()).toBeTrue();
      expect(await Bun.file(symlink).exists()).toBeTrue();
      
      // Create a symlink to non-existent file
      symlinkSync(join(tempDir, "nonexistent.txt"), deadLink);
      expect(await Bun.file(deadLink).exists()).toBeFalse();
      
      // Delete the real file, symlink should now be broken
      unlinkSync(realFile);
      expect(await Bun.file(symlink).exists()).toBeFalse();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("handles permission-denied files", async () => {
    // Skip on Windows where chmod doesn't work the same
    if (process.platform === "win32") return;
    
    const tempDir = mkdtempSync(join(tmpdir(), "bun-file-perms-"));
    const file = join(tempDir, "noperms.txt");
    
    try {
      writeFileSync(file, "secret");
      
      // File exists and is readable
      expect(await Bun.file(file).exists()).toBeTrue();
      
      // Remove all permissions
      chmodSync(file, 0o000);
      
      // File still exists even if not readable
      // (exists() just checks if the file is there, not if it's readable)
      expect(await Bun.file(file).exists()).toBeTrue();
      
      // Restore permissions for cleanup
      chmodSync(file, 0o644);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("consistent with other Bun.file methods", async () => {
    const temp = join(tmpdir(), "bun-file-consistency-" + Math.random() + ".txt");
    const file = Bun.file(temp);
    
    // File doesn't exist
    expect(await file.exists()).toBeFalse();
    
    // text() throws when file doesn't exist
    await expect(file.text()).rejects.toThrow();
    
    // Create file
    writeFileSync(temp, "hello");
    
    // Now both work
    expect(await file.exists()).toBeTrue();
    expect(await file.text()).toBe("hello");
    
    // Update content - text() sees new content immediately
    writeFileSync(temp, "world");
    expect(await file.text()).toBe("world");
    expect(await file.exists()).toBeTrue(); // Still exists
    
    // Delete file
    unlinkSync(temp);
    expect(await file.exists()).toBeFalse();
    await expect(file.text()).rejects.toThrow();
  });

  test("handles edge cases", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "bun-file-edge-"));
    
    try {
      // Empty filename
      expect(await Bun.file("").exists()).toBeFalse();
      
      // Null byte in filename (invalid) - should throw
      expect(() => Bun.file("test\0.txt")).toThrow();
      
      // Long filename (but within system limits)
      const longName = join(tempDir, "x".repeat(200) + ".txt");
      writeFileSync(longName, "test");
      expect(await Bun.file(longName).exists()).toBeTrue();
      
      // File with spaces and special characters
      const weirdName = join(tempDir, "  spaces & special!@#$%^&*().txt  ");
      writeFileSync(weirdName, "test");
      expect(await Bun.file(weirdName).exists()).toBeTrue();
      
      // Hidden file (Unix-style)
      const hidden = join(tempDir, ".hidden");
      writeFileSync(hidden, "secret");
      expect(await Bun.file(hidden).exists()).toBeTrue();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("performance: repeated exists() calls are reasonable", async () => {
    const temp = join(tmpdir(), "bun-file-perf-" + Math.random() + ".txt");
    writeFileSync(temp, "test");
    
    try {
      const file = Bun.file(temp);
      const iterations = 1000;
      
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        await file.exists();
      }
      const duration = performance.now() - start;
      
      // Should be reasonably fast (< 1ms per call on average)
      // This is a sanity check, not a strict requirement
      const msPerCall = duration / iterations;
      expect(msPerCall).toBeLessThan(1);
      
      // Log for debugging if needed
      // console.log(`exists() performance: ${msPerCall.toFixed(3)}ms per call`);
    } finally {
      unlinkSync(temp);
    }
  });

  test("race condition: concurrent modifications", async () => {
    const temp = join(tmpdir(), "bun-file-race-" + Math.random() + ".txt");
    const file = Bun.file(temp);
    
    // Start with file existing
    writeFileSync(temp, "initial");
    
    // Launch multiple concurrent operations
    const operations = [];
    for (let i = 0; i < 10; i++) {
      operations.push(
        (async () => {
          const exists1 = await file.exists();
          
          // Random delay
          await Bun.sleep(Math.random() * 10);
          
          if (i % 2 === 0) {
            try { unlinkSync(temp); } catch {}
          } else {
            try { writeFileSync(temp, `data-${i}`); } catch {}
          }
          
          const exists2 = await file.exists();
          
          // We can't predict the exact state due to races,
          // but exists() should never throw and should return a boolean
          expect(typeof exists1).toBe("boolean");
          expect(typeof exists2).toBe("boolean");
        })()
      );
    }
    
    await Promise.all(operations);
    
    // Clean up
    try { unlinkSync(temp); } catch {}
  });
});
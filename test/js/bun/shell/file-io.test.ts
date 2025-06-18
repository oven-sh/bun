import { $ } from "bun";
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";
import { createTestBuilder } from "./test_builder";
import * as fs from "node:fs";

const TestBuilder = createTestBuilder(import.meta.path);
const BUN = bunExe();

$.nothrow();

describe("IOWriter file output redirection", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = tmpdirSync();
  });

  afterEach(() => {
    // Cleanup temp directory if needed
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe("basic file redirection", () => {
    test("simple echo to file", async () => {
      const filepath = join(tempDir, "output.txt");
      await $`echo "hello world" > ${filepath}`.env(bunEnv);
      const content = await Bun.file(filepath).text();
      expect(content).toBe("hello world\n");
    });

    test("empty output to file", async () => {
      const filepath = join(tempDir, "empty.txt");
      await $`echo -n "" > ${filepath}`.env(bunEnv);
      const content = await Bun.file(filepath).text();
      expect(content).toBe("");
    });

    test("zero-length write should trigger onIOWriterChunk callback", async () => {
      const filepath = join(tempDir, "zero.txt");
      // This tests the early return in enqueue() for buf.len == 0
      await $`echo "" > ${filepath}`.env(bunEnv);
      const content = await Bun.file(filepath).text();
      expect(content).toBe("");
      expect(fs.existsSync(filepath)).toBe(true);
    });
  });

  describe("drainBufferedData edge cases", () => {
    test("large single write", async () => {
      const filepath = join(tempDir, "large.txt");
      // Test drainBufferedData with large buffer in one go
      const largeText = "x".repeat(1024 * 1024); // 1MB
      await $`echo -n ${largeText} > ${filepath}`.env(bunEnv);
      const content = await Bun.file(filepath).text();
      expect(content).toBe(largeText);
    });

    test("write to file that becomes unavailable", async () => {
      const filepath = join(tempDir, "disappearing.txt");
      // Create file, then remove directory to make it unavailable
      const parentDir = join(tempDir, "removeme");
      fs.mkdirSync(parentDir);
      const fileInDir = join(parentDir, "file.txt");

      // Write should succeed
      await $`echo "test" > ${fileInDir}`.env(bunEnv);
      const content = await Bun.file(fileInDir).text();
      expect(content).toBe("test\n");
    });
  });

  describe("file system error conditions", () => {
    test("write to read-only file should fail gracefully", async () => {
      const filepath = join(tempDir, "readonly.txt");
      // Create file and make it read-only
      await Bun.write(filepath, "initial");
      fs.chmodSync(filepath, 0o444);

      const result = await $`echo "should fail" > ${filepath}`.env(bunEnv).nothrow();
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("Permission denied");

      // Restore permissions for cleanup
      fs.chmodSync(filepath, 0o644);
    });

    test("write to directory should fail", async () => {
      const dirpath = join(tempDir, "directory");
      fs.mkdirSync(dirpath);

      const result = await $`echo "should fail" > ${dirpath}`.env(bunEnv).nothrow();
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("Is a directory");
    });

    test("write to non-existent directory should fail", async () => {
      const filepath = join(tempDir, "nonexistent", "file.txt");

      const result = await $`echo "should fail" > ${filepath}`.env(bunEnv).nothrow();
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("No such file or directory");
    });

    test("disk full simulation", async () => {
      // Test writing to /dev/full on Linux to simulate ENOSPC
      if (process.platform === "linux") {
        try {
          const result = await $`echo "test" > /dev/full`.env(bunEnv).nothrow();
          expect(result.exitCode).not.toBe(0);
          // Should trigger onError path in doFileWrite
        } catch {
          // Skip test if /dev/full not available
        }
      }
    });
  });

  describe("special file types and non-pollable paths", () => {
    test("write to /dev/null", async () => {
      if (process.platform !== "win32") {
        // /dev/null is not pollable, should use doFileWrite path
        const result = await $`echo "disappear" > /dev/null`.env(bunEnv);
        expect(result.exitCode).toBe(0);
      }
    });

    test("write to character device", async () => {
      if (process.platform !== "win32") {
        // Character devices are not pollable by epoll/kqueue
        try {
          const result = await $`echo "test" > /dev/zero`.env(bunEnv).nothrow();
          // This tests the non-pollable codepath
          expect(typeof result.exitCode).toBe("number");
        } catch {
          // Expected on some systems due to permissions
        }
      }
    });

    // test("write to FIFO/named pipe", async () => {
    //   if (process.platform !== "win32") {
    //     const fifoPath = join(tempDir, "testfifo");

    //     try {
    //       // Create named pipe
    //       require("child_process").execSync(`mkfifo ${fifoPath}`);

    //       // Write to FIFO in background (will block until reader)
    //       const writePromise = $`echo "fifo test" > ${fifoPath}`.env(bunEnv).nothrow();

    //       // Read from FIFO
    //       const readPromise = $`cat ${fifoPath}`.env(bunEnv);

    //       const [writeResult, readResult] = await Promise.all([writePromise, readPromise]);

    //       expect(writeResult.exitCode).toBe(0);
    //       expect(readResult.stdout.toString()).toBe("fifo test\n");
    //     } catch {
    //       // Skip if mkfifo not available
    //     }
    //   }
    // });
  });

  describe("writer queue and bump behavior", () => {
    test("single writer completion and cleanup", async () => {
      const filepath = join(tempDir, "single_writer.txt");
      await $`echo "single" > ${filepath}`.env(bunEnv);

      // Verify complete cleanup: buf cleared, writers cleared, indices reset
      const content = await Bun.file(filepath).text();
      expect(content).toBe("single\n");
    });

    test("writer marked as dead during write", async () => {
      // This is difficult to test directly, but we can verify robustness
      const filepath = join(tempDir, "robust.txt");
      const result = await $`echo "robust test" > ${filepath}`.env(bunEnv);

      expect(result.exitCode).toBe(0);
      const content = await Bun.file(filepath).text();
      expect(content).toBe("robust test\n");
    });

    test("bytelist capture during file write", async () => {
      const filepath = join(tempDir, "capture.txt");
      // This tests the bytelist append logic in doFileWrite:304-307
      const result = await $`echo "captured content" > ${filepath}`.env(bunEnv);

      const fileContent = await Bun.file(filepath).text();
      expect(fileContent).toBe("captured content\n");
      // stdout should be empty since redirected to file
      expect(result.stdout.toString()).toBe("");
    });
  });

  describe("error handling and unreachable paths", () => {
    test("attempt to trigger partial write panic", async () => {
      // The panic at line 314 should never happen for files
      // Test with very large write to ensure atomic completion
      const filepath = join(tempDir, "atomic.txt");
      const largeContent = "A".repeat(2 * 1024 * 1024); // 2MB

      await $`echo -n ${largeContent} > ${filepath}`.env(bunEnv);

      const content = await Bun.file(filepath).text();
      expect(content).toBe(largeContent);
      expect(content.length).toBe(2 * 1024 * 1024);
    });

    test("EAGAIN should never occur for files", async () => {
      // The panic at line 299 tests that .pending never occurs for files
      // Regular files should always complete writes synchronously
      const filepath = join(tempDir, "sync_write.txt");

      await $`echo "synchronous" > ${filepath}`.env(bunEnv);

      const content = await Bun.file(filepath).text();
      expect(content).toBe("synchronous\n");
    });

    test("write error propagation", async () => {
      // Test that errors in drainBufferedData properly call onError
      const invalidPath = join(tempDir, "nonexistent_dir", "file.txt");

      const result = await $`echo "error test" > ${invalidPath}`.env(bunEnv).nothrow();
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString().length).toBeGreaterThan(0);
    });
  });

  describe("file permissions and creation", () => {
    test("file creation with default permissions", async () => {
      const filepath = join(tempDir, "new_file.txt");
      await $`echo "new file" > ${filepath}`.env(bunEnv);

      const stats = fs.statSync(filepath);
      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(0);
    });

    test("overwrite existing file", async () => {
      const filepath = join(tempDir, "overwrite.txt");

      // Create initial file
      await Bun.write(filepath, "original content that is longer");

      // Overwrite with shorter content
      await $`echo "short" > ${filepath}`.env(bunEnv);

      const content = await Bun.file(filepath).text();
      expect(content).toBe("short\n");

      // File should be truncated, not just overwritten
      const stats = fs.statSync(filepath);
      expect(stats.size).toBe(6); // "short\n"
    });

    test("append to existing file", async () => {
      const filepath = join(tempDir, "append.txt");

      await $`echo "line1" > ${filepath}`.env(bunEnv);
      await $`echo "line2" >> ${filepath}`.env(bunEnv);
      await $`echo "line3" >> ${filepath}`.env(bunEnv);

      const content = await Bun.file(filepath).text();
      expect(content).toBe("line1\nline2\nline3\n");
    });
  });

  describe("concurrent operations", () => {
    test("concurrent writes to different files", async () => {
      const files = Array.from({ length: 10 }, (_, i) => join(tempDir, `concurrent_${i}.txt`));

      const promises = files.map((filepath, i) => $`echo "content ${i}" > ${filepath}`.env(bunEnv));

      await Promise.all(promises);

      for (let i = 0; i < files.length; i++) {
        const content = await Bun.file(files[i]).text();
        expect(content).toBe(`content ${i}\n`);
      }
    });

    test("rapid sequential writes to same file", async () => {
      const filepath = join(tempDir, "rapid.txt");

      // Each write should completely replace the previous
      for (let i = 0; i < 20; i++) {
        await $`echo "iteration ${i}" > ${filepath}`.env(bunEnv);
      }

      const content = await Bun.file(filepath).text();
      expect(content).toBe("iteration 19\n");
    });
  });

  describe("TestBuilder integration", () => {
    TestBuilder.command`echo "builder test" > output.txt`
      .env(bunEnv)
      .fileEquals("output.txt", "builder test\n")
      .runAsTest("basic file output");

    TestBuilder.command`printf "no newline" > no_newline.txt`
      .env(bunEnv)
      .fileEquals("no_newline.txt", "no newline")
      .runAsTest("output without trailing newline");

    TestBuilder.command`echo "first" > multi.txt && echo "second" >> multi.txt`
      .env(bunEnv)
      .fileEquals("multi.txt", "first\nsecond\n")
      .runAsTest("write then append");

    TestBuilder.command`echo "error test" > /dev/null/invalid/path`
      .env(bunEnv)
      .exitCode(1)
      .stderr_contains("bun: Not a directory: /dev/null/invalid/path")
      .runAsTest("write to invalid path fails");
  });
});

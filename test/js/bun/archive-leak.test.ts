import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";

const ITERATIONS = 100_000;
const TIMEOUT = 120_000; // 2 minutes per test

describe("Bun.Archive memory leaks", () => {
  test(
    ".bytes() doesn't leak",
    async () => {
      const files = {
        "file1.txt": "Hello, World!",
        "file2.txt": "Some content here",
        "file3.txt": Buffer.alloc(1024, "x").toString(),
      };

      // Warmup
      for (let i = 0; i < 100; i++) {
        await Bun.Archive.from(files).bytes();
      }

      Bun.gc(true);
      const before = process.memoryUsage.rss();

      for (let i = 0; i < ITERATIONS; i++) {
        await Bun.Archive.from(files).bytes();
      }

      Bun.gc(true);
      const after = process.memoryUsage.rss();

      for (let i = 0; i < ITERATIONS; i++) {
        await Bun.Archive.from(files).bytes();
      }

      Bun.gc(true);
      const after2 = process.memoryUsage.rss();

      console.log("bytes() - RSS before:", (before / 1024 / 1024) | 0, "MB");
      console.log("bytes() - RSS after:", (after / 1024 / 1024) | 0, "MB");
      console.log("bytes() - RSS after2:", (after2 / 1024 / 1024) | 0, "MB");
      console.log("bytes() - RSS delta:", ((after - before) / 1024 / 1024) | 0, "MB");

      expect(after).toBeLessThan(before * 2);
      expect(after2).toBeLessThan(after * 1.5);
    },
    TIMEOUT,
  );

  test(
    ".bytes('gzip') doesn't leak",
    async () => {
      const files = {
        "file1.txt": "Hello, World!",
        "file2.txt": "Some content here",
        "file3.txt": Buffer.alloc(1024, "x").toString(),
      };

      // Warmup
      for (let i = 0; i < 100; i++) {
        await Bun.Archive.from(files).bytes("gzip");
      }

      Bun.gc(true);
      const before = process.memoryUsage.rss();

      for (let i = 0; i < ITERATIONS; i++) {
        await Bun.Archive.from(files).bytes("gzip");
      }

      Bun.gc(true);
      const after = process.memoryUsage.rss();

      for (let i = 0; i < ITERATIONS; i++) {
        await Bun.Archive.from(files).bytes("gzip");
      }

      Bun.gc(true);
      const after2 = process.memoryUsage.rss();

      console.log("bytes('gzip') - RSS before:", (before / 1024 / 1024) | 0, "MB");
      console.log("bytes('gzip') - RSS after:", (after / 1024 / 1024) | 0, "MB");
      console.log("bytes('gzip') - RSS after2:", (after2 / 1024 / 1024) | 0, "MB");
      console.log("bytes('gzip') - RSS delta:", ((after - before) / 1024 / 1024) | 0, "MB");

      expect(after).toBeLessThan(before * 2);
      expect(after2).toBeLessThan(after * 1.5);
    },
    TIMEOUT,
  );

  test(
    ".blob() doesn't leak",
    async () => {
      const files = {
        "file1.txt": "Hello, World!",
        "file2.txt": "Some content here",
        "file3.txt": Buffer.alloc(1024, "x").toString(),
      };

      // Warmup
      for (let i = 0; i < 100; i++) {
        await Bun.Archive.from(files).blob();
      }

      Bun.gc(true);
      const before = process.memoryUsage.rss();

      for (let i = 0; i < ITERATIONS; i++) {
        await Bun.Archive.from(files).blob();
      }

      Bun.gc(true);
      const after = process.memoryUsage.rss();

      for (let i = 0; i < ITERATIONS; i++) {
        await Bun.Archive.from(files).blob();
      }

      Bun.gc(true);
      const after2 = process.memoryUsage.rss();

      console.log("blob() - RSS before:", (before / 1024 / 1024) | 0, "MB");
      console.log("blob() - RSS after:", (after / 1024 / 1024) | 0, "MB");
      console.log("blob() - RSS after2:", (after2 / 1024 / 1024) | 0, "MB");
      console.log("blob() - RSS delta:", ((after - before) / 1024 / 1024) | 0, "MB");

      expect(after).toBeLessThan(before * 2);
      expect(after2).toBeLessThan(after * 1.5);
    },
    TIMEOUT,
  );

  test(
    ".extract() doesn't leak",
    async () => {
      const files = {
        "file1.txt": "Hello, World!",
        "file2.txt": "Some content here",
        "file3.txt": Buffer.alloc(1024, "x").toString(),
      };

      using dir = tempDir("archive-leak-extract", {});

      // Warmup
      for (let i = 0; i < 100; i++) {
        await Bun.Archive.from(files).extract(String(dir));
      }

      Bun.gc(true);
      const before = process.memoryUsage.rss();

      for (let i = 0; i < ITERATIONS; i++) {
        await Bun.Archive.from(files).extract(String(dir));
      }

      Bun.gc(true);
      const after = process.memoryUsage.rss();

      for (let i = 0; i < ITERATIONS; i++) {
        await Bun.Archive.from(files).extract(String(dir));
      }

      Bun.gc(true);
      const after2 = process.memoryUsage.rss();

      console.log("extract() - RSS before:", (before / 1024 / 1024) | 0, "MB");
      console.log("extract() - RSS after:", (after / 1024 / 1024) | 0, "MB");
      console.log("extract() - RSS after2:", (after2 / 1024 / 1024) | 0, "MB");
      console.log("extract() - RSS delta:", ((after - before) / 1024 / 1024) | 0, "MB");

      expect(after).toBeLessThan(before * 2);
      expect(after2).toBeLessThan(after * 1.5);
    },
    TIMEOUT,
  );

  test(
    ".extract() from gzipped archive doesn't leak",
    async () => {
      const files = {
        "file1.txt": "Hello, World!",
        "file2.txt": "Some content here",
        "file3.txt": Buffer.alloc(1024, "x").toString(),
      };

      using dir = tempDir("archive-leak-extract-gz", {});

      // Pre-create gzipped archive
      const gzippedBytes = await Bun.Archive.from(files).bytes("gzip");

      // Warmup
      for (let i = 0; i < 100; i++) {
        await Bun.Archive.from(gzippedBytes).extract(String(dir));
      }

      Bun.gc(true);
      const before = process.memoryUsage.rss();

      for (let i = 0; i < ITERATIONS; i++) {
        await Bun.Archive.from(gzippedBytes).extract(String(dir));
      }

      Bun.gc(true);
      const after = process.memoryUsage.rss();

      for (let i = 0; i < ITERATIONS; i++) {
        await Bun.Archive.from(gzippedBytes).extract(String(dir));
      }

      Bun.gc(true);
      const after2 = process.memoryUsage.rss();

      console.log("extract(gzip) - RSS before:", (before / 1024 / 1024) | 0, "MB");
      console.log("extract(gzip) - RSS after:", (after / 1024 / 1024) | 0, "MB");
      console.log("extract(gzip) - RSS after2:", (after2 / 1024 / 1024) | 0, "MB");
      console.log("extract(gzip) - RSS delta:", ((after - before) / 1024 / 1024) | 0, "MB");

      expect(after).toBeLessThan(before * 2);
      expect(after2).toBeLessThan(after * 1.5);
    },
    TIMEOUT,
  );
});

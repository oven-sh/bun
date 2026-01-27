import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

describe("Bun.Archive", () => {
  describe("new Archive()", () => {
    test("creates archive from object with string values", async () => {
      const archive = new Bun.Archive({
        "hello.txt": "Hello, World!",
        "data.json": JSON.stringify({ foo: "bar" }),
      });

      expect(archive).toBeInstanceOf(Bun.Archive);
    });

    test("creates archive from object with Blob values", async () => {
      const archive = new Bun.Archive({
        "blob1.txt": new Blob(["Hello from Blob"]),
        "blob2.txt": new Blob(["Another Blob"]),
      });

      expect(archive).toBeInstanceOf(Bun.Archive);
    });

    test("creates archive from object with Uint8Array values", async () => {
      const encoder = new TextEncoder();
      const archive = new Bun.Archive({
        "bytes1.txt": encoder.encode("Hello from Uint8Array"),
        "bytes2.txt": encoder.encode("Another Uint8Array"),
      });

      expect(archive).toBeInstanceOf(Bun.Archive);
    });

    test("creates archive from object with ArrayBuffer values", async () => {
      const encoder = new TextEncoder();
      const archive = new Bun.Archive({
        "buffer1.txt": encoder.encode("Hello from ArrayBuffer").buffer,
        "buffer2.txt": encoder.encode("Another ArrayBuffer").buffer,
      });

      expect(archive).toBeInstanceOf(Bun.Archive);
    });

    test("creates archive from object with mixed value types", async () => {
      const encoder = new TextEncoder();
      const archive = new Bun.Archive({
        "string.txt": "String content",
        "blob.txt": new Blob(["Blob content"]),
        "uint8.txt": encoder.encode("Uint8Array content"),
        "buffer.txt": encoder.encode("ArrayBuffer content").buffer,
      });

      expect(archive).toBeInstanceOf(Bun.Archive);
    });

    test("creates archive from Blob", async () => {
      // First create an archive with some content
      const sourceArchive = new Bun.Archive({
        "test.txt": "test content",
      });

      const blob = await sourceArchive.blob();
      expect(blob).toBeInstanceOf(Blob);

      // Create new archive from the blob
      const archive = new Bun.Archive(blob);
      expect(archive).toBeInstanceOf(Bun.Archive);
    });

    test("creates archive from ArrayBuffer", async () => {
      const sourceArchive = new Bun.Archive({
        "test.txt": "test content",
      });

      const bytes = await sourceArchive.bytes();
      const buffer = bytes.buffer;

      const archive = new Bun.Archive(buffer);
      expect(archive).toBeInstanceOf(Bun.Archive);
    });

    test("creates archive from Uint8Array", async () => {
      const sourceArchive = new Bun.Archive({
        "test.txt": "test content",
      });

      const bytes = await sourceArchive.bytes();

      const archive = new Bun.Archive(bytes);
      expect(archive).toBeInstanceOf(Bun.Archive);
    });

    test("creates archive with nested directory structure", async () => {
      const archive = new Bun.Archive({
        "root.txt": "Root file",
        "dir1/file1.txt": "File in dir1",
        "dir1/dir2/file2.txt": "File in dir1/dir2",
        "dir1/dir2/dir3/file3.txt": "File in dir1/dir2/dir3",
      });

      expect(archive).toBeInstanceOf(Bun.Archive);
    });

    test("creates archive with empty string value", async () => {
      const archive = new Bun.Archive({
        "empty.txt": "",
      });

      expect(archive).toBeInstanceOf(Bun.Archive);
    });

    test("throws with no arguments", () => {
      expect(() => {
        // @ts-expect-error - testing runtime behavior
        new Bun.Archive();
      }).toThrow();
    });

    test("throws with invalid input type (number)", () => {
      expect(() => {
        // @ts-expect-error - testing runtime behavior
        new Bun.Archive(123);
      }).toThrow();
    });

    test("throws with invalid input type (null)", () => {
      expect(() => {
        // @ts-expect-error - testing runtime behavior
        new Bun.Archive(null);
      }).toThrow();
    });

    test("converts non-string/buffer values to strings", async () => {
      // @ts-expect-error - testing runtime behavior
      const archive = new Bun.Archive({ "file.txt": 123 }, {});
      // The archive should be created successfully - number is converted to string
      expect(archive).toBeDefined();
      const bytes = await archive.bytes();
      // Should contain "123" somewhere in the tarball (use {} to get uncompressed tar)
      expect(new TextDecoder().decode(bytes)).toContain("123");
    });
  });

  describe("archive.blob()", () => {
    test("returns a Blob", async () => {
      const archive = new Bun.Archive({
        "hello.txt": "Hello, World!",
      });

      const blob = await archive.blob();
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.size).toBeGreaterThan(0);
    });

    test("returns consistent output for same input", async () => {
      const archive = new Bun.Archive({
        "hello.txt": "Hello, World!",
      });

      const blob1 = await archive.blob();
      const blob2 = await archive.blob();
      expect(blob1.size).toBe(blob2.size);
    });

    test("with gzip option returns gzipped blob", async () => {
      const regularArchive = new Bun.Archive(
        {
          "hello.txt": "Hello, World!",
        },
        {}, // Empty options = no compression
      );
      const gzipArchive = new Bun.Archive(
        {
          "hello.txt": "Hello, World!",
        },
        { compress: "gzip" },
      );

      const regularBlob = await regularArchive.blob();
      const gzippedBlob = await gzipArchive.blob();

      expect(gzippedBlob).toBeInstanceOf(Blob);
      // Gzipped should be different size
      expect(gzippedBlob.size).not.toBe(regularBlob.size);
    });

    test("gzip is smaller for larger repetitive data", async () => {
      const largeContent = Buffer.alloc(13000, "Hello, World!");
      const regularArchive = new Bun.Archive(
        {
          "large.txt": largeContent,
        },
        {}, // Empty options = no compression
      );
      const gzipArchive = new Bun.Archive(
        {
          "large.txt": largeContent,
        },
        { compress: "gzip" },
      );

      const regularBlob = await regularArchive.blob();
      const gzippedBlob = await gzipArchive.blob();

      // For large repetitive data, gzip should be smaller
      expect(gzippedBlob.size).toBeLessThan(regularBlob.size);
    });

    test("gzip level affects compression ratio", async () => {
      const largeContent = Buffer.alloc(50000, "Hello, World!");
      const level1Archive = new Bun.Archive({ "large.txt": largeContent }, { compress: "gzip", level: 1 });
      const level12Archive = new Bun.Archive({ "large.txt": largeContent }, { compress: "gzip", level: 12 });

      const level1Blob = await level1Archive.blob();
      const level12Blob = await level12Archive.blob();

      // Level 12 should produce smaller output than level 1
      expect(level12Blob.size).toBeLessThan(level1Blob.size);
    });

    test("defaults to no compression when no options provided", async () => {
      const largeContent = Buffer.alloc(13000, "Hello, World!");

      // No options = no compression
      const defaultArchive = new Bun.Archive({
        "large.txt": largeContent,
      });

      // Explicit empty options = also no compression
      const emptyOptionsArchive = new Bun.Archive({ "large.txt": largeContent }, {});

      // Explicit gzip compression
      const compressedArchive = new Bun.Archive({ "large.txt": largeContent }, { compress: "gzip" });

      const defaultBlob = await defaultArchive.blob();
      const emptyOptionsBlob = await emptyOptionsArchive.blob();
      const compressedBlob = await compressedArchive.blob();

      // Default should match empty options (both uncompressed)
      expect(defaultBlob.size).toBe(emptyOptionsBlob.size);

      // Compressed should be smaller than uncompressed
      expect(compressedBlob.size).toBeLessThan(defaultBlob.size);
    });

    test("throws with invalid gzip level", () => {
      expect(() => {
        new Bun.Archive({ "hello.txt": "Hello, World!" }, { compress: "gzip", level: 0 });
      }).toThrow();

      expect(() => {
        new Bun.Archive({ "hello.txt": "Hello, World!" }, { compress: "gzip", level: 13 });
      }).toThrow();
    });
  });

  describe("archive.bytes()", () => {
    test("returns a Uint8Array", async () => {
      const archive = new Bun.Archive({
        "hello.txt": "Hello, World!",
      });

      const bytes = await archive.bytes();
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBeGreaterThan(0);
    });

    test("returns consistent output for same input", async () => {
      const archive = new Bun.Archive({
        "hello.txt": "Hello, World!",
      });

      const bytes1 = await archive.bytes();
      const bytes2 = await archive.bytes();
      expect(bytes1.length).toBe(bytes2.length);
    });

    test("with gzip option returns gzipped bytes", async () => {
      const regularArchive = new Bun.Archive(
        {
          "hello.txt": "Hello, World!",
        },
        {}, // Empty options = no compression
      );
      const gzipArchive = new Bun.Archive(
        {
          "hello.txt": "Hello, World!",
        },
        { compress: "gzip" },
      );

      const regularBytes = await regularArchive.bytes();
      const gzippedBytes = await gzipArchive.bytes();

      expect(gzippedBytes).toBeInstanceOf(Uint8Array);
      // Gzipped should be different size
      expect(gzippedBytes.length).not.toBe(regularBytes.length);
    });

    test("gzip is smaller for larger repetitive data", async () => {
      const largeContent = Buffer.alloc(13000, "Hello, World!");
      const regularArchive = new Bun.Archive(
        {
          "large.txt": largeContent,
        },
        {}, // Empty options = no compression
      );
      const gzipArchive = new Bun.Archive(
        {
          "large.txt": largeContent,
        },
        { compress: "gzip" },
      );

      const regularBytes = await regularArchive.bytes();
      const gzippedBytes = await gzipArchive.bytes();

      // For large repetitive data, gzip should be smaller
      expect(gzippedBytes.length).toBeLessThan(regularBytes.length);
    });

    test("bytes match blob content", async () => {
      const archive = new Bun.Archive({
        "hello.txt": "Hello, World!",
      });

      const bytes = await archive.bytes();
      const blob = await archive.blob();
      const blobBytes = new Uint8Array(await blob.arrayBuffer());

      expect(bytes.length).toBe(blobBytes.length);
      for (let i = 0; i < bytes.length; i++) {
        expect(bytes[i]).toBe(blobBytes[i]);
      }
    });
  });

  describe("archive.extract()", () => {
    test("extracts to directory and returns file count", async () => {
      using dir = tempDir("archive-extract-test", {});

      const archive = new Bun.Archive({
        "hello.txt": "Hello, World!",
        "subdir/nested.txt": "Nested content",
      });

      const count = await archive.extract(String(dir));
      expect(count).toBeGreaterThan(0);

      // Verify files were extracted
      const helloContent = await Bun.file(join(String(dir), "hello.txt")).text();
      expect(helloContent).toBe("Hello, World!");
    });

    test("extracts nested directory structure", async () => {
      using dir = tempDir("archive-extract-nested", {});

      const archive = new Bun.Archive({
        "root.txt": "Root file",
        "dir1/file1.txt": "File in dir1",
        "dir1/dir2/file2.txt": "File in dir1/dir2",
        "dir1/dir2/dir3/file3.txt": "File in dir1/dir2/dir3",
      });

      const count = await archive.extract(String(dir));
      expect(count).toBeGreaterThan(0);

      // Verify all files were extracted
      expect(await Bun.file(join(String(dir), "root.txt")).text()).toBe("Root file");
      expect(await Bun.file(join(String(dir), "dir1/file1.txt")).text()).toBe("File in dir1");
      expect(await Bun.file(join(String(dir), "dir1/dir2/file2.txt")).text()).toBe("File in dir1/dir2");
      expect(await Bun.file(join(String(dir), "dir1/dir2/dir3/file3.txt")).text()).toBe("File in dir1/dir2/dir3");
    });

    test("extracts binary data correctly", async () => {
      using dir = tempDir("archive-extract-binary", {});

      const binaryData = new Uint8Array([0, 1, 2, 255, 254, 253, 128, 127]);
      const archive = new Bun.Archive({
        "binary.bin": binaryData,
      });

      await archive.extract(String(dir));

      const extractedBytes = new Uint8Array(await Bun.file(join(String(dir), "binary.bin")).arrayBuffer());
      expect(extractedBytes.length).toBe(binaryData.length);
      for (let i = 0; i < binaryData.length; i++) {
        expect(extractedBytes[i]).toBe(binaryData[i]);
      }
    });

    test("extracts from archive created from blob", async () => {
      using dir = tempDir("archive-extract-from-blob", {});

      // Create original archive
      const sourceArchive = new Bun.Archive({
        "test.txt": "test content",
      });

      // Get as blob and create new archive
      const blob = await sourceArchive.blob();
      const archive = new Bun.Archive(blob);

      const count = await archive.extract(String(dir));
      expect(count).toBeGreaterThan(0);

      const content = await Bun.file(join(String(dir), "test.txt")).text();
      expect(content).toBe("test content");
    });

    test("extracts from archive created from bytes", async () => {
      using dir = tempDir("archive-extract-from-bytes", {});

      // Create original archive
      const sourceArchive = new Bun.Archive({
        "test.txt": "test content",
      });

      // Get as bytes and create new archive
      const bytes = await sourceArchive.bytes();
      const archive = new Bun.Archive(bytes);

      const count = await archive.extract(String(dir));
      expect(count).toBeGreaterThan(0);

      const content = await Bun.file(join(String(dir), "test.txt")).text();
      expect(content).toBe("test content");
    });

    test("throws with missing path argument", async () => {
      const archive = new Bun.Archive({
        "hello.txt": "Hello, World!",
      });

      await expect(async () => {
        // @ts-expect-error - testing runtime behavior
        await archive.extract();
      }).toThrow();
    });

    test("throws with non-string path argument", async () => {
      const archive = new Bun.Archive({
        "hello.txt": "Hello, World!",
      });

      await expect(async () => {
        // @ts-expect-error - testing runtime behavior
        await archive.extract(123);
      }).toThrow();
    });

    test("creates directory if it doesn't exist", async () => {
      using dir = tempDir("archive-extract-create-dir", {});
      const newDir = join(String(dir), "new-subdir", "nested");

      const archive = new Bun.Archive({
        "hello.txt": "Hello, World!",
      });

      // Should create the directory and extract successfully
      const count = await archive.extract(newDir);
      expect(count).toBeGreaterThan(0);

      const content = await Bun.file(join(newDir, "hello.txt")).text();
      expect(content).toBe("Hello, World!");
    });

    test("throws when extracting to a file path instead of directory", async () => {
      using dir = tempDir("archive-extract-to-file", {
        "existing-file.txt": "I am a file",
      });

      const archive = new Bun.Archive({
        "hello.txt": "Hello, World!",
      });

      // Try to extract to a file path instead of directory
      await expect(async () => {
        await archive.extract(join(String(dir), "existing-file.txt"));
      }).toThrow();
    });
  });

  describe("corrupted archives", () => {
    test("throws when extracting corrupted archive data", async () => {
      // Create garbage data that's not a valid archive
      const corruptedData = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const archive = new Bun.Archive(corruptedData);

      using dir = tempDir("archive-corrupted", {});

      await expect(async () => {
        await archive.extract(String(dir));
      }).toThrow();
    });

    test("throws when extracting truncated archive", async () => {
      // Create a valid archive then truncate it
      const validArchive = new Bun.Archive({
        "file.txt": "Hello, World!",
      });
      const bytes = await validArchive.bytes();

      // Truncate to only first 10 bytes - definitely incomplete
      const truncated = bytes.slice(0, 10);
      const archive = new Bun.Archive(truncated);

      using dir = tempDir("archive-truncated", {});

      await expect(async () => {
        await archive.extract(String(dir));
      }).toThrow();
    });

    test("throws when extracting random bytes as archive", async () => {
      // Generate random bytes
      const randomBytes = new Uint8Array(1024);
      for (let i = 0; i < randomBytes.length; i++) {
        randomBytes[i] = Math.floor(Math.random() * 256);
      }

      const archive = new Bun.Archive(randomBytes);

      using dir = tempDir("archive-random", {});

      await expect(async () => {
        await archive.extract(String(dir));
      }).toThrow();
    });

    test("handles empty archive gracefully", async () => {
      // Empty data
      const emptyData = new Uint8Array(0);
      const archive = new Bun.Archive(emptyData);

      using dir = tempDir("archive-empty", {});

      // Should either throw or return 0 files extracted
      try {
        const count = await archive.extract(String(dir));
        expect(count).toBe(0);
      } catch {
        // Throwing is also acceptable for empty/invalid data
      }
    });
  });

  describe("path safety", () => {
    test("normalizes paths with redundant separators", async () => {
      const archive = new Bun.Archive({
        "dir//subdir///file.txt": "content",
      });

      using dir = tempDir("archive-path-normalize", {});
      await archive.extract(String(dir));

      // The file should be extracted with normalized path
      const content = await Bun.file(join(String(dir), "dir/subdir/file.txt")).text();
      expect(content).toBe("content");
    });

    test("handles paths with dots correctly", async () => {
      const archive = new Bun.Archive({
        "dir/./file.txt": "content1",
        "dir/subdir/../file2.txt": "content2",
      });

      using dir = tempDir("archive-path-dots", {});
      await archive.extract(String(dir));

      // Paths should be normalized
      expect(await Bun.file(join(String(dir), "dir/file.txt")).text()).toBe("content1");
      expect(await Bun.file(join(String(dir), "dir/file2.txt")).text()).toBe("content2");
    });

    test("handles very long filenames", async () => {
      // Create a filename that's quite long but within reasonable limits
      const longName = "a".repeat(200) + ".txt";
      const archive = new Bun.Archive({
        [longName]: "content",
      });

      using dir = tempDir("archive-long-name", {});

      // Should either work or throw, but not crash
      try {
        await archive.extract(String(dir));
        const content = await Bun.file(join(String(dir), longName)).text();
        expect(content).toBe("content");
      } catch {
        // Some filesystems don't support very long names - that's ok
      }
    });

    test("handles deeply nested paths", async () => {
      // Create a deeply nested path
      const deepPath = Array(50).fill("dir").join("/") + "/file.txt";
      const archive = new Bun.Archive({
        [deepPath]: "deep content",
      });

      using dir = tempDir("archive-deep-path", {});

      // Should either work or throw, but not crash
      try {
        await archive.extract(String(dir));
        const content = await Bun.file(join(String(dir), deepPath)).text();
        expect(content).toBe("deep content");
      } catch {
        // Very deep paths might fail on some systems - that's acceptable
      }
    });
  });

  describe("Archive.write()", () => {
    test("writes archive to file", async () => {
      using dir = tempDir("archive-write-test", {});
      const archivePath = join(String(dir), "test.tar");

      await Bun.Archive.write(archivePath, {
        "hello.txt": "Hello, World!",
        "data.json": JSON.stringify({ foo: "bar" }),
      });

      // Verify file exists
      const file = Bun.file(archivePath);
      expect(await file.exists()).toBe(true);
      expect(file.size).toBeGreaterThan(0);
    });

    test("writes gzipped archive to file", async () => {
      using dir = tempDir("archive-write-gzip-test", {});
      const archivePath = join(String(dir), "test.tar.gz");
      const largeContent = Buffer.alloc(1300, "Hello, World!");

      await Bun.Archive.write(
        archivePath,
        new Bun.Archive(
          {
            "hello.txt": largeContent,
          },
          { compress: "gzip" },
        ),
      );

      // Verify file exists and is smaller than uncompressed
      const file = Bun.file(archivePath);
      expect(await file.exists()).toBe(true);

      // Compare with uncompressed (no options = no compression)
      const uncompressedPath = join(String(dir), "test.tar");
      await Bun.Archive.write(
        uncompressedPath,
        new Bun.Archive(
          {
            "hello.txt": largeContent,
          },
          {}, // Empty options = no compression
        ),
      );

      expect(file.size).toBeLessThan(Bun.file(uncompressedPath).size);
    });

    test("writes archive from Blob", async () => {
      using dir = tempDir("archive-write-blob-test", {});
      const archivePath = join(String(dir), "test.tar");

      // Create archive and get blob
      const sourceArchive = new Bun.Archive({
        "test.txt": "test content",
      });
      const blob = await sourceArchive.blob();

      // Write blob to file
      await Bun.Archive.write(archivePath, blob);

      // Verify file exists
      const file = Bun.file(archivePath);
      expect(await file.exists()).toBe(true);
    });

    test("written archive can be extracted", async () => {
      using dir = tempDir("archive-write-extract-test", {});
      const archivePath = join(String(dir), "test.tar");
      const extractDir = join(String(dir), "extracted");

      // Write archive
      await Bun.Archive.write(archivePath, {
        "hello.txt": "Hello from write!",
        "subdir/nested.txt": "Nested content from write",
      });

      // Extract it
      const blob = await Bun.file(archivePath).bytes();
      const archive = new Bun.Archive(blob);
      require("fs").mkdirSync(extractDir, { recursive: true });
      const count = await archive.extract(extractDir);
      expect(count).toBeGreaterThan(0);

      // Verify contents
      expect(await Bun.file(join(extractDir, "hello.txt")).text()).toBe("Hello from write!");
      expect(await Bun.file(join(extractDir, "subdir/nested.txt")).text()).toBe("Nested content from write");
    });

    test("throws with missing arguments", async () => {
      await expect(async () => {
        // @ts-expect-error - testing runtime behavior
        await Bun.Archive.write();
      }).toThrow();
    });

    test("throws with only path argument", async () => {
      await expect(async () => {
        // @ts-expect-error - testing runtime behavior
        await Bun.Archive.write("/tmp/test.tar");
      }).toThrow();
    });

    test("throws with invalid gzip option", async () => {
      using dir = tempDir("archive-write-invalid-gzip", {});
      const archivePath = join(String(dir), "test.tar");

      await expect(async () => {
        await Bun.Archive.write(
          archivePath,
          new Bun.Archive({ "file.txt": "content" }, { compress: "gzip", level: 0 }),
        );
      }).toThrow();

      await expect(async () => {
        await Bun.Archive.write(
          archivePath,
          new Bun.Archive({ "file.txt": "content" }, { compress: "gzip", level: 13 }),
        );
      }).toThrow();
    });
  });

  describe("GC safety", () => {
    test("archive remains valid after GC", async () => {
      const archive = new Bun.Archive({
        "hello.txt": "Hello, World!",
      });

      // Force GC
      Bun.gc(true);

      // Archive should still work
      const blob = await archive.blob();
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.size).toBeGreaterThan(0);
    });

    test("archive with many entries survives GC", async () => {
      const entries: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        entries[`file${i}.txt`] = `Content for file ${i}`;
      }

      const archive = new Bun.Archive(entries);

      // Force GC multiple times
      Bun.gc(true);
      Bun.gc(true);
      Bun.gc(true);

      // Archive should still work
      const bytes = await archive.bytes();
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBeGreaterThan(0);
    });

    test("original data mutation doesn't affect archive", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const archive = new Bun.Archive({
        "data.bin": data,
      });

      // Mutate original data
      data[0] = 255;
      data[1] = 255;

      // Force GC
      Bun.gc(true);

      // Extract and verify original data is preserved
      using dir = tempDir("archive-gc-mutation", {});
      await archive.extract(String(dir));

      const extractedBytes = new Uint8Array(await Bun.file(join(String(dir), "data.bin")).arrayBuffer());
      expect(extractedBytes[0]).toBe(1); // Original value, not mutated
      expect(extractedBytes[1]).toBe(2); // Original value, not mutated
    });

    test("blob source mutation doesn't affect archive", async () => {
      const original = new Uint8Array([1, 2, 3, 4, 5]);
      const blob = new Blob([original]);
      const sourceArchive = new Bun.Archive({
        "data.bin": blob,
      });

      const archiveBlob = await sourceArchive.blob();
      const archive = new Bun.Archive(archiveBlob);

      // Force GC
      Bun.gc(true);

      // Mutate original
      original[0] = 255;

      // Extract and verify
      using dir = tempDir("archive-gc-blob-mutation", {});
      await archive.extract(String(dir));

      const extractedBytes = new Uint8Array(await Bun.file(join(String(dir), "data.bin")).arrayBuffer());
      expect(extractedBytes[0]).toBe(1); // Original value
    });

    test("async operations work even if archive is not referenced", async () => {
      // This tests that tasks copy data instead of holding Archive reference
      // If the implementation held a reference to Archive, GC could finalize it
      // and cause use-after-free

      using dir = tempDir("archive-gc-no-ref", {});

      // Create promise without keeping archive reference
      const promise = new Bun.Archive({
        "test.txt": "Hello from GC test!",
      }).extract(String(dir));

      // Force aggressive GC - the archive object is now unreferenced
      Bun.gc(true);
      Bun.gc(true);

      // The promise should still resolve correctly
      const count = await promise;
      expect(count).toBeGreaterThan(0);

      // Verify the file was extracted correctly
      const content = await Bun.file(join(String(dir), "test.txt")).text();
      expect(content).toBe("Hello from GC test!");
    });

    test("blob() works even if archive is not referenced", async () => {
      // Get blob promise without keeping archive reference
      const promise = new Bun.Archive({
        "file.txt": "Blob GC test content",
      }).blob();

      // Force aggressive GC
      Bun.gc(true);
      Bun.gc(true);

      const blob = await promise;
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.size).toBeGreaterThan(0);
    });

    test("bytes() works even if archive is not referenced", async () => {
      // Get bytes promise without keeping archive reference
      const promise = new Bun.Archive({
        "file.txt": "Bytes GC test content",
      }).bytes();

      // Force aggressive GC
      Bun.gc(true);
      Bun.gc(true);

      const bytes = await promise;
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBeGreaterThan(0);
    });
  });

  describe("large archives", () => {
    test("handles large file content", async () => {
      const largeContent = Buffer.alloc(1024 * 1024, "x"); // 1MB
      const archive = new Bun.Archive({
        "large.txt": largeContent,
      });

      using dir = tempDir("archive-large", {});
      await archive.extract(String(dir));

      const extracted = await Bun.file(join(String(dir), "large.txt")).arrayBuffer();
      expect(extracted.byteLength).toBe(largeContent.length);
    });

    test("handles many files", async () => {
      const entries: Record<string, string> = {};
      for (let i = 0; i < 500; i++) {
        entries[`file${i.toString().padStart(4, "0")}.txt`] = `Content ${i}`;
      }

      const archive = new Bun.Archive(entries);

      using dir = tempDir("archive-many-files", {});
      const count = await archive.extract(String(dir));
      expect(count).toBeGreaterThanOrEqual(500);
    });
  });

  describe("special characters", () => {
    test("handles filenames with spaces", async () => {
      const archive = new Bun.Archive({
        "file with spaces.txt": "content",
      });

      using dir = tempDir("archive-spaces", {});
      await archive.extract(String(dir));

      const content = await Bun.file(join(String(dir), "file with spaces.txt")).text();
      expect(content).toBe("content");
    });

    test("handles special characters in filenames", async () => {
      // Note: Some unicode characters may not be supported by all tar formats
      // Using ASCII-only special characters
      const archive = new Bun.Archive({
        "file-with-dash.txt": "content1",
        "file_with_underscore.txt": "content2",
        "file.with.dots.txt": "content3",
      });

      using dir = tempDir("archive-special-chars", {});
      await archive.extract(String(dir));

      expect(await Bun.file(join(String(dir), "file-with-dash.txt")).text()).toBe("content1");
      expect(await Bun.file(join(String(dir), "file_with_underscore.txt")).text()).toBe("content2");
      expect(await Bun.file(join(String(dir), "file.with.dots.txt")).text()).toBe("content3");
    });

    test("handles unicode content", async () => {
      const archive = new Bun.Archive({
        "unicode.txt": "Hello, 世界! Привет! Γειά σου!",
      });

      using dir = tempDir("archive-unicode-content", {});
      await archive.extract(String(dir));

      const content = await Bun.file(join(String(dir), "unicode.txt")).text();
      expect(content).toBe("Hello, 世界! Привет! Γειά σου!");
    });
  });

  describe("archive.files()", () => {
    test("returns a Map of File objects", async () => {
      const archive = new Bun.Archive({
        "hello.txt": "Hello, World!",
        "data.json": JSON.stringify({ foo: "bar" }),
      });

      const files = await archive.files();
      expect(files).toBeInstanceOf(Map);
      expect(files.size).toBe(2);

      const helloFile = files.get("hello.txt");
      expect(helloFile).toBeInstanceOf(File);
      expect(helloFile!.name).toBe("hello.txt");
      expect(await helloFile!.text()).toBe("Hello, World!");

      const dataFile = files.get("data.json");
      expect(dataFile).toBeInstanceOf(File);
      expect(dataFile!.name).toBe("data.json");
      expect(await dataFile!.text()).toBe(JSON.stringify({ foo: "bar" }));
    });

    test("returns empty Map for empty archive", async () => {
      const archive = new Bun.Archive({});
      const files = await archive.files();
      expect(files).toBeInstanceOf(Map);
      expect(files.size).toBe(0);
    });

    test("handles nested directory structure", async () => {
      const archive = new Bun.Archive({
        "root.txt": "Root file",
        "dir1/file1.txt": "File in dir1",
        "dir1/dir2/file2.txt": "File in dir1/dir2",
      });

      const files = await archive.files();
      expect(files.size).toBe(3);

      expect(files.get("root.txt")!.name).toBe("root.txt");
      expect(files.get("dir1/file1.txt")!.name).toBe("dir1/file1.txt");
      expect(files.get("dir1/dir2/file2.txt")!.name).toBe("dir1/dir2/file2.txt");
    });

    test("filters files with glob pattern", async () => {
      const archive = new Bun.Archive({
        "file1.txt": "Text file 1",
        "file2.txt": "Text file 2",
        "file1.json": "JSON file 1",
        "subdir/file3.txt": "Text file 3",
      });

      const txtFiles = await archive.files("*.txt");
      expect(txtFiles.size).toBe(2);
      expect(txtFiles.has("file1.txt")).toBe(true);
      expect(txtFiles.has("file2.txt")).toBe(true);
      expect(txtFiles.has("file1.json")).toBe(false);
      expect(txtFiles.has("subdir/file3.txt")).toBe(false);
    });

    test("filters with ** glob pattern", async () => {
      const archive = new Bun.Archive({
        "file1.txt": "Text file 1",
        "subdir/file2.txt": "Text file 2",
        "subdir/deep/file3.txt": "Text file 3",
        "other.json": "JSON file",
      });

      // **/*.txt matches all .txt files including at root level (** can match zero segments)
      const allTxtFiles = await archive.files("**/*.txt");
      expect(allTxtFiles.size).toBe(3);
      expect(allTxtFiles.has("file1.txt")).toBe(true);
      expect(allTxtFiles.has("subdir/file2.txt")).toBe(true);
      expect(allTxtFiles.has("subdir/deep/file3.txt")).toBe(true);
    });

    test("filters with directory pattern", async () => {
      const archive = new Bun.Archive({
        "src/index.js": "source 1",
        "src/util.js": "source 2",
        "test/index.test.js": "test 1",
        "package.json": "{}",
      });

      const srcFiles = await archive.files("src/*");
      expect(srcFiles.size).toBe(2);
      expect(srcFiles.has("src/index.js")).toBe(true);
      expect(srcFiles.has("src/util.js")).toBe(true);
    });

    test("returns empty Map when no files match glob", async () => {
      const archive = new Bun.Archive({
        "file1.txt": "Text file",
        "file2.json": "JSON file",
      });

      const xmlFiles = await archive.files("*.xml");
      expect(xmlFiles).toBeInstanceOf(Map);
      expect(xmlFiles.size).toBe(0);
    });

    test("handles binary data correctly", async () => {
      const binaryData = new Uint8Array([0, 1, 2, 255, 254, 253, 128, 127]);
      const archive = new Bun.Archive({
        "binary.bin": binaryData,
      });

      const files = await archive.files();
      const binaryFile = files.get("binary.bin");
      expect(binaryFile).toBeInstanceOf(File);

      const extractedBytes = new Uint8Array(await binaryFile!.arrayBuffer());
      expect(extractedBytes.length).toBe(binaryData.length);
      for (let i = 0; i < binaryData.length; i++) {
        expect(extractedBytes[i]).toBe(binaryData[i]);
      }
    });

    test("File objects have lastModified property", async () => {
      // Tar archives store mtime in seconds, so round down to nearest second
      const beforeTime = Math.floor(Date.now() / 1000) * 1000;
      const archive = new Bun.Archive({
        "file.txt": "content",
      });

      const files = await archive.files();
      const file = files.get("file.txt");
      const afterTime = Date.now() + 1000; // Add 1 second for rounding tolerance

      expect(file!.lastModified).toBeGreaterThanOrEqual(beforeTime);
      expect(file!.lastModified).toBeLessThanOrEqual(afterTime);
    });

    test("throws with non-string glob argument", async () => {
      const archive = new Bun.Archive({
        "file.txt": "content",
      });

      await expect(async () => {
        // @ts-expect-error - testing runtime behavior
        await archive.files(123);
      }).toThrow();
    });

    test("works with gzipped archive source", async () => {
      const sourceArchive = new Bun.Archive(
        {
          "hello.txt": "Hello from gzip!",
        },
        { compress: "gzip" },
      );

      const gzippedBlob = await sourceArchive.blob();
      const archive = new Bun.Archive(gzippedBlob);

      const files = await archive.files();
      expect(files.size).toBe(1);
      expect(await files.get("hello.txt")!.text()).toBe("Hello from gzip!");
    });

    test("concurrent files() operations work correctly", async () => {
      const archive = new Bun.Archive({
        "file.txt": "content",
      });

      const [files1, files2, files3] = await Promise.all([archive.files(), archive.files(), archive.files()]);

      expect(files1.size).toBe(1);
      expect(files2.size).toBe(1);
      expect(files3.size).toBe(1);
    });

    test("files() works even if archive is not referenced (GC safety)", async () => {
      const promise = new Bun.Archive({
        "test.txt": "GC test content",
      }).files();

      Bun.gc(true);
      Bun.gc(true);

      const files = await promise;
      expect(files).toBeInstanceOf(Map);
      expect(files.size).toBe(1);
      expect(await files.get("test.txt")!.text()).toBe("GC test content");
    });
  });

  describe("sparse files", () => {
    // These test sparse tar files created with GNU tar --sparse
    // They exercise the pwrite/lseek/writeZeros code paths in readDataIntoFd
    const fixturesDir = join(import.meta.dir, "fixtures", "sparse-tars");

    test("extracts sparse file with small hole (< 1 tar block)", async () => {
      using dir = tempDir("sparse-small", {});

      const tarData = await Bun.file(join(fixturesDir, "small-hole.tar")).bytes();
      const archive = new Bun.Archive(tarData);
      await archive.extract(String(dir));

      const extracted = await Bun.file(join(String(dir), "small-hole.bin")).bytes();

      // File structure: 64 bytes 'A', 256 bytes hole, 64 bytes 'B'
      expect(extracted.length).toBe(384);
      expect(extracted.slice(0, 64)).toEqual(new Uint8Array(64).fill(0x41));
      expect(extracted.slice(64, 320)).toEqual(new Uint8Array(256).fill(0));
      expect(extracted.slice(320, 384)).toEqual(new Uint8Array(64).fill(0x42));
    });

    test("extracts sparse file with 1 tar block hole (512 bytes)", async () => {
      using dir = tempDir("sparse-1block", {});

      const tarData = await Bun.file(join(fixturesDir, "one-block-hole.tar")).bytes();
      const archive = new Bun.Archive(tarData);
      await archive.extract(String(dir));

      const extracted = await Bun.file(join(String(dir), "one-block-hole.bin")).bytes();

      // File structure: 100 bytes 'C', 512 bytes hole, 100 bytes 'D'
      expect(extracted.length).toBe(712);
      expect(extracted.slice(0, 100)).toEqual(new Uint8Array(100).fill(0x43));
      expect(extracted.slice(100, 612)).toEqual(new Uint8Array(512).fill(0));
      expect(extracted.slice(612, 712)).toEqual(new Uint8Array(100).fill(0x44));
    });

    test("extracts sparse file with multi-block hole (5 tar blocks)", async () => {
      using dir = tempDir("sparse-multi", {});

      const tarData = await Bun.file(join(fixturesDir, "multi-block-hole.tar")).bytes();
      const archive = new Bun.Archive(tarData);
      await archive.extract(String(dir));

      const extracted = await Bun.file(join(String(dir), "multi-block-hole.bin")).bytes();

      // File structure: 128 bytes random, 2560 bytes hole, 128 bytes random
      expect(extracted.length).toBe(2816);
      // Verify the hole is zeros
      expect(extracted.slice(128, 2688)).toEqual(new Uint8Array(2560).fill(0));
    });

    test("extracts sparse file with leading hole", async () => {
      using dir = tempDir("sparse-leading", {});

      const tarData = await Bun.file(join(fixturesDir, "leading-hole.tar")).bytes();
      const archive = new Bun.Archive(tarData);
      await archive.extract(String(dir));

      const extracted = await Bun.file(join(String(dir), "leading-hole.bin")).bytes();

      // File structure: 2048 bytes hole, 512 bytes 'Y'
      expect(extracted.length).toBe(2560);
      expect(extracted.slice(0, 2048)).toEqual(new Uint8Array(2048).fill(0));
      expect(extracted.slice(2048, 2560)).toEqual(new Uint8Array(512).fill(0x59));
    });

    test("extracts sparse file with trailing hole", async () => {
      using dir = tempDir("sparse-trailing", {});

      const tarData = await Bun.file(join(fixturesDir, "trailing-hole.tar")).bytes();
      const archive = new Bun.Archive(tarData);
      await archive.extract(String(dir));

      const extracted = await Bun.file(join(String(dir), "trailing-hole.bin")).bytes();

      // File structure: 256 bytes 'X', 5120 bytes hole
      expect(extracted.length).toBe(5376);
      expect(extracted.slice(0, 256)).toEqual(new Uint8Array(256).fill(0x58));
      expect(extracted.slice(256, 5376)).toEqual(new Uint8Array(5120).fill(0));
    });

    test("extracts sparse file with large hole (64KB)", async () => {
      using dir = tempDir("sparse-large", {});

      const tarData = await Bun.file(join(fixturesDir, "large-hole.tar")).bytes();
      const archive = new Bun.Archive(tarData);
      await archive.extract(String(dir));

      const extracted = await Bun.file(join(String(dir), "large-hole.bin")).bytes();

      // File structure: 1024 bytes random, 64KB hole, 1024 bytes random
      expect(extracted.length).toBe(67584);
      // Verify the 64KB hole is zeros
      expect(extracted.slice(1024, 66560)).toEqual(new Uint8Array(65536).fill(0));
    });
  });

  describe("extract with glob patterns", () => {
    test("extracts only files matching glob pattern", async () => {
      const archive = new Bun.Archive({
        "src/index.ts": "export {}",
        "src/utils.ts": "export {}",
        "src/types.d.ts": "declare {}",
        "test/index.test.ts": "test()",
        "README.md": "# Hello",
        "package.json": "{}",
      });

      using dir = tempDir("archive-glob-pattern", {});
      const count = await archive.extract(String(dir), { glob: "**/*.ts" });

      // Should extract 4 .ts files (including .d.ts and .test.ts)
      expect(count).toBe(4);
      expect(await Bun.file(join(String(dir), "src/index.ts")).exists()).toBe(true);
      expect(await Bun.file(join(String(dir), "src/utils.ts")).exists()).toBe(true);
      expect(await Bun.file(join(String(dir), "src/types.d.ts")).exists()).toBe(true);
      expect(await Bun.file(join(String(dir), "test/index.test.ts")).exists()).toBe(true);
      expect(await Bun.file(join(String(dir), "README.md")).exists()).toBe(false);
      expect(await Bun.file(join(String(dir), "package.json")).exists()).toBe(false);
    });

    test("extracts files matching any of multiple glob patterns", async () => {
      const archive = new Bun.Archive({
        "src/index.ts": "export {}",
        "lib/utils.js": "module.exports = {}",
        "test/test.ts": "test()",
        "README.md": "# Hello",
      });

      using dir = tempDir("archive-multi-glob", {});
      const count = await archive.extract(String(dir), { glob: ["src/**", "lib/**"] });

      expect(count).toBe(2);
      expect(await Bun.file(join(String(dir), "src/index.ts")).exists()).toBe(true);
      expect(await Bun.file(join(String(dir), "lib/utils.js")).exists()).toBe(true);
      expect(await Bun.file(join(String(dir), "test/test.ts")).exists()).toBe(false);
      expect(await Bun.file(join(String(dir), "README.md")).exists()).toBe(false);
    });

    test("excludes files matching negative pattern", async () => {
      const archive = new Bun.Archive({
        "src/index.ts": "export {}",
        "src/index.test.ts": "test()",
        "src/utils.ts": "export {}",
        "src/utils.test.ts": "test()",
      });

      using dir = tempDir("archive-negative-pattern", {});
      // Use negative pattern to exclude test files
      const count = await archive.extract(String(dir), { glob: ["**", "!**/*.test.ts"] });

      expect(count).toBe(2);
      expect(await Bun.file(join(String(dir), "src/index.ts")).exists()).toBe(true);
      expect(await Bun.file(join(String(dir), "src/utils.ts")).exists()).toBe(true);
      expect(await Bun.file(join(String(dir), "src/index.test.ts")).exists()).toBe(false);
      expect(await Bun.file(join(String(dir), "src/utils.test.ts")).exists()).toBe(false);
    });

    test("excludes files matching any of multiple negative patterns", async () => {
      const archive = new Bun.Archive({
        "src/index.ts": "export {}",
        "src/index.test.ts": "test()",
        "__tests__/helper.ts": "helper",
        "node_modules/pkg/index.js": "module",
      });

      using dir = tempDir("archive-multi-negative", {});
      const count = await archive.extract(String(dir), {
        glob: ["**", "!**/*.test.ts", "!__tests__/**", "!node_modules/**"],
      });

      expect(count).toBe(1);
      expect(await Bun.file(join(String(dir), "src/index.ts")).exists()).toBe(true);
      expect(await Bun.file(join(String(dir), "src/index.test.ts")).exists()).toBe(false);
      expect(await Bun.file(join(String(dir), "__tests__/helper.ts")).exists()).toBe(false);
      expect(await Bun.file(join(String(dir), "node_modules/pkg/index.js")).exists()).toBe(false);
    });

    test("combines positive and negative glob patterns", async () => {
      const archive = new Bun.Archive({
        "src/index.ts": "export {}",
        "src/index.test.ts": "test()",
        "src/utils.ts": "export {}",
        "lib/helper.ts": "helper",
        "lib/helper.test.ts": "test()",
        "README.md": "# Hello",
      });

      using dir = tempDir("archive-glob-and-negative", {});
      const count = await archive.extract(String(dir), {
        glob: ["src/**", "lib/**", "!**/*.test.ts"],
      });

      expect(count).toBe(3);
      expect(await Bun.file(join(String(dir), "src/index.ts")).exists()).toBe(true);
      expect(await Bun.file(join(String(dir), "src/utils.ts")).exists()).toBe(true);
      expect(await Bun.file(join(String(dir), "lib/helper.ts")).exists()).toBe(true);
      expect(await Bun.file(join(String(dir), "src/index.test.ts")).exists()).toBe(false);
      expect(await Bun.file(join(String(dir), "lib/helper.test.ts")).exists()).toBe(false);
      expect(await Bun.file(join(String(dir), "README.md")).exists()).toBe(false);
    });

    test("extracts all files when no patterns are provided", async () => {
      const archive = new Bun.Archive({
        "file1.txt": "content1",
        "file2.txt": "content2",
      });

      using dir = tempDir("archive-no-patterns", {});
      const count = await archive.extract(String(dir), {});

      expect(count).toBe(2);
      expect(await Bun.file(join(String(dir), "file1.txt")).exists()).toBe(true);
      expect(await Bun.file(join(String(dir), "file2.txt")).exists()).toBe(true);
    });

    test("returns 0 when no files match glob pattern", async () => {
      const archive = new Bun.Archive({
        "file.txt": "content",
        "other.md": "markdown",
      });

      using dir = tempDir("archive-no-match", {});
      const count = await archive.extract(String(dir), { glob: "**/*.ts" });

      expect(count).toBe(0);
    });
  });

  describe("concurrent operations", () => {
    test("multiple extract operations run correctly", async () => {
      const archive = new Bun.Archive({
        "file.txt": "content",
      });

      using dir1 = tempDir("archive-concurrent-1", {});
      using dir2 = tempDir("archive-concurrent-2", {});
      using dir3 = tempDir("archive-concurrent-3", {});

      const [count1, count2, count3] = await Promise.all([
        archive.extract(String(dir1)),
        archive.extract(String(dir2)),
        archive.extract(String(dir3)),
      ]);

      expect(count1).toBeGreaterThan(0);
      expect(count2).toBeGreaterThan(0);
      expect(count3).toBeGreaterThan(0);

      expect(await Bun.file(join(String(dir1), "file.txt")).text()).toBe("content");
      expect(await Bun.file(join(String(dir2), "file.txt")).text()).toBe("content");
      expect(await Bun.file(join(String(dir3), "file.txt")).text()).toBe("content");
    });

    test("multiple blob operations run correctly", async () => {
      const archive = new Bun.Archive({
        "file.txt": "content",
      });

      const [blob1, blob2, blob3] = await Promise.all([archive.blob(), archive.blob(), archive.blob()]);

      expect(blob1.size).toBe(blob2.size);
      expect(blob2.size).toBe(blob3.size);
    });

    test("mixed operations run correctly", async () => {
      const archive = new Bun.Archive({
        "file.txt": "content",
      });

      using dir = tempDir("archive-concurrent-mixed", {});

      const [blob, bytes, count] = await Promise.all([archive.blob(), archive.bytes(), archive.extract(String(dir))]);

      expect(blob).toBeInstanceOf(Blob);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(count).toBeGreaterThan(0);
    });
  });

  describe("Bun.write with Archive", () => {
    test("writes archive to local file", async () => {
      const archive = new Bun.Archive({
        "hello.txt": "Hello, World!",
        "data.json": JSON.stringify({ foo: "bar" }),
      });

      using dir = tempDir("archive-bunwrite", {});
      const tarPath = join(String(dir), "test.tar");

      const bytesWritten = await Bun.write(tarPath, archive);
      expect(bytesWritten).toBeGreaterThan(0);

      // Verify the file was written
      expect(await Bun.file(tarPath).exists()).toBe(true);

      // Read it back and verify contents
      const readArchive = new Bun.Archive(await Bun.file(tarPath).bytes());
      const files = await readArchive.files();
      expect(files.size).toBe(2);
      expect(files.get("hello.txt")).toBeDefined();
      expect(await files.get("hello.txt")!.text()).toBe("Hello, World!");
      expect(await files.get("data.json")!.text()).toBe(JSON.stringify({ foo: "bar" }));
    });

    test("writes archive with nested directories", async () => {
      const archive = new Bun.Archive({
        "root.txt": "root file",
        "dir1/file1.txt": "file in dir1",
        "dir1/dir2/file2.txt": "file in dir1/dir2",
      });

      using dir = tempDir("archive-bunwrite-nested", {});
      const tarPath = join(String(dir), "nested.tar");

      await Bun.write(tarPath, archive);

      // Read it back
      const readArchive = new Bun.Archive(await Bun.file(tarPath).bytes());
      const files = await readArchive.files();
      expect(files.size).toBe(3);
      expect(await files.get("dir1/dir2/file2.txt")!.text()).toBe("file in dir1/dir2");
    });

    test("writes archive with binary content", async () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
      const archive = new Bun.Archive({
        "binary.bin": binaryData,
      });

      using dir = tempDir("archive-bunwrite-binary", {});
      const tarPath = join(String(dir), "binary.tar");

      await Bun.write(tarPath, archive);

      // Read it back
      const readArchive = new Bun.Archive(await Bun.file(tarPath).bytes());
      const files = await readArchive.files();
      const extractedBinary = await files.get("binary.bin")!.bytes();
      expect(extractedBinary).toEqual(binaryData);
    });

    test("writes archive to Bun.file()", async () => {
      const archive = new Bun.Archive({
        "test.txt": "test content",
      });

      using dir = tempDir("archive-bunwrite-file", {});
      const tarPath = join(String(dir), "test.tar");
      const bunFile = Bun.file(tarPath);

      await Bun.write(bunFile, archive);

      expect(await bunFile.exists()).toBe(true);
      const readArchive = new Bun.Archive(await bunFile.bytes());
      const files = await readArchive.files();
      expect(await files.get("test.txt")!.text()).toBe("test content");
    });
  });

  describe("TypeScript types", () => {
    test("valid archive options", () => {
      const files = { "hello.txt": "Hello, World!" };

      // Valid: no options (no compression)
      new Bun.Archive(files);

      // Valid: empty options (also no compression)
      new Bun.Archive(files, {});

      // Valid: explicit gzip compression
      new Bun.Archive(files, { compress: "gzip" });

      // Valid: gzip with level
      new Bun.Archive(files, { compress: "gzip", level: 9 });
    });

    test("invalid archive options throw TypeScript errors", () => {
      // This test verifies that invalid options produce TypeScript errors
      // The @ts-expect-error directives are checked at compile time
      // We use a never-executed function to avoid runtime errors for "zstd"
      const _typeCheck = () => {
        const files = { "hello.txt": "Hello, World!" };
        // @ts-expect-error - invalid compression type (this throws at runtime)
        new Bun.Archive(files, { compress: "zstd", level: 9 });
      };
      // Just verify the type checks pass - don't actually run the code
      expect(_typeCheck).toBeDefined();
    });

    test("level without compress is TypeScript error but no runtime error", async () => {
      const files = { "hello.txt": "Hello, World!" };

      // @ts-expect-error - level without compress is a TypeScript error
      const archive = new Bun.Archive(files, { level: 9 });

      // Should not throw at runtime - level is silently ignored, no compression used
      expect(archive).toBeInstanceOf(Bun.Archive);

      // Verify it produces uncompressed output (same as empty options)
      const uncompressedArchive = new Bun.Archive(files, {});
      const bytes = await archive.bytes();
      const uncompressedBytes = await uncompressedArchive.bytes();
      expect(bytes.length).toBe(uncompressedBytes.length);
    });
  });
});

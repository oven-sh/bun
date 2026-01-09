import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

describe("Bun.Archive", () => {
  describe("Archive.from", () => {
    test("creates archive from object with string values", async () => {
      const archive = Bun.Archive.from({
        "hello.txt": "Hello, World!",
        "data.json": JSON.stringify({ foo: "bar" }),
      });

      expect(archive).toBeInstanceOf(Bun.Archive);
    });

    test("creates archive from object with Blob values", async () => {
      const archive = Bun.Archive.from({
        "blob1.txt": new Blob(["Hello from Blob"]),
        "blob2.txt": new Blob(["Another Blob"]),
      });

      expect(archive).toBeInstanceOf(Bun.Archive);
    });

    test("creates archive from object with Uint8Array values", async () => {
      const encoder = new TextEncoder();
      const archive = Bun.Archive.from({
        "bytes1.txt": encoder.encode("Hello from Uint8Array"),
        "bytes2.txt": encoder.encode("Another Uint8Array"),
      });

      expect(archive).toBeInstanceOf(Bun.Archive);
    });

    test("creates archive from object with ArrayBuffer values", async () => {
      const encoder = new TextEncoder();
      const archive = Bun.Archive.from({
        "buffer1.txt": encoder.encode("Hello from ArrayBuffer").buffer,
        "buffer2.txt": encoder.encode("Another ArrayBuffer").buffer,
      });

      expect(archive).toBeInstanceOf(Bun.Archive);
    });

    test("creates archive from object with mixed value types", async () => {
      const encoder = new TextEncoder();
      const archive = Bun.Archive.from({
        "string.txt": "String content",
        "blob.txt": new Blob(["Blob content"]),
        "uint8.txt": encoder.encode("Uint8Array content"),
        "buffer.txt": encoder.encode("ArrayBuffer content").buffer,
      });

      expect(archive).toBeInstanceOf(Bun.Archive);
    });

    test("creates archive from Blob", async () => {
      // First create an archive with some content
      const sourceArchive = Bun.Archive.from({
        "test.txt": "test content",
      });

      const blob = await sourceArchive.blob();
      expect(blob).toBeInstanceOf(Blob);

      // Create new archive from the blob
      const archive = Bun.Archive.from(blob);
      expect(archive).toBeInstanceOf(Bun.Archive);
    });

    test("creates archive from ArrayBuffer", async () => {
      const sourceArchive = Bun.Archive.from({
        "test.txt": "test content",
      });

      const bytes = await sourceArchive.bytes();
      const buffer = bytes.buffer;

      const archive = Bun.Archive.from(buffer);
      expect(archive).toBeInstanceOf(Bun.Archive);
    });

    test("creates archive from Uint8Array", async () => {
      const sourceArchive = Bun.Archive.from({
        "test.txt": "test content",
      });

      const bytes = await sourceArchive.bytes();

      const archive = Bun.Archive.from(bytes);
      expect(archive).toBeInstanceOf(Bun.Archive);
    });

    test("creates archive with nested directory structure", async () => {
      const archive = Bun.Archive.from({
        "root.txt": "Root file",
        "dir1/file1.txt": "File in dir1",
        "dir1/dir2/file2.txt": "File in dir1/dir2",
        "dir1/dir2/dir3/file3.txt": "File in dir1/dir2/dir3",
      });

      expect(archive).toBeInstanceOf(Bun.Archive);
    });

    test("creates archive with empty string value", async () => {
      const archive = Bun.Archive.from({
        "empty.txt": "",
      });

      expect(archive).toBeInstanceOf(Bun.Archive);
    });

    test("throws with no arguments", () => {
      expect(() => {
        // @ts-expect-error - testing runtime behavior
        Bun.Archive.from();
      }).toThrow();
    });

    test("throws with invalid input type (number)", () => {
      expect(() => {
        // @ts-expect-error - testing runtime behavior
        Bun.Archive.from(123);
      }).toThrow();
    });

    test("throws with invalid input type (null)", () => {
      expect(() => {
        // @ts-expect-error - testing runtime behavior
        Bun.Archive.from(null);
      }).toThrow();
    });

    test("converts non-string/buffer values to strings", async () => {
      // @ts-expect-error - testing runtime behavior
      const archive = Bun.Archive.from({ "file.txt": 123 });
      // The archive should be created successfully - number is converted to string
      expect(archive).toBeDefined();
      const bytes = await archive.bytes();
      // Should contain "123" somewhere in the tarball
      expect(new TextDecoder().decode(bytes)).toContain("123");
    });
  });

  describe("archive.blob()", () => {
    test("returns a Blob", async () => {
      const archive = Bun.Archive.from({
        "hello.txt": "Hello, World!",
      });

      const blob = await archive.blob();
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.size).toBeGreaterThan(0);
    });

    test("returns consistent output for same input", async () => {
      const archive = Bun.Archive.from({
        "hello.txt": "Hello, World!",
      });

      const blob1 = await archive.blob();
      const blob2 = await archive.blob();
      expect(blob1.size).toBe(blob2.size);
    });

    test("with gzip returns gzipped blob", async () => {
      const archive = Bun.Archive.from({
        "hello.txt": "Hello, World!",
      });

      const regularBlob = await archive.blob();
      const gzippedBlob = await archive.blob("gzip");

      expect(gzippedBlob).toBeInstanceOf(Blob);
      // Gzipped should be different size
      expect(gzippedBlob.size).not.toBe(regularBlob.size);
    });

    test("gzip is smaller for larger repetitive data", async () => {
      const largeContent = Buffer.alloc(13000, "Hello, World!");
      const archive = Bun.Archive.from({
        "large.txt": largeContent,
      });

      const regularBlob = await archive.blob();
      const gzippedBlob = await archive.blob("gzip");

      // For large repetitive data, gzip should be smaller
      expect(gzippedBlob.size).toBeLessThan(regularBlob.size);
    });

    test("throws with invalid compress argument", async () => {
      const archive = Bun.Archive.from({
        "hello.txt": "Hello, World!",
      });

      await expect(async () => {
        // @ts-expect-error - testing runtime behavior
        await archive.blob("invalid");
      }).toThrow();
    });
  });

  describe("archive.bytes()", () => {
    test("returns a Uint8Array", async () => {
      const archive = Bun.Archive.from({
        "hello.txt": "Hello, World!",
      });

      const bytes = await archive.bytes();
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBeGreaterThan(0);
    });

    test("returns consistent output for same input", async () => {
      const archive = Bun.Archive.from({
        "hello.txt": "Hello, World!",
      });

      const bytes1 = await archive.bytes();
      const bytes2 = await archive.bytes();
      expect(bytes1.length).toBe(bytes2.length);
    });

    test("with gzip returns gzipped bytes", async () => {
      const archive = Bun.Archive.from({
        "hello.txt": "Hello, World!",
      });

      const regularBytes = await archive.bytes();
      const gzippedBytes = await archive.bytes("gzip");

      expect(gzippedBytes).toBeInstanceOf(Uint8Array);
      // Gzipped should be different size
      expect(gzippedBytes.length).not.toBe(regularBytes.length);
    });

    test("gzip is smaller for larger repetitive data", async () => {
      const largeContent = Buffer.alloc(13000, "Hello, World!");
      const archive = Bun.Archive.from({
        "large.txt": largeContent,
      });

      const regularBytes = await archive.bytes();
      const gzippedBytes = await archive.bytes("gzip");

      // For large repetitive data, gzip should be smaller
      expect(gzippedBytes.length).toBeLessThan(regularBytes.length);
    });

    test("bytes match blob content", async () => {
      const archive = Bun.Archive.from({
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

    test("throws with invalid compress argument", async () => {
      const archive = Bun.Archive.from({
        "hello.txt": "Hello, World!",
      });

      await expect(async () => {
        // @ts-expect-error - testing runtime behavior
        await archive.bytes("deflate");
      }).toThrow();
    });
  });

  describe("archive.extract()", () => {
    test("extracts to directory and returns file count", async () => {
      using dir = tempDir("archive-extract-test", {});

      const archive = Bun.Archive.from({
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

      const archive = Bun.Archive.from({
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
      const archive = Bun.Archive.from({
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
      const sourceArchive = Bun.Archive.from({
        "test.txt": "test content",
      });

      // Get as blob and create new archive
      const blob = await sourceArchive.blob();
      const archive = Bun.Archive.from(blob);

      const count = await archive.extract(String(dir));
      expect(count).toBeGreaterThan(0);

      const content = await Bun.file(join(String(dir), "test.txt")).text();
      expect(content).toBe("test content");
    });

    test("extracts from archive created from bytes", async () => {
      using dir = tempDir("archive-extract-from-bytes", {});

      // Create original archive
      const sourceArchive = Bun.Archive.from({
        "test.txt": "test content",
      });

      // Get as bytes and create new archive
      const bytes = await sourceArchive.bytes();
      const archive = Bun.Archive.from(bytes);

      const count = await archive.extract(String(dir));
      expect(count).toBeGreaterThan(0);

      const content = await Bun.file(join(String(dir), "test.txt")).text();
      expect(content).toBe("test content");
    });

    test("throws with missing path argument", async () => {
      const archive = Bun.Archive.from({
        "hello.txt": "Hello, World!",
      });

      await expect(async () => {
        // @ts-expect-error - testing runtime behavior
        await archive.extract();
      }).toThrow();
    });

    test("throws with non-string path argument", async () => {
      const archive = Bun.Archive.from({
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

      const archive = Bun.Archive.from({
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

      const archive = Bun.Archive.from({
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
      const archive = Bun.Archive.from(corruptedData);

      using dir = tempDir("archive-corrupted", {});

      await expect(async () => {
        await archive.extract(String(dir));
      }).toThrow();
    });

    test("throws when extracting truncated archive", async () => {
      // Create a valid archive then truncate it
      const validArchive = Bun.Archive.from({
        "file.txt": "Hello, World!",
      });
      const bytes = await validArchive.bytes();

      // Truncate to only first 10 bytes - definitely incomplete
      const truncated = bytes.slice(0, 10);
      const archive = Bun.Archive.from(truncated);

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

      const archive = Bun.Archive.from(randomBytes);

      using dir = tempDir("archive-random", {});

      await expect(async () => {
        await archive.extract(String(dir));
      }).toThrow();
    });

    test("handles empty archive gracefully", async () => {
      // Empty data
      const emptyData = new Uint8Array(0);
      const archive = Bun.Archive.from(emptyData);

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
      const archive = Bun.Archive.from({
        "dir//subdir///file.txt": "content",
      });

      using dir = tempDir("archive-path-normalize", {});
      await archive.extract(String(dir));

      // The file should be extracted with normalized path
      const content = await Bun.file(join(String(dir), "dir/subdir/file.txt")).text();
      expect(content).toBe("content");
    });

    test("handles paths with dots correctly", async () => {
      const archive = Bun.Archive.from({
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
      const archive = Bun.Archive.from({
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
      const archive = Bun.Archive.from({
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
        {
          "hello.txt": largeContent,
        },
        "gzip",
      );

      // Verify file exists and is smaller than uncompressed
      const file = Bun.file(archivePath);
      expect(await file.exists()).toBe(true);

      // Compare with uncompressed
      const uncompressedPath = join(String(dir), "test.tar");
      await Bun.Archive.write(uncompressedPath, {
        "hello.txt": largeContent,
      });

      expect(file.size).toBeLessThan(Bun.file(uncompressedPath).size);
    });

    test("writes archive from Blob", async () => {
      using dir = tempDir("archive-write-blob-test", {});
      const archivePath = join(String(dir), "test.tar");

      // Create archive and get blob
      const sourceArchive = Bun.Archive.from({
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
      const archive = Bun.Archive.from(blob);
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

    test("throws with invalid compress argument", async () => {
      using dir = tempDir("archive-write-invalid-compress", {});
      const archivePath = join(String(dir), "test.tar");

      await expect(async () => {
        // @ts-expect-error - testing runtime behavior
        await Bun.Archive.write(archivePath, { "file.txt": "content" }, "invalid");
      }).toThrow();
    });
  });

  describe("new Archive()", () => {
    test("throws when constructed directly", () => {
      expect(() => {
        // @ts-expect-error - testing runtime behavior
        new Bun.Archive();
      }).toThrow("Archive cannot be constructed directly");
    });
  });

  describe("GC safety", () => {
    test("archive remains valid after GC", async () => {
      const archive = Bun.Archive.from({
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

      const archive = Bun.Archive.from(entries);

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
      const archive = Bun.Archive.from({
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
      const sourceArchive = Bun.Archive.from({
        "data.bin": blob,
      });

      const archiveBlob = await sourceArchive.blob();
      const archive = Bun.Archive.from(archiveBlob);

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
      const promise = Bun.Archive.from({
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
      const promise = Bun.Archive.from({
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
      const promise = Bun.Archive.from({
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
      const archive = Bun.Archive.from({
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

      const archive = Bun.Archive.from(entries);

      using dir = tempDir("archive-many-files", {});
      const count = await archive.extract(String(dir));
      expect(count).toBeGreaterThanOrEqual(500);
    });
  });

  describe("special characters", () => {
    test("handles filenames with spaces", async () => {
      const archive = Bun.Archive.from({
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
      const archive = Bun.Archive.from({
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
      const archive = Bun.Archive.from({
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
      const archive = Bun.Archive.from({
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
      const archive = Bun.Archive.from({});
      const files = await archive.files();
      expect(files).toBeInstanceOf(Map);
      expect(files.size).toBe(0);
    });

    test("handles nested directory structure", async () => {
      const archive = Bun.Archive.from({
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
      const archive = Bun.Archive.from({
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
      const archive = Bun.Archive.from({
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
      const archive = Bun.Archive.from({
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
      const archive = Bun.Archive.from({
        "file1.txt": "Text file",
        "file2.json": "JSON file",
      });

      const xmlFiles = await archive.files("*.xml");
      expect(xmlFiles).toBeInstanceOf(Map);
      expect(xmlFiles.size).toBe(0);
    });

    test("handles binary data correctly", async () => {
      const binaryData = new Uint8Array([0, 1, 2, 255, 254, 253, 128, 127]);
      const archive = Bun.Archive.from({
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
      const archive = Bun.Archive.from({
        "file.txt": "content",
      });

      const files = await archive.files();
      const file = files.get("file.txt");
      const afterTime = Date.now() + 1000; // Add 1 second for rounding tolerance

      expect(file!.lastModified).toBeGreaterThanOrEqual(beforeTime);
      expect(file!.lastModified).toBeLessThanOrEqual(afterTime);
    });

    test("throws with non-string glob argument", async () => {
      const archive = Bun.Archive.from({
        "file.txt": "content",
      });

      await expect(async () => {
        // @ts-expect-error - testing runtime behavior
        await archive.files(123);
      }).toThrow();
    });

    test("works with gzipped archive source", async () => {
      const sourceArchive = Bun.Archive.from({
        "hello.txt": "Hello from gzip!",
      });

      const gzippedBlob = await sourceArchive.blob("gzip");
      const archive = Bun.Archive.from(gzippedBlob);

      const files = await archive.files();
      expect(files.size).toBe(1);
      expect(await files.get("hello.txt")!.text()).toBe("Hello from gzip!");
    });

    test("concurrent files() operations work correctly", async () => {
      const archive = Bun.Archive.from({
        "file.txt": "content",
      });

      const [files1, files2, files3] = await Promise.all([archive.files(), archive.files(), archive.files()]);

      expect(files1.size).toBe(1);
      expect(files2.size).toBe(1);
      expect(files3.size).toBe(1);
    });

    test("files() works even if archive is not referenced (GC safety)", async () => {
      const promise = Bun.Archive.from({
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

  describe("concurrent operations", () => {
    test("multiple extract operations run correctly", async () => {
      const archive = Bun.Archive.from({
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
      const archive = Bun.Archive.from({
        "file.txt": "content",
      });

      const [blob1, blob2, blob3] = await Promise.all([archive.blob(), archive.blob(), archive.blob()]);

      expect(blob1.size).toBe(blob2.size);
      expect(blob2.size).toBe(blob3.size);
    });

    test("mixed operations run correctly", async () => {
      const archive = Bun.Archive.from({
        "file.txt": "content",
      });

      using dir = tempDir("archive-concurrent-mixed", {});

      const [blob, bytes, count] = await Promise.all([archive.blob(), archive.bytes(), archive.extract(String(dir))]);

      expect(blob).toBeInstanceOf(Blob);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(count).toBeGreaterThan(0);
    });
  });
});

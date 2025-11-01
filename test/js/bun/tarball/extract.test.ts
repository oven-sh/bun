import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

describe("Bun.extract()", () => {
  test("extracts tar archive to memory", async () => {
    // First create a tarball
    const tarBlob = await Bun.tarball({
      files: {
        "hello.txt": "hello world",
        "data/test.json": '{"key":"value"}',
      },
    });

    // Extract it to memory
    const files = await Bun.extract(tarBlob);

    expect(files).toBeInstanceOf(Object);
    expect(Object.keys(files)).toHaveLength(2);
    expect(files["hello.txt"]).toBeInstanceOf(Blob);
    expect(files["data/test.json"]).toBeInstanceOf(Blob);

    // Verify content
    expect(await files["hello.txt"].text()).toBe("hello world");
    expect(await files["data/test.json"].text()).toBe('{"key":"value"}');
  });

  test("extracts tar archive to disk", async () => {
    // Create a tarball
    const tarBlob = await Bun.tarball({
      files: {
        "readme.txt": "This is a readme",
        "src/index.js": "console.log('hello');",
      },
    });

    using dir = tempDir("extract-test", {});

    // Extract to disk
    const fileCount = await Bun.extract(tarBlob, {
      destination: String(dir),
    });

    expect(fileCount).toBe(2);

    // Verify files exist on disk
    const readmeContent = await Bun.file(join(dir, "readme.txt")).text();
    expect(readmeContent).toBe("This is a readme");

    const indexContent = await Bun.file(join(dir, "src/index.js")).text();
    expect(indexContent).toBe("console.log('hello');");
  });

  test("extracts from file path", async () => {
    using dir = tempDir("extract-path-test", {});

    // Create and save a tarball
    const tarBlob = await Bun.tarball({
      files: {
        "test.txt": "content",
      },
    });

    const tarPath = join(dir, "archive.tar");
    await Bun.write(tarPath, tarBlob);

    // Extract from path
    const files = await Bun.extract(tarPath);

    expect(files["test.txt"]).toBeInstanceOf(Blob);
    expect(await files["test.txt"].text()).toBe("content");
  });

  test("handles skipPathComponents option", async () => {
    const tarBlob = await Bun.tarball({
      files: {
        "a/b/c/file.txt": "nested content",
        "a/b/other.txt": "other content",
      },
    });

    // Skip first 2 components (a/b/)
    const files = await Bun.extract(tarBlob, {
      skipPathComponents: 2,
    });

    expect(files["c/file.txt"]).toBeInstanceOf(Blob);
    expect(files["other.txt"]).toBeInstanceOf(Blob);
    expect(await files["c/file.txt"].text()).toBe("nested content");
    expect(await files["other.txt"].text()).toBe("other content");
  });

  test("works with gzipped tar", async () => {
    const tarBlob = await Bun.tarball({
      files: {
        "compressed.txt": "x".repeat(1000),
      },
      compress: "gzip",
    });

    const files = await Bun.extract(tarBlob);

    expect(files["compressed.txt"]).toBeInstanceOf(Blob);
    expect(await files["compressed.txt"].text()).toBe("x".repeat(1000));
  });

  test("throws for invalid archive", async () => {
    await expect(Bun.extract(new Blob(["not a tar file"]))).rejects.toThrow();
  });

  test("throws when no arguments provided", () => {
    expect(() => {
      // @ts-expect-error - testing invalid args
      Bun.extract();
    }).toThrow();
  });

  test("throws for invalid archive type", () => {
    expect(() => {
      // @ts-expect-error - testing invalid args
      Bun.extract(123);
    }).toThrow();
  });

  test("throws for non-existent file path", () => {
    expect(() => Bun.extract("/this/path/does/not/exist.tar")).toThrow();
  });

  test("roundtrip: create tarball and extract to memory", async () => {
    const original = {
      "README.md": "# My Project\n\nThis is a test project.",
      "src/index.ts": 'export const hello = "world";\n',
      "src/utils/helper.ts": "export function add(a: number, b: number) { return a + b; }",
      "package.json": '{\n  "name": "test",\n  "version": "1.0.0"\n}',
    };

    // Create tarball
    const tarBlob = await Bun.tarball({ files: original });

    // Extract it back
    const extracted = await Bun.extract(tarBlob);

    // Verify all files exist with correct content
    expect(Object.keys(extracted)).toHaveLength(4);
    for (const [path, content] of Object.entries(original)) {
      expect(extracted[path]).toBeInstanceOf(Blob);
      expect(await extracted[path].text()).toBe(content);
    }
  });

  test("roundtrip: create gzipped tarball and extract", async () => {
    const original = {
      "file1.txt": "a".repeat(1000),
      "file2.txt": "b".repeat(1000),
    };

    // Create gzipped tarball
    const tarBlob = await Bun.tarball({ files: original, compress: "gzip" });

    // Verify it's actually compressed (should be much smaller)
    expect(tarBlob.size).toBeLessThan(2000);

    // Extract it back
    const extracted = await Bun.extract(tarBlob);

    // Verify content
    expect(await extracted["file1.txt"].text()).toBe("a".repeat(1000));
    expect(await extracted["file2.txt"].text()).toBe("b".repeat(1000));
  });

  test("roundtrip: create tarball, save to disk, extract from disk", async () => {
    using dir = tempDir("roundtrip-disk", {});

    const original = {
      "test.txt": "Hello from disk!",
      "nested/file.txt": "Nested content",
    };

    // Create tarball and save to disk
    const tarBlob = await Bun.tarball({ files: original });
    const tarPath = join(dir, "archive.tar");
    await Bun.write(tarPath, tarBlob);

    // Extract from disk path
    const extracted = await Bun.extract(tarPath);

    // Verify content
    expect(await extracted["test.txt"].text()).toBe("Hello from disk!");
    expect(await extracted["nested/file.txt"].text()).toBe("Nested content");
  });

  test("roundtrip: tarball with destination, extract with destination", async () => {
    using createDir = tempDir("roundtrip-create", {});
    using extractDir = tempDir("roundtrip-extract", {});

    const original = {
      "a.txt": "File A",
      "b.txt": "File B",
    };

    // Create tarball with destination (to disk)
    const tarPath = join(createDir, "output.tar");
    await Bun.tarball({ files: original, destination: tarPath });

    // Verify tarball was created
    expect(await Bun.file(tarPath).exists()).toBe(true);

    // Extract to another directory
    const fileCount = await Bun.extract(tarPath, {
      destination: String(extractDir),
    });

    expect(fileCount).toBe(2);

    // Verify files
    expect(await Bun.file(join(extractDir, "a.txt")).text()).toBe("File A");
    expect(await Bun.file(join(extractDir, "b.txt")).text()).toBe("File B");
  });

  test("roundtrip: extract with skipPathComponents", async () => {
    const original = {
      "project/src/main.ts": "main content",
      "project/src/lib/utils.ts": "utils content",
      "project/tests/test.ts": "test content",
    };

    const tarBlob = await Bun.tarball({ files: original });

    // Extract skipping first component (project/)
    const extracted = await Bun.extract(tarBlob, {
      skipPathComponents: 1,
    });

    // Verify paths are stripped
    expect(extracted["src/main.ts"]).toBeInstanceOf(Blob);
    expect(extracted["src/lib/utils.ts"]).toBeInstanceOf(Blob);
    expect(extracted["tests/test.ts"]).toBeInstanceOf(Blob);
    expect(await extracted["src/main.ts"].text()).toBe("main content");
  });

  test("accepts Buffer as input", async () => {
    const tarBlob = await Bun.tarball({
      files: { "test.txt": "buffer test" },
    });

    // Convert to Buffer
    const buffer = Buffer.from(await tarBlob.arrayBuffer());

    // Extract from Buffer
    const extracted = await Bun.extract(buffer);

    expect(await extracted["test.txt"].text()).toBe("buffer test");
  });

  test("accepts ArrayBuffer as input", async () => {
    const tarBlob = await Bun.tarball({
      files: { "test.txt": "arraybuffer test" },
    });

    // Convert to ArrayBuffer
    const arrayBuffer = await tarBlob.arrayBuffer();

    // Extract from ArrayBuffer
    const extracted = await Bun.extract(new Uint8Array(arrayBuffer));

    expect(await extracted["test.txt"].text()).toBe("arraybuffer test");
  });

  test("handles archives with directory entries", async () => {
    using dir = tempDir("dir-entries-test", {});

    // Create a tarball that includes directory entries
    const tarBlob = await Bun.tarball({
      files: {
        "dir1/file1.txt": "content1",
        "dir1/dir2/file2.txt": "content2",
        "dir3/file3.txt": "content3",
      },
    });

    // Extract to disk
    const count = await Bun.extract(tarBlob, {
      destination: String(dir),
    });

    // Should count all files
    expect(count).toBeGreaterThanOrEqual(3);

    // Verify nested directories were created
    expect(await Bun.file(join(dir, "dir1/file1.txt")).text()).toBe("content1");
    expect(await Bun.file(join(dir, "dir1/dir2/file2.txt")).text()).toBe("content2");
    expect(await Bun.file(join(dir, "dir3/file3.txt")).text()).toBe("content3");
  });

  test("handles skipPathComponents resulting in empty paths", async () => {
    const tarBlob = await Bun.tarball({
      files: {
        "a/file.txt": "content",
        "b": "another", // Only one component
      },
    });

    // Skip 2 components - "b" entry should be skipped entirely
    const extracted = await Bun.extract(tarBlob, {
      skipPathComponents: 2,
    });

    // Only entries with sufficient path depth should remain
    expect(Object.keys(extracted)).not.toContain("b");
    expect(Object.keys(extracted)).not.toContain("");
  });

  test("extracts archive created by tar CLI", async () => {
    using dir = tempDir("cli-tar-test", {
      "source/file1.txt": "content1",
      "source/nested/file2.txt": "content2",
    });

    const tarPath = join(dir, "archive.tar");

    // Create tarball using system tar command
    await Bun.$`cd ${dir} && tar -cf archive.tar source/`.quiet();

    // Extract using Bun.extract
    const extracted = await Bun.extract(tarPath);

    // Verify files were extracted
    expect(extracted["source/file1.txt"]).toBeInstanceOf(Blob);
    expect(extracted["source/nested/file2.txt"]).toBeInstanceOf(Blob);
    expect(await extracted["source/file1.txt"].text()).toBe("content1");
    expect(await extracted["source/nested/file2.txt"].text()).toBe("content2");
  });

  test("handles archives with trailing slashes in paths", async () => {
    using dir = tempDir("trailing-slash-test", {});

    // Create using tar CLI which includes directory entries with trailing slashes
    const srcDir = join(dir, "src");
    await Bun.$`mkdir -p ${srcDir}/a/b`.quiet();
    await Bun.write(join(srcDir, "a/b/file.txt"), "content");
    const tarPath = join(dir, "test.tar");
    await Bun.$`cd ${dir} && tar -cf test.tar src/`.quiet();

    // Extract to memory
    const extracted = await Bun.extract(tarPath);

    // Should have the file (directories might not be in the result)
    expect(extracted["src/a/b/file.txt"]).toBeInstanceOf(Blob);
    expect(await extracted["src/a/b/file.txt"].text()).toBe("content");
  });

  test("extracts large file correctly", async () => {
    const largeContent = "x".repeat(1024 * 1024); // 1MB

    const tarBlob = await Bun.tarball({
      files: {
        "large.txt": largeContent,
      },
    });

    const extracted = await Bun.extract(tarBlob);

    expect(await extracted["large.txt"].text()).toBe(largeContent);
  });

  test("handles empty archive", async () => {
    // Create an archive with no files
    using dir = tempDir("empty-tar-test", {});
    const tarPath = join(dir, "empty.tar");
    await Bun.$`tar -cf ${tarPath} -T /dev/null`.quiet();

    const extracted = await Bun.extract(tarPath);

    expect(Object.keys(extracted)).toHaveLength(0);
  });

  test("validates skipPathComponents range", async () => {
    const tarBlob = await Bun.tarball({
      files: {
        "test.txt": "content",
      },
    });

    // Should reject values > 128
    expect(() =>
      Bun.extract(tarBlob, {
        skipPathComponents: 129,
      }),
    ).toThrow("skipPathComponents must be between 0 and 128");
  });
});

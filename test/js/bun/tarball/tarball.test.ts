import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

describe("Bun.tarball()", () => {
  test("creates tar archive from string content", async () => {
    const blob = await Bun.tarball({
      files: {
        "hello.txt": "hello world",
      },
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/x-tar");
    expect(blob.size).toBeGreaterThan(0);
  });

  test("creates tar from multiple files", async () => {
    const blob = await Bun.tarball({
      files: {
        "file1.txt": "content 1",
        "subdir/file2.txt": "content 2",
        "file3.txt": "content 3",
      },
    });

    expect(blob.size).toBeGreaterThan(0);

    using dir = tempDir("tarball-test", {});
    const tarPath = join(dir, "output.tar");
    await Bun.write(tarPath, blob);

    const { exitCode, stdout } = Bun.spawnSync(["tar", "-tf", tarPath], { stdout: "pipe" });

    expect(exitCode).toBe(0);
    const files = new TextDecoder().decode(stdout).split("\n");
    expect(files).toContain("file1.txt");
    expect(files).toContain("subdir/file2.txt");
    expect(files).toContain("file3.txt");
  });

  test("accepts Blob inputs", async () => {
    const tarBlob = await Bun.tarball({
      files: {
        "file1.txt": new Blob(["content 1"]),
        "file2.txt": new Blob(["content 2"]),
      },
    });

    expect(tarBlob).toBeInstanceOf(Blob);
  });

  test("handles large files", async () => {
    const largeContent = "x".repeat(5 * 1024 * 1024);
    const tarBlob = await Bun.tarball({
      files: { "large.txt": largeContent },
    });

    expect(tarBlob.size).toBeGreaterThan(5 * 1024 * 1024);
  });

  test("extracts correctly with tar CLI and verifies content", async () => {
    const blob = await Bun.tarball({
      files: {
        "readme.txt": "This is a readme file",
        "data/config.json": '{"name":"test","version":"1.0"}',
        "scripts/run.sh": "#!/bin/bash\necho 'Hello World'",
      },
    });

    using dir = tempDir("tarball-extract", {});
    const tarPath = join(dir, "archive.tar");
    await Bun.write(tarPath, blob);

    // Extract the tar file
    const { exitCode } = Bun.spawnSync(["tar", "-xf", tarPath, "-C", String(dir)], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(exitCode).toBe(0);

    // Verify extracted files exist and have correct content
    const readmeContent = await Bun.file(join(dir, "readme.txt")).text();
    expect(readmeContent).toBe("This is a readme file");

    const configContent = await Bun.file(join(dir, "data/config.json")).text();
    expect(configContent).toBe('{"name":"test","version":"1.0"}');

    const scriptContent = await Bun.file(join(dir, "scripts/run.sh")).text();
    expect(scriptContent).toBe("#!/bin/bash\necho 'Hello World'");
  });

  test("creates gzip compressed tar with string format", async () => {
    const blob = await Bun.tarball({
      files: {
        "test.txt": "hello world",
      },
      compress: "gzip",
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/gzip");

    using dir = tempDir("tarball-gzip", {});
    const tarPath = join(dir, "archive.tar.gz");
    await Bun.write(tarPath, blob);

    // Extract with gzip flag
    const { exitCode } = Bun.spawnSync(["tar", "-xzf", tarPath, "-C", String(dir)], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(exitCode).toBe(0);

    const content = await Bun.file(join(dir, "test.txt")).text();
    expect(content).toBe("hello world");
  });

  test("creates gzip compressed tar with level option", async () => {
    const blob = await Bun.tarball({
      files: {
        "data.txt": "x".repeat(1000),
      },
      compress: { type: "gzip", level: 9 },
    });

    expect(blob).toBeInstanceOf(Blob);

    using dir = tempDir("tarball-gzip-level", {});
    const tarPath = join(dir, "archive.tar.gz");
    await Bun.write(tarPath, blob);

    const { exitCode } = Bun.spawnSync(["tar", "-xzf", tarPath, "-C", String(dir)], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(exitCode).toBe(0);

    const content = await Bun.file(join(dir, "data.txt")).text();
    expect(content).toBe("x".repeat(1000));
  });

  test("throws error for invalid compression level", () => {
    expect(() =>
      Bun.tarball({
        files: {
          "test.txt": "hello world",
        },
        compress: { type: "gzip", level: 100 },
      }),
    ).toThrow("compression level must be 0-9");
  });

  test("throws error for negative compression level", () => {
    expect(() =>
      Bun.tarball({
        files: {
          "test.txt": "hello world",
        },
        compress: { type: "gzip", level: -5 },
      }),
    ).toThrow("compression level must be 0-9");
  });

  test("throws error for invalid compress type", () => {
    expect(() =>
      Bun.tarball({
        files: {
          "test.txt": "hello world",
        },
        compress: { type: "bzip2" },
      }),
    ).toThrow("Only 'gzip' compression supported");
  });
});

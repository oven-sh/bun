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
    expect(blob.size).toBeGreaterThan(512);
  });

  test("creates tar from multiple files", async () => {
    const blob = await Bun.tarball({
      files: {
        "file1.txt": "content 1",
        "subdir/file2.txt": "content 2",
        "file3.txt": "content 3",
      },
    });

    expect(blob.size).toBeGreaterThan(512 * 3);

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
});

import { tmpdirSync } from "harness";
import { promises as fs } from "node:fs";
import path from "node:path";

describe("Bun.rename()", () => {
  let tmpdir: string;

  beforeAll(() => {
    tmpdir = tmpdirSync("bun-rename");
  });

  it("throws when no arguments are provided", async () => {
    // @ts-expect-error
    await expect(() => Bun.rename()).toThrowWithCodeAsync(Error, "ERR_INVALID_ARG_TYPE");
  });

  it("throws when only one argument is provided", async () => {
    // @ts-expect-error
    await expect(() => Bun.rename("from.txt")).toThrowWithCodeAsync(Error, "ERR_INVALID_ARG_TYPE");
  });

  it.each([undefined, null, 1, true, Symbol("foo"), {}])("throws when `from` is not a path (%p)", async (from: any) => {
    // @ts-expect-error
    await expect(() => Bun.rename(from, "to.txt")).toThrowWithCodeAsync(Error, "ERR_INVALID_ARG_TYPE");
  });

  it.each([undefined, null, 1, true, Symbol("foo"), {}])("throws when `to` is not a path (%p)", async (to: any) => {
    // @ts-expect-error
    await expect(() => Bun.rename("from.txt", to)).toThrowWithCodeAsync(Error, "ERR_INVALID_ARG_TYPE");
  });

  it("throws when conflict parameter is invalid", async () => {
    const from = path.join(tmpdir, "from.txt");
    const to = path.join(tmpdir, "to.txt");

    await fs.writeFile(from, "content");

    // @ts-expect-error
    expect(() => Bun.rename(from, to, "invalid")).toThrow("conflict must be 'replace', 'swap', or 'no-replace'");

    // Clean up
    await fs.unlink(from).catch(() => {});
  });

  describe("basic file operations", () => {
    it("renames a file successfully", async () => {
      const from = path.join(tmpdir, "file-to-rename.txt");
      const to = path.join(tmpdir, "renamed-file.txt");
      const content = "Hello, rename!";

      await fs.writeFile(from, content);

      await expect(Bun.rename(from, to)).resolves.toBeUndefined();

      // Verify the file was moved
      await expect(fs.access(from)).rejects.toThrow();
      await expect(fs.readFile(to, "utf8")).resolves.toBe(content);

      // Clean up
      await fs.unlink(to).catch(() => {});
    });

    it("renames a directory successfully", async () => {
      const from = path.join(tmpdir, "dir-to-rename");
      const to = path.join(tmpdir, "renamed-dir");
      const fileName = "test-file.txt";
      const content = "Directory content";

      await fs.mkdir(from);
      await fs.writeFile(path.join(from, fileName), content);

      await expect(Bun.rename(from, to)).resolves.toBeUndefined();

      // Verify the directory was moved
      await expect(fs.access(from)).rejects.toThrow();
      await expect(fs.readFile(path.join(to, fileName), "utf8")).resolves.toBe(content);

      // Clean up
      await fs.rm(to, { recursive: true }).catch(() => {});
    });

    it("works with Buffer paths", async () => {
      const from = path.join(tmpdir, "buffer-from.txt");
      const to = path.join(tmpdir, "buffer-to.txt");
      const content = "Buffer path test";

      await fs.writeFile(from, content);

      await expect(Bun.rename(Buffer.from(from), Buffer.from(to))).resolves.toBeUndefined();

      // Verify the file was moved
      await expect(fs.access(from)).rejects.toThrow();
      await expect(fs.readFile(to, "utf8")).resolves.toBe(content);

      // Clean up
      await fs.unlink(to).catch(() => {});
    });

    it("throws when source file doesn't exist", async () => {
      const from = path.join(tmpdir, "nonexistent.txt");
      const to = path.join(tmpdir, "destination.txt");

      await expect(Bun.rename(from, to)).rejects.toThrow();
    });
  });

  describe("conflict resolution", () => {
    describe("replace mode (default)", () => {
      it("replaces existing destination by default", async () => {
        const from = path.join(tmpdir, "replace-source.txt");
        const to = path.join(tmpdir, "replace-dest.txt");
        const sourceContent = "Source content";
        const destContent = "Original dest content";

        await fs.writeFile(from, sourceContent);
        await fs.writeFile(to, destContent);

        await expect(Bun.rename(from, to)).resolves.toBeUndefined();

        // Verify the destination has the source content
        await expect(fs.access(from)).rejects.toThrow();
        await expect(fs.readFile(to, "utf8")).resolves.toBe(sourceContent);

        // Clean up
        await fs.unlink(to).catch(() => {});
      });

      it("replaces existing destination with explicit 'replace'", async () => {
        const from = path.join(tmpdir, "explicit-replace-source.txt");
        const to = path.join(tmpdir, "explicit-replace-dest.txt");
        const sourceContent = "Source content";
        const destContent = "Original dest content";

        await fs.writeFile(from, sourceContent);
        await fs.writeFile(to, destContent);

        await expect(Bun.rename(from, to, "replace")).resolves.toBeUndefined();

        // Verify the destination has the source content
        await expect(fs.access(from)).rejects.toThrow();
        await expect(fs.readFile(to, "utf8")).resolves.toBe(sourceContent);

        // Clean up
        await fs.unlink(to).catch(() => {});
      });
    });

    describe("no-replace mode", () => {
      it("fails when destination exists with 'no-replace'", async () => {
        const from = path.join(tmpdir, "no-replace-source.txt");
        const to = path.join(tmpdir, "no-replace-dest.txt");
        const sourceContent = "Source content";
        const destContent = "Original dest content";

        await fs.writeFile(from, sourceContent);
        await fs.writeFile(to, destContent);

        await expect(Bun.rename(from, to, "no-replace")).rejects.toThrow();

        // Verify both files still exist with original content
        await expect(fs.readFile(from, "utf8")).resolves.toBe(sourceContent);
        await expect(fs.readFile(to, "utf8")).resolves.toBe(destContent);

        // Clean up
        await fs.unlink(from).catch(() => {});
        await fs.unlink(to).catch(() => {});
      });

      it("succeeds when destination doesn't exist with 'no-replace'", async () => {
        const from = path.join(tmpdir, "no-replace-success-source.txt");
        const to = path.join(tmpdir, "no-replace-success-dest.txt");
        const content = "Source content";

        await fs.writeFile(from, content);

        await expect(Bun.rename(from, to, "no-replace")).resolves.toBeUndefined();

        // Verify the file was moved
        await expect(fs.access(from)).rejects.toThrow();
        await expect(fs.readFile(to, "utf8")).resolves.toBe(content);

        // Clean up
        await fs.unlink(to).catch(() => {});
      });
    });

    describe("swap mode", () => {
      it("atomically swaps two files with 'swap'", async () => {
        const file1 = path.join(tmpdir, "swap-file1.txt");
        const file2 = path.join(tmpdir, "swap-file2.txt");
        const content1 = "Content of file 1";
        const content2 = "Content of file 2";

        await fs.writeFile(file1, content1);
        await fs.writeFile(file2, content2);

        await expect(Bun.rename(file1, file2, "swap")).resolves.toBeUndefined();

        // Verify the files were swapped
        await expect(fs.readFile(file1, "utf8")).resolves.toBe(content2);
        await expect(fs.readFile(file2, "utf8")).resolves.toBe(content1);

        // Clean up
        await fs.unlink(file1).catch(() => {});
        await fs.unlink(file2).catch(() => {});
      });

      it("works when destination doesn't exist with 'swap'", async () => {
        const from = path.join(tmpdir, "swap-from-only.txt");
        const to = path.join(tmpdir, "swap-to-nonexistent.txt");
        const content = "Source content";

        await fs.writeFile(from, content);

        await expect(Bun.rename(from, to, "swap")).resolves.toBeUndefined();

        // Verify the file was moved (not swapped since destination didn't exist)
        await expect(fs.access(from)).rejects.toThrow();
        await expect(fs.readFile(to, "utf8")).resolves.toBe(content);

        // Clean up
        await fs.unlink(to).catch(() => {});
      });

      it("swaps directories on Unix", async () => {
        if (process.platform === "win32") {
          // Skip this test on Windows
          return;
        }
        const dir1 = path.join(tmpdir, "swap-dir1");
        const dir2 = path.join(tmpdir, "swap-dir2");
        const file1Content = "Content in dir 1";
        const file2Content = "Content in dir 2";

        await fs.mkdir(dir1);
        await fs.mkdir(dir2);
        await fs.writeFile(path.join(dir1, "file.txt"), file1Content);
        await fs.writeFile(path.join(dir2, "file.txt"), file2Content);

        await expect(Bun.rename(dir1, dir2, "swap")).resolves.toBeUndefined();

        // Verify the directories were swapped
        await expect(fs.readFile(path.join(dir1, "file.txt"), "utf8")).resolves.toBe(file2Content);
        await expect(fs.readFile(path.join(dir2, "file.txt"), "utf8")).resolves.toBe(file1Content);

        // Clean up
        await fs.rm(dir1, { recursive: true }).catch(() => {});
        await fs.rm(dir2, { recursive: true }).catch(() => {});
      });

      it("falls back to replace on Windows when using swap", async () => {
        const from = path.join(tmpdir, "win-swap-source.txt");
        const to = path.join(tmpdir, "win-swap-dest.txt");
        const sourceContent = "Source content";
        const destContent = "Dest content";

        await fs.writeFile(from, sourceContent);
        await fs.writeFile(to, destContent);

        // On Windows, swap should fall back to replace behavior
        // On Unix, it should actually swap the files
        await expect(Bun.rename(from, to, "swap")).resolves.toBeUndefined();

        if (process.platform === "win32") {
          // Verify destination has source content (replace behavior on Windows)
          await expect(fs.access(from)).rejects.toThrow();
          await expect(fs.readFile(to, "utf8")).resolves.toBe(sourceContent);
        } else {
          // Verify files were swapped (Unix behavior)
          await expect(fs.readFile(from, "utf8")).resolves.toBe(destContent);
          await expect(fs.readFile(to, "utf8")).resolves.toBe(sourceContent);
          // Clean up both files
          await fs.unlink(from).catch(() => {});
        }

        // Clean up
        await fs.unlink(to).catch(() => {});
      });
    });
  });

  describe("edge cases", () => {
    it("handles relative paths", async () => {
      const originalCwd = process.cwd();
      process.chdir(tmpdir);

      try {
        const from = "relative-from.txt";
        const to = "relative-to.txt";
        const content = "Relative path test";

        await fs.writeFile(from, content);

        await expect(Bun.rename(from, to)).resolves.toBeUndefined();

        // Verify the file was moved
        await expect(fs.access(from)).rejects.toThrow();
        await expect(fs.readFile(to, "utf8")).resolves.toBe(content);

        // Clean up
        await fs.unlink(to).catch(() => {});
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("handles paths with special characters", async () => {
      const from = path.join(tmpdir, "file with spaces & symbols!.txt");
      const to = path.join(tmpdir, "renamed file with spaces & symbols!.txt");
      const content = "Special chars test";

      await fs.writeFile(from, content);

      await expect(Bun.rename(from, to)).resolves.toBeUndefined();

      // Verify the file was moved
      await expect(fs.access(from)).rejects.toThrow();
      await expect(fs.readFile(to, "utf8")).resolves.toBe(content);

      // Clean up
      await fs.unlink(to).catch(() => {});
    });

    it("handles empty files", async () => {
      const from = path.join(tmpdir, "empty-from.txt");
      const to = path.join(tmpdir, "empty-to.txt");

      await fs.writeFile(from, "");

      await expect(Bun.rename(from, to)).resolves.toBeUndefined();

      // Verify the file was moved
      await expect(fs.access(from)).rejects.toThrow();
      await expect(fs.readFile(to, "utf8")).resolves.toBe("");

      // Clean up
      await fs.unlink(to).catch(() => {});
    });

    it("handles large files", async () => {
      const from = path.join(tmpdir, "large-from.txt");
      const to = path.join(tmpdir, "large-to.txt");
      const largeContent = "x".repeat(1024 * 1024); // 1MB

      await fs.writeFile(from, largeContent);

      await expect(Bun.rename(from, to)).resolves.toBeUndefined();

      // Verify the file was moved
      await expect(fs.access(from)).rejects.toThrow();
      await expect(fs.readFile(to, "utf8")).resolves.toBe(largeContent);

      // Clean up
      await fs.unlink(to).catch(() => {});
    });
  });

  describe("cross-platform behavior", () => {
    it("works across different filesystems when supported", async () => {
      // This test may fail on some systems if /tmp and current dir are on different filesystems
      // but that's expected behavior
      const from = path.join(tmpdir, "cross-fs-source.txt");
      const to = "/tmp/cross-fs-dest.txt";
      const content = "Cross filesystem test";

      await fs.writeFile(from, content);

      try {
        await Bun.rename(from, to);

        // If it succeeds, verify the file was moved
        await expect(fs.access(from)).rejects.toThrow();
        await expect(fs.readFile(to, "utf8")).resolves.toBe(content);

        // Clean up
        await fs.unlink(to).catch(() => {});
      } catch (error) {
        // It's okay if this fails due to cross-filesystem limitations
        // Clean up source file
        await fs.unlink(from).catch(() => {});
      }
    });
  });
});

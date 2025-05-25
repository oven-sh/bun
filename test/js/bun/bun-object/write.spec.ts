import type { BunFile } from "bun";
import { tmpdirSync } from "harness";
import { constants, promises as fs } from "node:fs";
import path from "node:path";

// 0o644
const default_mode = constants.S_IWUSR | constants.S_IRUSR | constants.S_IRGRP | constants.S_IROTH;

describe("Bun.write()", () => {
  it("Throws when no arguments are provided", async () => {
    // @ts-expect-error
    await expect(() => Bun.write()).toThrowWithCodeAsync(Error, "ERR_INVALID_ARG_TYPE");
  });
  it.each([undefined, null, /* 1, */ true, Symbol("foo"), {}])(
    "Throws when `destination` is not a path or blob-y thing (%p)",
    async (destination: any) => {
      await expect(() => Bun.write(destination, "foo")).toThrowWithCodeAsync(Error, "ERR_INVALID_ARG_TYPE");
    },
  );

  // FIXME
  it.failing("Throws when `destination` is a number ", async () => {
    // @ts-expect-error
    await expect(() => Bun.write(1, "foo 1")).toThrowWithCodeAsync(Error, "ERR_INVALID_ARG_TYPE");
    // @ts-expect-error
    await expect(() => Bun.write(0, "foo 0")).toThrowWithCodeAsync(Error, "ERR_INVALID_ARG_TYPE");
    // @ts-expect-error
    await expect(() => Bun.write(-10, "foo -10")).toThrowWithCodeAsync(Error, "ERR_INVALID_ARG_TYPE");
  });

  // NOTE: if/when we ban fds, this will become ERR_INVALID_ARG_TYPE. When that
  // happens, delete or update this test
  it("Throws when given a negative number", () => {
    // @ts-expect-error
    expect(() => Bun.write(-1, "foo")).toThrow(RangeError);
  });

  it.each(["foo", ""])("Cannot write to readonly Blobs", async input => {
    var blob = new Blob([new Uint8Array([0, 0, 0, 0])]);
    await expect(() => Bun.write(blob as Bun.BunFile, input)).toThrowWithCodeAsync(Error, "ERR_INVALID_ARG_TYPE");
  });
});

describe("Bun.write() on file paths", () => {
  let dir: string;

  beforeAll(() => {
    dir = tmpdirSync("bun-write");
  });

  afterAll(async () => {
    await fs.rmdir(dir, { recursive: true });
  });

  describe("Given a path to a file in an existing directory", () => {
    let filepath: string;

    beforeEach(async () => {
      filepath = path.join(dir, "test-file.txt");
    });

    afterEach(async () => {
      await fs.unlink(filepath).catch(() => {});
    });

    describe("When the file does not exist", () => {
      const content = "Hello, world!";

      it("When content is not empty, creates the file and writes it", async () => {
        const result = await Bun.write(filepath, content);
        expect(result).toBe(content.length);
        expect(await fs.readFile(filepath, "utf-8")).toBe(content);
      });

      it("When content is empty, creates the file with default permissions and writes it", async () => {
        const result = await Bun.write(filepath, "");
        expect(result).toBe(0);
        expect(await fs.readFile(filepath, "utf-8")).toBe("");
        const stats = await fs.stat(filepath);
        expect(stats.mode & default_mode).toBe(default_mode);
        expect(stats.mode & constants.S_IFDIR).toBe(0); // not a directory
      });

      it("When options.createPath is false, creates the file with default permissions and writes it", async () => {
        const result = await Bun.write(filepath, content, { createPath: false });
        expect(result).toBe(content.length);
        expect(await fs.readFile(filepath, "utf-8")).toBe(content);
        const stats = await fs.stat(filepath);
        expect(stats.mode & default_mode).toBe(default_mode);
        expect(stats.mode & constants.S_IFDIR).toBe(0); // not a directory
      });
    }); // </When the file does not exist>

    describe("When the file exists and has content", () => {
      beforeEach(async () => {
        await fs.writeFile(filepath, "Hello, world!");
      });

      it.each(["", "Foo Bar"])("Writing '%s' overwrites the file", async content => {
        const result = await Bun.write(filepath, content);
        expect(result).toBe(content.length);
        expect(await fs.readFile(filepath, "utf-8")).toBe(content);
      });
    }); // </When the file exists and has content>
  }); // </Given a path to a file in an existing directory>

  describe("Given a path to a file in a non-existent directory", () => {
    let filepath: string;
    const rootdir = path.join(dir, "foo");

    beforeEach(async () => {
      filepath = path.join(rootdir, "bar/baz", "test-file.txt");
    });
    afterEach(async () => {
      await fs.rmdir(rootdir, { recursive: true }).catch(() => {});
    });

    describe("When no options are provided", () => {
      describe("When a non-empty string is written", () => {
        const content = "Hello, world!";
        beforeEach(async () => {
          await Bun.write(filepath, content);
        });
        it("Recursively creates the directory", async () => {
          // FIXME: should be undefined, not null
          expect(await fs.access(rootdir, constants.F_OK)).toBeFalsy();
          expect(await fs.access(path.dirname(filepath), constants.F_OK)).toBeFalsy();
        });

        it("Creates a file with the provided content", async () => {
          expect(await fs.readFile(filepath, "utf-8")).toBe(content);
        });

        it("Creates a file with default permissions", async () => {
          const stats = await fs.stat(filepath);
          expect(stats.mode & default_mode).toBe(default_mode);
          expect(stats.mode & constants.S_IFDIR).toBe(0); // not a directory
        });
      }); // </When a non-empty string is written>

      it("When an empty string is written, recursively creates the directory and writes the file", async () => {
        const result = await Bun.write(filepath, "");
        expect(result).toBe(0);
        expect(await fs.readFile(filepath, "utf-8")).toBe("");
      });
    }); // </When no options are provided>

    describe("When options.createPath is false", () => {
      const options = { createPath: false };

      it.each(["", "Hello, world!"])("When '%s' is written, throws ENOENT", async content => {
        await expect(() => Bun.write(filepath, content, options)).toThrowWithCodeAsync(Error, "ENOENT");
      });
    }); // </When options.createPath is false>
  });
}); // </Bun.write() on files>

describe("Bun.write() on BunFiles", () => {
  let dir: string;

  beforeAll(() => {
    dir = tmpdirSync("bun-write-bunfile");
  });

  afterAll(async () => {
    await fs.rmdir(dir, { recursive: true });
  });

  describe("Given a text file that exists", () => {
    let file: BunFile;
    let textFilePath: string;

    beforeEach(async () => {
      textFilePath = path.join(dir, "test-file.txt");
      await fs.writeFile(textFilePath, "Hello, world!");
      file = Bun.file(textFilePath);
    });

    afterEach(async () => {
      await fs.rm(textFilePath).catch(() => {});
    });

    it.each(["", "foo"])("Writing %s to the file overwrites the existing content", async text => {
      await Bun.write(file, text);
      const content = await file.text();
      // Ensure the content matches what was written
      expect(content).toEqual(text);
      // Ensure content was saved to disk, not just `file`'s in-memory cache
      expect(await fs.readFile(textFilePath, "utf8")).toEqual(text);
    });
  }); // Given a text file that exists
}); // </Bun.write() on BunFiles>

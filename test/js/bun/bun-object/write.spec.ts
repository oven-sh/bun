import type { BunFile } from "bun";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir, tmpdirSync } from "harness";
import { chmodSync, constants, existsSync, promises as fs, readFileSync, statSync } from "node:fs";
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
  console.log("%%BUNWRITE ON FILE PATHS%%");
  let dir: string;

  beforeAll(() => {
    console.log("%%BUNWRITE ON FILE PATHS%% BEFORE ALL");
    dir = tmpdirSync("bun-write");
  });

  afterAll(async () => {
    console.log("%%BUNWRITE ON FILE PATHS%% AFTER ALL");
    await fs.rm(dir, { recursive: true, force: true });
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

      it("When content is an empty Blob, creates the file with default permissions", async () => {
        const result = await Bun.write(filepath, new Blob([]));
        expect(result).toBe(0);
        expect(await fs.readFile(filepath, "utf-8")).toBe("");
        const stats = await fs.stat(filepath);
        expect(stats.mode & default_mode).toBe(default_mode);
        expect(stats.mode & constants.S_IFDIR).toBe(0); // not a directory
      });

      it("When content is an empty Blob and options.createPath is false, creates the file with default permissions", async () => {
        const result = await Bun.write(filepath, new Blob([]), { createPath: false });
        expect(result).toBe(0);
        expect(await fs.readFile(filepath, "utf-8")).toBe("");
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

      it.each([
        ["no options", undefined],
        ["options.createPath false", { createPath: false }],
      ])("Writing an empty Blob with %s empties the file", async (_, options) => {
        const result = await Bun.write(filepath, new Blob([]), options);
        expect(result).toBe(0);
        expect(await fs.readFile(filepath, "utf-8")).toBe("");
      });
    }); // </When the file exists and has content>
  }); // </Given a path to a file in an existing directory>

  describe("Given a path to a file in a non-existent directory", () => {
    console.log("%%BUNWRITE ON FILE PATHS%% GIVEN A PATH TO A FILE IN A NON-EXISTENT DIRECTORY");
    let filepath: string;
    let rootdir: string;
    beforeAll(() => (rootdir = path.join(dir, "foo")));

    beforeEach(async () => {
      filepath = path.join(rootdir, "bar/baz", "test-file.txt");
    });
    afterEach(async () => {
      await fs.rm(rootdir, { recursive: true, force: true }).catch(() => {});
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

      it("When an empty Blob is written, recursively creates the directory and writes the file", async () => {
        const result = await Bun.write(filepath, new Blob([]));
        expect(result).toBe(0);
        expect(await fs.readFile(filepath, "utf-8")).toBe("");
      });
    }); // </When no options are provided>

    describe("When options.createPath is false", () => {
      const options = { createPath: false };

      it.each(["", "Hello, world!"])("When '%s' is written, throws ENOENT", async content => {
        await expect(() => Bun.write(filepath, content, options)).toThrowWithCodeAsync(Error, "ENOENT");
      });

      it("When an empty Blob is written, throws ENOENT from open and does not create the directory", async () => {
        await expect(Bun.write(filepath, new Blob([]), options)).rejects.toMatchObject({
          code: "ENOENT",
          syscall: "open",
          path: filepath,
        });
        await expect(fs.access(rootdir, constants.F_OK)).rejects.toMatchObject({ code: "ENOENT" });
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
    await fs.rm(dir, { recursive: true, force: true });
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

// An empty Blob, Response, Request or array has no bytes to write, so Bun only opens the destination.
describe.concurrent("Bun.write() of an empty source", () => {
  // JS for a child that makes one kind of source. `n` is the byte count.
  const sources = {
    string: `"x".slice(0, n)`,
    Uint8Array: `new Uint8Array(n)`,
    Blob: `new Blob(n ? ["x"] : [])`,
    "Blob slice": `new Blob(["xy"]).slice(1, 1 + n)`,
    array: `n ? ["x"] : []`,
    Response: `new Response("x".slice(0, n))`,
    "Response with no body": `new Response(n ? "x" : null)`,
    "Response of a stream": `new Response(stream(n))`,
    Request: `new Request("http://localhost/", { method: "POST", body: "x".slice(0, n) })`,
    ReadableStream: `stream(n)`,
    "Bun.file": `Bun.file(n + "-byte-source.bin")`,
    fetch: `fetch(server.url + n)`,
  };

  // The source is written with no bytes and with one byte to each kind of destination. The byte count
  // must not change the outcome. The child runs in the temp dir, so a name is bare.
  it.each(Object.entries(sources))(
    "has the outcome of a one-byte source for each destination: %s",
    async (_, source) => {
      using dir = tempDir("bun-write-empty-source", {
        sub: {},
        "0-byte-source.bin": "",
        "1-byte-source.bin": "x",
      });
      const fixture = `
        const fs = require("node:fs");
        using server = Bun.serve({
          port: 0,
          fetch: req => (req.url.endsWith("/0") ? new Response(null, { status: 204 }) : new Response("x")),
        });
        const stream = n =>
          new ReadableStream({
            start(controller) {
              if (n) controller.enqueue(new Uint8Array(n));
              controller.close();
            },
          });
        const makeSource = n => (${source});
        const noCreatePath = { createPath: false };
        // Each destination takes a fresh name. It returns the path and the write.
        const destinations = {
          "bare name": name => [name, source => Bun.write(name, source)],
          "bare name, createPath: false": name => [name, source => Bun.write(name, source, noCreatePath)],
          "in a directory, createPath: false": name => [
            "sub/" + name,
            source => Bun.write("sub/" + name, source, noCreatePath),
          ],
          "BunFile.write(), createPath: false": name => [name, source => Bun.file(name).write(source, noCreatePath)],
          // A BunFile that knows it is a regular file sends an empty string down the route of an empty Blob.
          "BunFile that saw a file there, createPath: false": name => {
            fs.writeFileSync(name, "x");
            const file = Bun.file(name);
            void file.size;
            fs.rmSync(name);
            return [name, source => Bun.write(file, source, noCreatePath)];
          },
          "existing file": name => (fs.writeFileSync(name, "stale contents"), [name, source => Bun.write(name, source)]),
          "missing directory": name => [
            "made/" + name + "/file.bin",
            source => Bun.write("made/" + name + "/file.bin", source),
          ],
          "missing directory, createPath: false": name => [
            "missing/" + name + "/file.bin",
            source => Bun.write("missing/" + name + "/file.bin", source, noCreatePath),
          ],
        };
        const table = {};
        let id = 0;
        for (const [n, label] of [[0, "empty"], [1, "one byte"]]) {
          const row = (table[label] = {});
          for (const [where, destination] of Object.entries(destinations)) {
            const [path, write] = destination("dest-" + id++ + ".bin");
            const outcome = await Promise.resolve(makeSource(n))
              .then(write)
              .then(written => "wrote " + written, e => e.code);
            row[where] = outcome + ", " + (fs.existsSync(path) ? fs.statSync(path).size + " on disk" : "no file");
          }
        }
        console.log(JSON.stringify(table));
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const row = (n: number) => ({
        "bare name": `wrote ${n}, ${n} on disk`,
        "bare name, createPath: false": `wrote ${n}, ${n} on disk`,
        "in a directory, createPath: false": `wrote ${n}, ${n} on disk`,
        "BunFile.write(), createPath: false": `wrote ${n}, ${n} on disk`,
        "BunFile that saw a file there, createPath: false": `wrote ${n}, ${n} on disk`,
        "existing file": `wrote ${n}, ${n} on disk`,
        "missing directory": `wrote ${n}, ${n} on disk`,
        "missing directory, createPath: false": "ENOENT, no file",
      });
      expect(JSON.parse(stdout)).toEqual({ empty: row(0), "one byte": row(1) });
      expect(existsSync(path.join(String(dir), "missing"))).toBe(false);
      expect(exitCode).toBe(0);
    },
  );

  // The child runs in the temp dir. An open that is not closed shows in its descriptor count.
  it.skipIf(isWindows)("reports the error of the open and leaves no descriptor open", async () => {
    using dir = tempDir("bun-write-empty-source-errors", { "file.bin": "stale contents" });
    const fixture = `
      const fs = require("node:fs");
      const outcome = (path, options) =>
        Bun.write(path, new Blob([]), options).then(written => "wrote " + written, e => e.code + " from " + e.syscall);
      const descriptors = () => fs.readdirSync(process.platform === "linux" ? "/proc/self/fd" : "/dev/fd").length;
      fs.symlinkSync("no-such-dir/target.bin", "dangling.bin");
      await outcome("warm-up.bin");
      const before = descriptors();
      const results = {
        "a path below a file": await outcome("file.bin/child.bin"),
        "a dangling link into a missing directory": await outcome("dangling.bin"),
        "a missing directory, createPath: false": await outcome("missing/file.bin", { createPath: false }),
        "/dev/null": await outcome("/dev/null"),
        "a file that exists": await outcome("file.bin"),
      };
      results["descriptors left open"] = descriptors() - before;
      results["directories made"] = ["no-such-dir", "missing"].filter(name => fs.existsSync(name));
      console.log(JSON.stringify(results));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      "a path below a file": "ENOTDIR from open",
      "a dangling link into a missing directory": "ENOENT from open",
      "a missing directory, createPath: false": "ENOENT from open",
      "/dev/null": "wrote 0",
      "a file that exists": "wrote 0",
      "descriptors left open": 0,
      "directories made": [],
    });
    expect(exitCode).toBe(0);
  });

  // Runs in a child: an open of a FIFO that waits for a reader blocks the JS thread,
  // and no timeout in this process can interrupt that.
  it.skipIf(isWindows)("rejects a FIFO with no reader and does not wait for one", async () => {
    using dir = tempDir("bun-write-empty-source-fifo", {});
    const fifo = path.join(String(dir), "fifo");
    expect(Bun.spawnSync({ cmd: ["mkfifo", fifo] }).exitCode).toBe(0);
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `console.log(await Bun.write(process.argv[1], new Blob([])).catch(e => e.code + " from " + e.syscall));`,
        fifo,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("ENXIO from open\n");
    expect(exitCode).toBe(0);
  });

  // The file exists, so the error is not ENOENT. The file is read-only on Windows and `uchg` on macOS.
  // Linux needs root to make a file that its owner cannot open, so it is skipped.
  it.skipIf(!isWindows && !isMacOS)("rejects with EPERM for a file that refuses the open", async () => {
    using dir = tempDir("bun-write-empty-source-eperm", { "locked.bin": "keep" });
    const locked = path.join(String(dir), "locked.bin");
    const lock = (on: boolean) => {
      if (isWindows) return chmodSync(locked, on ? 0o444 : 0o644);
      expect(Bun.spawnSync({ cmd: ["chflags", on ? "uchg" : "nouchg", locked] }).exitCode).toBe(0);
    };
    const outcome = (source: Blob, options?: { createPath: boolean }) =>
      Bun.write(locked, source, options).then(
        written => "wrote " + written,
        e => e.code + " from " + e.syscall,
      );
    lock(true);
    try {
      expect({
        empty: await outcome(new Blob([])),
        "empty, createPath: false": await outcome(new Blob([]), { createPath: false }),
        "one byte": await outcome(new Blob(["x"])),
      }).toEqual({
        empty: "EPERM from open",
        "empty, createPath: false": "EPERM from open",
        "one byte": "EPERM from open",
      });
    } finally {
      lock(false);
    }
    expect(readFileSync(locked, "utf8")).toBe("keep");
  });

  // A file that the write creates gets `mode`. A file that exists keeps its mode.
  // Windows has no such mode: a file is writable or read-only there (see the next test).
  it.skipIf(isWindows)("applies mode only to a file that it creates", async () => {
    using dir = tempDir("bun-write-empty-source-mode", { "existing.bin": "stale contents" });
    const existing = path.join(String(dir), "existing.bin");
    const created = path.join(String(dir), "created.bin");
    chmodSync(existing, 0o640);
    expect({
      existing: await Bun.write(existing, new Blob([]), { mode: 0o600 }),
      created: await Bun.write(created, new Blob([]), { createPath: false, mode: 0o600 }),
    }).toEqual({ existing: 0, created: 0 });
    const onDisk = (file: string) => ({ size: statSync(file).size, mode: (statSync(file).mode & 0o777).toString(8) });
    expect({ existing: onDisk(existing), created: onDisk(created) }).toEqual({
      existing: { size: 0, mode: "640" },
      created: { size: 0, mode: "600" },
    });
  });

  // On Windows each empty string takes this route, and a mode with no write bit would make the file read-only.
  it.skipIf(!isWindows)("creates a writable file on Windows for a mode with no write bit", async () => {
    using dir = tempDir("bun-write-empty-source-mode-windows", {});
    const created = path.join(String(dir), "created.bin");
    expect(await Bun.write(created, "", { mode: 0o444 })).toBe(0);
    expect(statSync(created).mode & 0o200).toBe(0o200);
  });
}); // </Bun.write() of an empty source>

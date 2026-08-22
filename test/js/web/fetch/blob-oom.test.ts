import { setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { truncateSync, unlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, tempDirWithFiles } from "harness";
import os from "node:os";
import path from "path";
describe("Memory", () => {
  beforeAll(() => {
    setSyntheticAllocationLimitForTesting(128 * 1024 * 1024);
  });
  afterEach(() => {
    Bun.gc(true);
  });

  describe("Blob", () => {
    let buf: ArrayBuffer;
    beforeAll(() => {
      buf = new ArrayBuffer(Math.floor(64 * 1024 * 1024));
    });

    test(".json() should throw an OOM without crashing the process.", () => {
      const array = [buf, buf, buf, buf, buf, buf, buf, buf, buf];
      expect(async () => await new Blob(array).json()).toThrow(
        "Cannot parse a JSON string longer than 2147483647 characters",
      );
    });

    test(".text() should throw an OOM without crashing the process.", () => {
      const array = [buf, buf, buf, buf, buf, buf, buf, buf, buf];
      expect(async () => await new Blob(array).text()).toThrow(
        "Cannot create a string longer than 2147483647 characters",
      );
    });

    test(".bytes() should throw an OOM without crashing the process.", () => {
      const array = [buf, buf, buf, buf, buf, buf, buf, buf, buf];
      expect(async () => await new Blob(array).bytes()).toThrow("Out of memory");
    });

    test(".arrayBuffer() should NOT throw an OOM.", () => {
      const array = [buf, buf, buf, buf, buf, buf, buf, buf, buf];
      expect(async () => await new Blob(array).arrayBuffer()).not.toThrow();
    });
  });

  describe("Response", () => {
    let blob: Blob;
    beforeAll(() => {
      const buf = new ArrayBuffer(Math.floor(64 * 1024 * 1024));
      blob = new Blob([buf, buf, buf, buf, buf, buf, buf, buf, buf]);
    });
    afterAll(() => {
      blob = undefined;
    });

    test(".text() should throw an OOM without crashing the process.", () => {
      expect(async () => await new Response(blob).text()).toThrow(
        "Cannot create a string longer than 2147483647 characters",
      );
    });

    test(".bytes() should throw an OOM without crashing the process.", async () => {
      expect(async () => await new Response(blob).bytes()).toThrow("Out of memory");
    });

    test(".arrayBuffer() should NOT throw an OOM.", async () => {
      expect(async () => await new Response(blob).arrayBuffer()).not.toThrow();
    });

    test(".json() should throw an OOM without crashing the process.", async () => {
      expect(async () => await new Response(blob).json()).toThrow(
        "Cannot parse a JSON string longer than 2147483647 characters",
      );
    });
  });

  describe("Request", () => {
    let blob: Blob;
    beforeAll(() => {
      const buf = new ArrayBuffer(Math.floor(64 * 1024 * 1024));
      blob = new Blob([buf, buf, buf, buf, buf, buf, buf, buf, buf]);
    });
    afterAll(() => {
      blob = undefined;
    });

    test(".text() should throw an OOM without crashing the process.", () => {
      expect(async () => await new Request("http://localhost:3000", { body: blob }).text()).toThrow(
        "Cannot create a string longer than 2147483647 characters",
      );
    });

    test(".bytes() should throw an OOM without crashing the process.", async () => {
      expect(async () => await new Request("http://localhost:3000", { body: blob }).bytes()).toThrow("Out of memory");
    });

    test(".arrayBuffer() should NOT throw an OOM.", async () => {
      expect(async () => await new Request("http://localhost:3000", { body: blob }).arrayBuffer()).not.toThrow();
    });

    test(".json() should throw an OOM without crashing the process.", async () => {
      expect(async () => await new Request("http://localhost:3000", { body: blob }).json()).toThrow(
        "Cannot parse a JSON string longer than 2147483647 characters",
      );
    });
  });
});

describe("Bun.file", () => {
  let tmpFile;
  beforeAll(async () => {
    const buf = Buffer.allocUnsafe(8 * 1024 * 1024);
    const tmpDir = tempDirWithFiles("file-oom", {
      "file.txt": buf,
    });
    tmpFile = path.join(tmpDir, "file.txt");
  });
  beforeEach(() => {
    setSyntheticAllocationLimitForTesting(4 * 1024 * 1024);
  });
  afterEach(() => {
    setSyntheticAllocationLimitForTesting(128 * 1024 * 1024);
  });
  afterAll(() => {
    try {
      unlinkSync(tmpFile);
    } catch (err) {
      console.error(err);
    }
  });

  test("text() should throw an OOM without crashing the process.", () => {
    expect(async () => await Bun.file(tmpFile).text()).toThrow();
  });

  test("bytes() should throw an OOM without crashing the process.", () => {
    expect(async () => await Bun.file(tmpFile).bytes()).toThrow();
  });

  test("json() should throw an OOM without crashing the process.", () => {
    expect(async () => await Bun.file(tmpFile).json()).toThrow();
  });

  test("arrayBuffer() should NOT throw an OOM.", () => {
    expect(async () => await Bun.file(tmpFile).arrayBuffer()).not.toThrow();
  });
});

// Byte lengths in [2^31, 2^32) used to abort the process instead of throwing:
// the Rust-side guards in front of WTF string construction only checked the
// synthetic allocation limit (2^32 - 1 by default) and missed
// WTF::StringImpl::MaxLength (2^31 - 1), tripping
// "ASSERTION FAILED: data.size() <= MaxLength" / a RELEASE_ASSERT in
// StringImplShape. Lengths >= 2^32 were already caught. These allocate a real
// 2 GiB, so each case runs in a subprocess to keep the peak away from the
// test runner, and the block skips on small machines (same gate as
// buffer.test.js's 4 GiB case).
describe.skipIf(os.totalmem() < 10 * 1024 ** 3)("byte sources at the 2 GiB string limit", () => {
  test("Blob.text() and Blob.json() at 2^31 bytes throw ERR_STRING_TOO_LONG instead of aborting", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const results = [];
          const report = e => ({ name: e.name, code: e.code, message: e.message });
          const blob = new Blob([new Uint8Array(2 ** 31)]);
          await blob.text().then(() => results.push("TEXT_UNEXPECTED_SUCCESS"), e => results.push(report(e)));
          await blob.json().then(() => results.push("JSON_UNEXPECTED_SUCCESS"), e => results.push(report(e)));
          console.log(JSON.stringify(results));
          `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(JSON.parse(stdout.trim() || JSON.stringify({ stdout, stderr, exitCode }))).toEqual([
      {
        name: "Error",
        code: "ERR_STRING_TOO_LONG",
        message: "Cannot create a string longer than 2147483647 characters",
      },
      {
        name: "Error",
        code: "ERR_STRING_TOO_LONG",
        message: "Cannot parse a JSON string longer than 2147483647 characters",
      },
    ]);
    expect(exitCode).toBe(0);
  }, 90_000);

  // A typed-array body is stored as an InternalBlob (bytes copied into a Vec),
  // which converts to a string through Internal::to_string_owned rather than
  // the Blob store path above, so it exercises a different guard call site.
  test("Response(typedArray).text() and .json() at 2^31 bytes throw ERR_STRING_TOO_LONG instead of aborting", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const results = [];
          const report = e => ({ name: e.name, code: e.code, message: e.message });
          const bytes = new Uint8Array(2 ** 31);
          await new Response(bytes).text().then(() => results.push("TEXT_UNEXPECTED_SUCCESS"), e => results.push(report(e)));
          await new Response(bytes).json().then(() => results.push("JSON_UNEXPECTED_SUCCESS"), e => results.push(report(e)));
          console.log(JSON.stringify(results));
          `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(JSON.parse(stdout.trim() || JSON.stringify({ stdout, stderr, exitCode }))).toEqual([
      {
        name: "Error",
        code: "ERR_STRING_TOO_LONG",
        message: "Cannot create a string longer than 2147483647 characters",
      },
      {
        name: "Error",
        code: "ERR_STRING_TOO_LONG",
        message: "Cannot parse a JSON string longer than 2147483647 characters",
      },
    ]);
    expect(exitCode).toBe(0);
  });

  test("Bun.file().text() at 2^31 bytes throws ERR_STRING_TOO_LONG instead of aborting", async () => {
    using dir = tempDir("blob-2gib", {});
    const file = path.join(String(dir), "big.txt");
    // Sparse where the filesystem supports it; reads back as 'x' + NUL bytes.
    writeFileSync(file, "x");
    truncateSync(file, 2 ** 31);
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const results = [];
          const report = e => ({ name: e.name, code: e.code, message: e.message });
          await Bun.file(${JSON.stringify(file)}).text().then(() => results.push("UNEXPECTED_SUCCESS"), e => results.push(report(e)));
          console.log(JSON.stringify(results));
          `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(JSON.parse(stdout.trim() || JSON.stringify({ stdout, stderr, exitCode }))).toEqual([
      {
        name: "Error",
        code: "ERR_STRING_TOO_LONG",
        message: "Cannot create a string longer than 2147483647 characters",
      },
    ]);
    expect(exitCode).toBe(0);
    // Reads 2 GiB through the page cache; measured right at the default 5s
    // ceiling under load.
  }, 90_000);
});

// An ArrayBuffer can hold at most 2^32 bytes (JSC's MAX_ARRAY_BUFFER_SIZE). The
// file path hands the bytes it read to JSC without a copy; converting the
// length through u32 on the way panicked at exactly 2^32, and JSC aborts when
// it is asked to adopt more than that. The file is sparse, but each case still
// reads a real 4 GiB into the child (about 6 seconds in a debug build, all of
// it page faults), so it runs in a subprocess, gets a long timeout, and skips
// on small machines like the 2 GiB cases above. On Windows the file reader
// itself rejects files of 2^32 bytes or more with ENOMEM (read_file.rs,
// ReadFileUV), so neither case reaches the ArrayBuffer hand-off there.
describe.skipIf(isWindows || os.totalmem() < 10 * 1024 ** 3)(
  "Bun.file().arrayBuffer() at the 4 GiB ArrayBuffer limit",
  () => {
    async function readSparseFileAsArrayBuffer(size: number) {
      using dir = tempDir("blob-4gib", {});
      const file = path.join(String(dir), "big.bin");
      // 'x' followed by a hole, which reads back as NUL bytes. Nothing is written
      // after the truncate: on NTFS that would zero-fill the whole file on disk.
      writeFileSync(file, "x");
      truncateSync(file, size);
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const report = buf => {
            const view = new DataView(buf);
            return { byteLength: buf.byteLength, first: view.getUint8(0), last: view.getUint8(buf.byteLength - 1) };
          };
          const result = await Bun.file(${JSON.stringify(file)}).arrayBuffer().then(report, e => ({ error: { name: e.name, message: e.message } }));
          console.log(JSON.stringify(result));
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return JSON.parse(stdout.trim() || JSON.stringify({ stdout, stderr, exitCode, signalCode: proc.signalCode }));
    }

    test("a file of exactly 2^32 bytes is returned whole", async () => {
      expect(await readSparseFileAsArrayBuffer(2 ** 32)).toEqual({
        byteLength: 2 ** 32,
        first: "x".charCodeAt(0),
        last: 0,
      });
    }, 120_000);

    test("a file of 2^32 + 1 bytes rejects with the RangeError that new ArrayBuffer() throws for that size", async () => {
      expect(await readSparseFileAsArrayBuffer(2 ** 32 + 1)).toEqual({
        error: { name: "RangeError", message: "Out of memory" },
      });
    }, 120_000);
  },
);

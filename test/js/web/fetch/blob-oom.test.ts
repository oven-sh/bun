import { setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync, truncateSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isWindows, tempDir, tempDirWithFiles } from "harness";
import os from "node:os";
import path from "path";

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;

// The in-process cases lower the synthetic allocation limit (1 MiB is the
// smallest value the hook accepts) and read sources larger than it. Above the
// limit .text(), .json() and .bytes() must reject the way they do at the real
// limits (WTF::StringImpl::MaxLength for strings, 2^32 - 1 for typed arrays),
// while .arrayBuffer() has no such limit.
const ALLOCATION_LIMIT = 4 * MiB;
const BLOB_SIZE = 9 * MiB;
const FILE_SIZE = 8 * MiB;

const stringTooLong = {
  name: "Error",
  code: "ERR_STRING_TOO_LONG",
  message: "Cannot create a string longer than 2147483647 characters",
};
const jsonTooLong = {
  name: "Error",
  code: "ERR_STRING_TOO_LONG",
  message: "Cannot parse a JSON string longer than 2147483647 characters",
};
const outOfMemory = { name: "RangeError", message: "Out of memory" };

// The limit is process-wide, so put it back for whatever runs after this file.
let previousLimit: number;
beforeAll(() => {
  previousLimit = setSyntheticAllocationLimitForTesting(ALLOCATION_LIMIT);
});
afterAll(() => {
  setSyntheticAllocationLimitForTesting(previousLimit);
});

describe("Memory", () => {
  // Nine 1 MiB parts of NUL bytes: larger than ALLOCATION_LIMIT and all ASCII.
  const parts: ArrayBuffer[] = new Array(9).fill(new ArrayBuffer(MiB));
  let blob: Blob;
  beforeAll(() => {
    blob = new Blob(parts);
  });

  describe("Blob", () => {
    // Each case builds its own Blob: Blob.prototype.bytes() detaches the blob
    // it was called on when it throws.
    test(".text() rejects with ERR_STRING_TOO_LONG", async () => {
      await expect(new Blob(parts).text()).rejects.toMatchObject(stringTooLong);
    });

    test(".json() rejects with ERR_STRING_TOO_LONG", async () => {
      await expect(new Blob(parts).json()).rejects.toMatchObject(jsonTooLong);
    });

    test(".bytes() rejects with RangeError: Out of memory", async () => {
      await expect(new Blob(parts).bytes()).rejects.toMatchObject(outOfMemory);
    });

    test(".arrayBuffer() resolves with every byte", async () => {
      const buffer = await new Blob(parts).arrayBuffer();
      expect(buffer.byteLength).toBe(BLOB_SIZE);
    });
  });

  // new Response(blob) and new Request(.., { body: blob }) share the blob's
  // store instead of copying it, so one blob serves every case below.
  describe("Response", () => {
    test(".text() rejects with ERR_STRING_TOO_LONG", async () => {
      await expect(new Response(blob).text()).rejects.toMatchObject(stringTooLong);
    });

    test(".json() rejects with ERR_STRING_TOO_LONG", async () => {
      await expect(new Response(blob).json()).rejects.toMatchObject(jsonTooLong);
    });

    test(".bytes() rejects with RangeError: Out of memory", async () => {
      await expect(new Response(blob).bytes()).rejects.toMatchObject(outOfMemory);
    });

    test(".arrayBuffer() resolves with every byte", async () => {
      const buffer = await new Response(blob).arrayBuffer();
      expect(buffer.byteLength).toBe(BLOB_SIZE);
    });
  });

  describe("Request", () => {
    const request = () => new Request("http://localhost/", { method: "POST", body: blob });

    test(".text() rejects with ERR_STRING_TOO_LONG", async () => {
      await expect(request().text()).rejects.toMatchObject(stringTooLong);
    });

    test(".json() rejects with ERR_STRING_TOO_LONG", async () => {
      await expect(request().json()).rejects.toMatchObject(jsonTooLong);
    });

    test(".bytes() rejects with RangeError: Out of memory", async () => {
      await expect(request().bytes()).rejects.toMatchObject(outOfMemory);
    });

    test(".arrayBuffer() resolves with every byte", async () => {
      const buffer = await request().arrayBuffer();
      expect(buffer.byteLength).toBe(BLOB_SIZE);
    });
  });
});

describe("Bun.file", () => {
  let dir: string;
  let file: string;
  beforeAll(() => {
    dir = tempDirWithFiles("file-oom", { "file.txt": Buffer.alloc(FILE_SIZE, "x") });
    file = path.join(dir, "file.txt");
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test(".text() rejects with ERR_STRING_TOO_LONG", async () => {
    await expect(Bun.file(file).text()).rejects.toMatchObject(stringTooLong);
  });

  test(".json() rejects with ERR_STRING_TOO_LONG", async () => {
    await expect(Bun.file(file).json()).rejects.toMatchObject(jsonTooLong);
  });

  test(".bytes() rejects with RangeError: Out of memory", async () => {
    await expect(Bun.file(file).bytes()).rejects.toMatchObject(outOfMemory);
  });

  test(".arrayBuffer() resolves with every byte", async () => {
    const buffer = await Bun.file(file).arrayBuffer();
    expect(buffer.byteLength).toBe(FILE_SIZE);
  });
});

// The cases below need real 2 GiB and 4 GiB buffers: the limits they hit are
// WTF::StringImpl::MaxLength (2^31 - 1) and JSC's MAX_ARRAY_BUFFER_SIZE (2^32),
// which the synthetic limit cannot stand in for. The Rust-side guards in front
// of WTF string construction used to check only the synthetic limit, so a
// smaller source behind a lower synthetic limit would pass the guard that the
// real sizes get past. Each case runs in a child process so the buffer stays
// out of the test runner, and the children carry their own timeouts because a
// 4 GiB read takes several seconds in a debug build.
//
// Inside a container os.totalmem() reports the host's RAM;
// process.constrainedMemory() reports the cgroup limit there.
const memory = Math.min(os.totalmem(), process.constrainedMemory() || Infinity);
// A child that reads N bytes from a file peaks near N of RSS, or 2N under ASAN
// (measured: 8.5 GiB for the 4 GiB read). The 10 GiB gate, the same one as
// buffer.test.js's 4 GiB case, covers one child at a time. Concurrent tests in
// adjacent groups run as one batch, so when both groups below are concurrent
// all four children run at once. That needs about 24 GiB under ASAN and 12 GiB
// otherwise, and happens only where the machine holds twice that.
const fitsOneChild = memory >= 10 * GiB;
const fitsAllChildren = memory >= 2 * (isASAN ? 24 : 12) * GiB;

interface ChildResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signalCode: string | null;
}

// Everything the child produced goes into one assertion, so an abort shows its
// signal, exit code and stderr next to the missing stdout.
async function runChild(source: string): Promise<ChildResult> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

function childPrinted(output: unknown): ChildResult {
  return { stdout: JSON.stringify(output) + "\n", stderr: "", exitCode: 0, signalCode: null };
}

// Byte lengths in [2^31, 2^32) used to abort the process instead of throwing:
// the guards missed WTF::StringImpl::MaxLength and tripped
// "ASSERTION FAILED: data.size() <= MaxLength" / a RELEASE_ASSERT in
// StringImplShape. Lengths >= 2^32 were already caught.
describe.concurrent.skipIf(!fitsOneChild)("byte sources at the 2 GiB string limit", () => {
  test("Blob.text() and Blob.json() at 2^31 bytes throw ERR_STRING_TOO_LONG instead of aborting", async () => {
    const result = await runChild(`
      const results = [];
      const report = e => ({ name: e.name, code: e.code, message: e.message });
      const blob = new Blob([new Uint8Array(2 ** 31)]);
      await blob.text().then(() => results.push("TEXT_UNEXPECTED_SUCCESS"), e => results.push(report(e)));
      await blob.json().then(() => results.push("JSON_UNEXPECTED_SUCCESS"), e => results.push(report(e)));
      console.log(JSON.stringify(results));
    `);
    expect(result).toEqual(childPrinted([stringTooLong, jsonTooLong]));
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
    const result = await runChild(`
      const report = e => ({ name: e.name, code: e.code, message: e.message });
      const result = await Bun.file(${JSON.stringify(file)}).text().then(() => "UNEXPECTED_SUCCESS", report);
      console.log(JSON.stringify([result]));
    `);
    expect(result).toEqual(childPrinted([stringTooLong]));
  }, 90_000);
});

// An ArrayBuffer can hold at most 2^32 bytes (JSC's MAX_ARRAY_BUFFER_SIZE). The
// file path hands the bytes it read to JSC without a copy; converting the
// length through u32 on the way panicked at exactly 2^32, and JSC aborts when
// it is asked to adopt more than that. The file is sparse, but each case still
// reads a real 4 GiB into the child. On Windows the file reader itself rejects
// files of 2^32 bytes or more with ENOMEM (read_file.rs, ReadFileUV), so
// neither case reaches the ArrayBuffer hand-off there.
const describeFourGiB = fitsAllChildren ? describe.concurrent : describe;
describeFourGiB.skipIf(isWindows || !fitsOneChild)("Bun.file().arrayBuffer() at the 4 GiB ArrayBuffer limit", () => {
  async function readSparseFileAsArrayBuffer(size: number): Promise<ChildResult> {
    using dir = tempDir("blob-4gib", {});
    const file = path.join(String(dir), "big.bin");
    // 'x' followed by a hole, which reads back as NUL bytes. Nothing is written
    // after the truncate: on NTFS that would zero-fill the whole file on disk.
    writeFileSync(file, "x");
    truncateSync(file, size);
    return await runChild(`
      const report = buf => {
        const view = new DataView(buf);
        return { byteLength: buf.byteLength, first: view.getUint8(0), last: view.getUint8(buf.byteLength - 1) };
      };
      const result = await Bun.file(${JSON.stringify(file)}).arrayBuffer().then(report, e => ({ error: { name: e.name, message: e.message } }));
      console.log(JSON.stringify(result));
    `);
  }

  test("a file of exactly 2^32 bytes is returned whole", async () => {
    expect(await readSparseFileAsArrayBuffer(2 ** 32)).toEqual(
      childPrinted({ byteLength: 2 ** 32, first: "x".charCodeAt(0), last: 0 }),
    );
  }, 120_000);

  test("a file of 2^32 + 1 bytes rejects with the RangeError that new ArrayBuffer() throws for that size", async () => {
    expect(await readSparseFileAsArrayBuffer(2 ** 32 + 1)).toEqual(childPrinted({ error: outOfMemory }));
  }, 120_000);
});

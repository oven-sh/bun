import { describe, expect, test } from "bun:test";
import { closeSync, openSync, readSync, writeSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { join } from "path";

// Reading a Bun.file() backed by a file descriptor goes through
// ReadFile.runAsync -> getFd (opened_fd already set) -> runAsyncWithFD ->
// resolveSizeAndLastModified, which derives total_size from fstat. That
// computation previously used @intCast to u52 guarded by a dead @truncate,
// so an abnormal fstat size could trip integerOutOfBounds. Triggering that
// directly requires fstat to report > 4.5 PB which is not achievable here,
// but these tests lock in the fd-backed ReadFile path that the fuzzer hit.
describe.skipIf(isWindows)("Bun.file(fd) read", () => {
  async function withFd<T>(path: string, fn: (fd: number) => Promise<T>): Promise<T> {
    const fd = openSync(path, "r");
    try {
      return await fn(fd);
    } finally {
      closeSync(fd);
    }
  }

  test("text() and arrayBuffer() on a regular-file fd return file contents", async () => {
    using dir = tempDir("bun-file-fd-read", { "fd-read.txt": "hello from fd" });
    const path = join(String(dir), "fd-read.txt");

    // Each read needs a fresh fd because Bun.file(fd) does not own or rewind
    // the descriptor, and a completed read leaves it positioned at EOF.
    expect(await withFd(path, fd => Bun.file(fd).text())).toBe("hello from fd");

    const buf = await withFd(path, fd => Bun.file(fd).arrayBuffer());
    expect(new Uint8Array(buf)).toEqual(new TextEncoder().encode("hello from fd"));
  });

  test("slice() with an end beyond the real size reads the actual file contents", async () => {
    using dir = tempDir("bun-file-fd-read", { "fd-slice.txt": "0123456789" });
    const path = join(String(dir), "fd-slice.txt");

    // total_size should come from fstat (10), not from the requested slice
    // end, so the initial buffer allocation stays small.
    expect(await withFd(path, fd => Bun.file(fd).slice(0, Number.MAX_SAFE_INTEGER).text())).toBe("0123456789");
    expect(await withFd(path, fd => Bun.file(fd).slice(2, 5).text())).toBe("234");
  });

  // POSIX only: on Windows these reads still seek.
  describe.skipIf(isWindows)("a read of a slice", () => {
    const content = "0123456789abcdefghij";
    const latin1 = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes as ArrayBuffer).toString("latin1");

    // Runs `read` on a descriptor that is at byte 5. `next` is what the descriptor gives afterwards.
    async function atByte5(path: string, read: (file: Blob) => Promise<string>, length = content.length) {
      return await withFd(path, async fd => {
        readSync(fd, Buffer.alloc(5));
        const bytes = await read(Bun.file(fd));
        const buf = Buffer.alloc(length);
        return { bytes, next: buf.toString("latin1", 0, readSync(fd, buf)) };
      });
    }

    async function formDataPart(slice: Blob) {
      const form = new FormData();
      form.append("file", slice, "part.bin");
      return latin1(await new Response(form).bytes())
        .split("\r\n\r\n")[1]
        .split("\r\n")[0];
    }

    test.concurrent("inside the file does not move the descriptor", async () => {
      using dir = tempDir("bun-file-fd-read", { "fd-position.txt": content });
      const path = join(String(dir), "fd-position.txt");
      await using server = Bun.serve({ port: 0, fetch: async req => new Response(await req.text()) });
      const fetchBody = async (slice: Blob) => (await fetch(server.url, { method: "POST", body: slice })).text();

      const readers: Record<string, (file: Blob) => Promise<string>> = {
        "text()": file => file.slice(2, 6).text(),
        "bytes()": async file => latin1(await file.slice(2, 6).bytes()),
        "arrayBuffer()": async file => latin1(await file.slice(2, 6).arrayBuffer()),
        "json()": async file => String(await file.slice(2, 6).json()),
        "new Response(slice).text()": file => new Response(file.slice(2, 6)).text(),
        "new Response(slice.stream()).bytes()": async file =>
          latin1(await new Response(file.slice(2, 6).stream()).bytes()),
        "new Blob([slice]).text()": file => new Blob([file.slice(2, 6)]).text(),
        "structuredClone(slice).text()": file => structuredClone(file.slice(2, 6)).text(),
        "a FormData part": file => formDataPart(file.slice(2, 6)),
        "a fetch() body": file => fetchBody(file.slice(2, 6)),
        "slice(7).text()": file => file.slice(7).text(),
        "slice(7) as a FormData part": file => formDataPart(file.slice(7)),
        "slice(7) as a fetch() body": file => fetchBody(file.slice(7)),
        // The last byte, the end of the file, and an empty slice.
        "slice(19).text()": file => file.slice(19).text(),
        "slice(20).text()": file => file.slice(20).text(),
        "slice(20) as a FormData part": file => formDataPart(file.slice(20)),
        "slice(2, 2).text()": file => file.slice(2, 2).text(),
        "slice(2, 2) as a FormData part": file => formDataPart(file.slice(2, 2)),
      };
      const result: Record<string, unknown> = {};
      for (const [name, read] of Object.entries(readers)) result[name] = await atByte5(path, read);

      const next = content.slice(5);
      expect(result).toEqual({
        "text()": { bytes: "2345", next },
        "bytes()": { bytes: "2345", next },
        "arrayBuffer()": { bytes: "2345", next },
        "json()": { bytes: "2345", next },
        "new Response(slice).text()": { bytes: "2345", next },
        "new Response(slice.stream()).bytes()": { bytes: "2345", next },
        "new Blob([slice]).text()": { bytes: "2345", next },
        "structuredClone(slice).text()": { bytes: "2345", next },
        "a FormData part": { bytes: "2345", next },
        "a fetch() body": { bytes: "2345", next },
        "slice(7).text()": { bytes: "789abcdefghij", next },
        "slice(7) as a FormData part": { bytes: "789abcdefghij", next },
        "slice(7) as a fetch() body": { bytes: "789abcdefghij", next },
        "slice(19).text()": { bytes: "j", next },
        "slice(20).text()": { bytes: "", next },
        "slice(20) as a FormData part": { bytes: "", next },
        "slice(2, 2).text()": { bytes: "", next },
        "slice(2, 2) as a FormData part": { bytes: "", next },
      });
    });

    test.concurrent("above 2 GiB does not move the descriptor", async () => {
      using dir = tempDir("bun-file-fd-read", {});
      const path = join(String(dir), "fd-sparse.bin");
      // A write past the end leaves a hole, so the file takes no space for its first 2 GiB.
      const writer = openSync(path, "w");
      writeSync(writer, content, 2 ** 31);
      closeSync(writer);

      expect({
        "text()": await atByte5(path, file => file.slice(2 ** 31 + 2, 2 ** 31 + 6).text(), 4),
        "a FormData part": await atByte5(path, file => formDataPart(file.slice(2 ** 31 + 2, 2 ** 31 + 6)), 4),
      }).toEqual({
        "text()": { bytes: "2345", next: "\0\0\0\0" },
        "a FormData part": { bytes: "2345", next: "\0\0\0\0" },
      });
    });

    test.concurrent("leaves the next write where the descriptor was", async () => {
      using dir = tempDir("bun-file-fd-read", { "fd-read-write.txt": content });
      const readWrite = join(String(dir), "fd-read-write.txt");
      const result: Record<string, unknown> = {};

      let fd = openSync(readWrite, "r+");
      try {
        const bytes = await Bun.file(fd).slice(7).text();
        writeSync(fd, "XY");
        result["after slice(7).text()"] = { bytes, file: await Bun.file(readWrite).text() };
        // The descriptor is at byte 2 now. A read of another range does not move it.
        const other = await Bun.file(fd).slice(10, 14).text();
        writeSync(fd, "ZW");
        result["between two writes"] = { bytes: other, file: await Bun.file(readWrite).text() };
      } finally {
        closeSync(fd);
      }

      // A descriptor that is open for writing only: the read fails, also when the slice is empty.
      const failed = (error: any) => ({ code: error?.code, syscall: error?.syscall });
      for (const [name, read] of [
        ["after a text() that fails", (file: Blob) => file.slice(2, 6).text()],
        ["after a FormData part that fails", (file: Blob) => formDataPart(file.slice(2, 6))],
        ["after a FormData part of slice(2, 2) that fails", (file: Blob) => formDataPart(file.slice(2, 2))],
        ["after a FormData part of slice(20) that fails", (file: Blob) => formDataPart(file.slice(20))],
      ] as const) {
        const writeOnly = join(String(dir), "fd-write-only.txt");
        fd = openSync(writeOnly, "w");
        try {
          writeSync(fd, content);
          const error = await read(Bun.file(fd)).then(() => null, failed);
          writeSync(fd, "XY");
          result[name] = { error, file: await Bun.file(writeOnly).text() };
        } finally {
          closeSync(fd);
        }
      }

      expect(result).toEqual({
        "after slice(7).text()": { bytes: "789abcdefghij", file: "XY" + content.slice(2) },
        "between two writes": { bytes: "abcd", file: "XYZW" + content.slice(4) },
        "after a text() that fails": { error: { code: "EBADF", syscall: "read" }, file: content + "XY" },
        "after a FormData part that fails": { error: { code: "EBADF", syscall: "read" }, file: content + "XY" },
        "after a FormData part of slice(2, 2) that fails": {
          error: { code: "EBADF", syscall: "read" },
          file: content + "XY",
        },
        "after a FormData part of slice(20) that fails": {
          error: { code: "EBADF", syscall: "read" },
          file: content + "XY",
        },
      });
    });

    test.concurrent("gets its own bytes when other reads of the descriptor run", async () => {
      const records = Array.from({ length: 400 }, (_, i) => "r" + String(i).padStart(7, "0"));
      using dir = tempDir("bun-file-fd-read", { "fd-records.txt": records.join("") });
      const path = join(String(dir), "fd-records.txt");

      await withFd(path, async fd => {
        // Record 0 is left out: a slice that starts at byte 0 reads from the position of the descriptor.
        const reads = await Promise.all(
          records.slice(1).map((_, i) =>
            Bun.file(fd)
              .slice((i + 1) * 8, (i + 2) * 8)
              .text(),
          ),
        );
        const first = Buffer.alloc(8);
        readSync(fd, first);
        expect([first.toString(), ...reads]).toEqual(records);
      });
    });

    test.concurrent("of Bun.stdin does not move a stdin that the parent shares", async () => {
      using dir = tempDir("bun-file-fd-read", { "stdin.txt": content });
      await withFd(join(String(dir), "stdin.txt"), async fd => {
        readSync(fd, Buffer.alloc(5));
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", "process.stdout.write(await Bun.stdin.slice(2, 6).text())"],
          env: bunEnv,
          stdin: fd,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        const buf = Buffer.alloc(content.length);
        expect({ stdout, stderr, exitCode, next: buf.toString("latin1", 0, readSync(fd, buf)) }).toEqual({
          stdout: "2345",
          stderr: "",
          exitCode: 0,
          next: content.slice(5),
        });
      });
    });

    test.concurrent("at byte 0 starts at the position of the descriptor", async () => {
      using dir = tempDir("bun-file-fd-read", { "fd-byte-0.txt": content });
      const path = join(String(dir), "fd-byte-0.txt");

      expect({
        "slice(0, 4).text()": await atByte5(path, file => file.slice(0, 4).text()),
        "slice(0, 4) as a FormData part": await atByte5(path, file => formDataPart(file.slice(0, 4))),
      }).toEqual({
        "slice(0, 4).text()": { bytes: "5678", next: content.slice(9) },
        "slice(0, 4) as a FormData part": { bytes: "5678", next: content.slice(9) },
      });
    });

    test.concurrent("past the end, or of a file that is not regular, seeks", async () => {
      using dir = tempDir("bun-file-fd-read", { "fd-seek.txt": content });
      const path = join(String(dir), "fd-seek.txt");

      // A FIFO that holds "hello world". It has no offsets, so the seek fails and the read is in order.
      async function fromFifo(name: string, read: (file: Blob) => Promise<string>) {
        const fifo = join(String(dir), name);
        mkfifo(fifo);
        const fd = openSync(fifo, "r+");
        try {
          writeSync(fd, "hello world");
          return await read(Bun.file(fd));
        } finally {
          closeSync(fd);
        }
      }

      expect({
        "slice(30, 40).text()": await atByte5(path, file => file.slice(30, 40).text()),
        "slice(30, 40) as a FormData part": await atByte5(path, file => formDataPart(file.slice(30, 40))),
        "/dev/zero slice(2, 6).bytes()": latin1(await Bun.file("/dev/zero").slice(2, 6).bytes()),
        "/dev/zero slice(2, 6) as a FormData part": await formDataPart(Bun.file("/dev/zero").slice(2, 6)),
        "a FIFO slice(2, 6).text()": await fromFifo("fifo-text", file => file.slice(2, 6).text()),
        "a FIFO slice(2, 6) as a FormData part": await fromFifo("fifo-part", file => formDataPart(file.slice(2, 6))),
      }).toEqual({
        "slice(30, 40).text()": { bytes: "", next: "" },
        "slice(30, 40) as a FormData part": { bytes: "", next: "" },
        "/dev/zero slice(2, 6).bytes()": "\0\0\0\0",
        "/dev/zero slice(2, 6) as a FormData part": "\0\0\0\0",
        "a FIFO slice(2, 6).text()": "hell",
        "a FIFO slice(2, 6) as a FormData part": "hell",
      });
    });

    // procfs reports a size of 0 for its files, so every start is past the end.
    test.concurrent.skipIf(!isLinux)("of a procfs file seeks", async () => {
      await using server = Bun.serve({ port: 0, fetch: async req => new Response(await req.text()) });
      const ostype = Bun.file("/proc/sys/kernel/ostype").slice(2, 5);

      expect({
        "text()": await ostype.text(),
        "a FormData part": await formDataPart(ostype),
        "a fetch() body": await (await fetch(server.url, { method: "POST", body: ostype })).text(),
      }).toEqual({
        "text()": "nux",
        "a FormData part": "nux",
        "a fetch() body": "nux",
      });
    });
  });

  test("empty regular file via fd resolves with empty content", async () => {
    using dir = tempDir("bun-file-fd-read", { "fd-empty.txt": "" });
    const path = join(String(dir), "fd-empty.txt");

    expect(await withFd(path, fd => Bun.file(fd).text())).toBe("");
    expect((await withFd(path, fd => Bun.file(fd).arrayBuffer())).byteLength).toBe(0);
  });
});

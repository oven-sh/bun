import { describe, expect, test } from "bun:test";
import { closeSync, openSync, readSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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

  test("empty regular file via fd resolves with empty content", async () => {
    using dir = tempDir("bun-file-fd-read", { "fd-empty.txt": "" });
    const path = join(String(dir), "fd-empty.txt");

    expect(await withFd(path, fd => Bun.file(fd).text())).toBe("");
    expect((await withFd(path, fd => Bun.file(fd).arrayBuffer())).byteLength).toBe(0);
  });
});

// Bun.file(fd) must behave like a Blob: .size (from fstat) and the bytes it
// produces must agree, reads must be idempotent, and slice(a, b) must mean
// bytes [a, b) of the file. That requires positioned reads (pread), not
// cursor-relative read(), so the caller's fd cursor is neither observed nor
// mutated.
describe.concurrent("Bun.file(fd) with a non-zero file cursor", () => {
  const bytes = Buffer.from(Array.from({ length: 100 }, (_, i) => 33 + (i % 93)));
  const setup = () => {
    const dir = tempDir("bun-file-fd-cursor", { "f.bin": bytes });
    const path = join(String(dir), "f.bin");
    const openAt = (off: number) => {
      const fd = openSync(path, "r");
      if (off) readSync(fd, Buffer.alloc(off), 0, off, null);
      return fd;
    };
    return { dir, path, openAt };
  };

  test(".size and .arrayBuffer() agree and reads are idempotent", async () => {
    const { dir, openAt } = setup();
    using _ = dir;
    const fd = openAt(30);
    try {
      const f = Bun.file(fd);
      expect(f.size).toBe(100);
      const first = Buffer.from(await f.arrayBuffer());
      const second = Buffer.from(await f.arrayBuffer());
      expect({ first: first.length, second: second.length }).toEqual({ first: 100, second: 100 });
      expect(first.equals(bytes)).toBe(true);
      expect(second.equals(bytes)).toBe(true);
      expect(await f.text()).toBe(bytes.toString());
    } finally {
      closeSync(fd);
    }
  });

  test("slice(a, b) returns file bytes [a, b) regardless of cursor", async () => {
    const { dir, openAt } = setup();
    using _ = dir;
    const fd = openAt(30);
    try {
      expect(await Bun.file(fd).slice(0, 10).text()).toBe(bytes.subarray(0, 10).toString());
      expect(await Bun.file(fd).slice(40, 55).text()).toBe(bytes.subarray(40, 55).toString());
    } finally {
      closeSync(fd);
    }
  });

  test("reading does not mutate the caller's fd cursor", async () => {
    const { dir, openAt } = setup();
    using _ = dir;
    for (const off of [0, 30]) {
      const fd = openAt(off);
      try {
        await Bun.file(fd).arrayBuffer();
        await Bun.file(fd).slice(10, 20).arrayBuffer();
        const rest = Buffer.alloc(200);
        const n = readSync(fd, rest, 0, 200, null);
        expect({ off, n, first: rest[0] }).toEqual({ off, n: 100 - off, first: bytes[off] });
      } finally {
        closeSync(fd);
      }
    }
  });

  test("Response body from Bun.file(fd) has consistent size and bytes", async () => {
    const { dir, openAt } = setup();
    using _ = dir;
    const fd = openAt(30);
    try {
      const r = new Response(Bun.file(fd));
      const blob = await r.clone().blob();
      const buf = Buffer.from(await r.arrayBuffer());
      expect({ blobSize: blob.size, bodyLen: buf.length }).toEqual({ blobSize: 100, bodyLen: 100 });
      expect(buf.equals(bytes)).toBe(true);
    } finally {
      closeSync(fd);
    }
  });

  test("Bun.serve returning new Response(Bun.file(fd)) sends the whole file", async () => {
    const { dir, path } = setup();
    using _ = dir;
    // Run in a subprocess so any mid-stream connection abort surfaces as a
    // visible failure rather than hanging the test harness.
    const script = /* js */ `
      import { openSync, readSync, readFileSync, closeSync } from "node:fs";
      const P = process.env.FIXTURE_PATH;
      const bytes = readFileSync(P);
      const openAt = off => {
        const fd = openSync(P, "r");
        if (off) readSync(fd, Buffer.alloc(off), 0, off, null);
        return fd;
      };
      const fds = [];
      const srv = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        error(e) { console.log("error():", String(e && e.message)); return new Response("E", { status: 599 }); },
        fetch(req) {
          const off = Number(new URL(req.url).searchParams.get("off"));
          const fd = openAt(off);
          fds.push(fd);
          return new Response(Bun.file(fd));
        },
      });
      try {
        for (const off of [0, 30]) {
          try {
            const res = await fetch("http://127.0.0.1:" + srv.port + "/?off=" + off);
            const body = Buffer.from(await res.arrayBuffer());
            console.log(JSON.stringify({
              off,
              status: res.status,
              cl: res.headers.get("content-length"),
              len: body.length,
              ok: body.equals(bytes),
            }));
          } catch (e) {
            console.log(JSON.stringify({ off, error: (e && e.code) || String(e) }));
          }
        }
      } finally {
        for (const fd of fds) try { closeSync(fd); } catch {}
        srv.stop(true);
      }
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, FIXTURE_PATH: path },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim().split("\n"), stderr }).toEqual({
      stdout: [
        JSON.stringify({ off: 0, status: 200, cl: "100", len: 100, ok: true }),
        JSON.stringify({ off: 30, status: 200, cl: "100", len: 100, ok: true }),
      ],
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  test("Bun.file(path) is unaffected", async () => {
    const { dir, path } = setup();
    using _ = dir;
    const f = Bun.file(path);
    expect(f.size).toBe(100);
    expect(Buffer.from(await f.arrayBuffer()).equals(bytes)).toBe(true);
    expect(await f.slice(40, 55).text()).toBe(bytes.subarray(40, 55).toString());
  });
});

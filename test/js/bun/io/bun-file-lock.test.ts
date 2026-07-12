import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";

describe("Bun.file().lock()", () => {
  test("returns a FileLock with unlock() and Symbol.asyncDispose", async () => {
    using dir = tempDir("bun-file-lock", { "a.txt": "hello" });
    const file = Bun.file(join(String(dir), "a.txt"));
    const lock = await file.lock();
    expect(typeof lock.unlock).toBe("function");
    expect(typeof lock.close).toBe("function");
    expect(typeof lock[Symbol.asyncDispose]).toBe("function");
    await lock.unlock();
  });

  test("await using releases the lock", async () => {
    using dir = tempDir("bun-file-lock", { "a.txt": "hello" });
    const path = join(String(dir), "a.txt");
    {
      await using _lock = await Bun.file(path).lock();
    }
    // If the lock was released, a nonblocking lock now succeeds.
    const lock2 = await Bun.file(path).lock({ nonblocking: true });
    await lock2.unlock();
  });

  test("unlock() is idempotent", async () => {
    using dir = tempDir("bun-file-lock", { "a.txt": "hello" });
    const lock = await Bun.file(join(String(dir), "a.txt")).lock();
    await lock.unlock();
    await lock.unlock();
    await lock[Symbol.asyncDispose]();
    await lock.close();
  });

  test("shared locks can coexist", async () => {
    using dir = tempDir("bun-file-lock", { "a.txt": "hello" });
    const path = join(String(dir), "a.txt");
    await using a = await Bun.file(path).lock({ exclusive: false });
    await using b = await Bun.file(path).lock({ exclusive: false, nonblocking: true });
    expect(a).toBeDefined();
    expect(b).toBeDefined();
  });

  test("blocking lock waits for another process", async () => {
    using dir = tempDir("bun-file-lock", { "a.txt": "hello" });
    const path = join(String(dir), "a.txt");

    const holder = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const lock = await Bun.file(process.argv[1]).lock();
          process.stdout.write("locked\\n");
          await new Promise(r => process.stdin.once("data", r));
          await lock.unlock();
          process.stdout.write("unlocked\\n");
        `,
        path,
      ],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = holder.stdout.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("locked\n");

    // Contend for the lock from this process. Must not resolve until the
    // holder releases.
    let acquired = false;
    const pending = Bun.file(path)
      .lock()
      .then(l => {
        acquired = true;
        return l;
      });

    // While the child still holds the lock, a nonblocking attempt must fail.
    await expect(Bun.file(path).lock({ nonblocking: true })).rejects.toThrow();
    expect(acquired).toBe(false);

    holder.stdin.write("go\n");
    holder.stdin.end();

    const lock = await pending;
    expect(acquired).toBe(true);
    await lock.unlock();

    const [, exitCode] = await Promise.all([holder.stderr.text(), holder.exited]);
    reader.releaseLock();
    expect(exitCode).toBe(0);
  });

  test("AbortSignal aborts a pending lock", async () => {
    using dir = tempDir("bun-file-lock", { "a.txt": "hello" });
    const path = join(String(dir), "a.txt");

    const holder = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const lock = await Bun.file(process.argv[1]).lock();
          process.stdout.write("locked\\n");
          await new Promise(r => process.stdin.once("data", r));
          await lock.unlock();
        `,
        path,
      ],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = holder.stdout.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("locked\n");

    const controller = new AbortController();
    const pending = Bun.file(path).lock({ signal: controller.signal });
    controller.abort();
    const err = await pending.then(
      () => null,
      e => e,
    );
    expect(err).not.toBeNull();
    expect(err.name).toBe("AbortError");

    holder.stdin.write("go\n");
    holder.stdin.end();
    reader.releaseLock();
    await Promise.all([holder.stderr.text(), holder.exited]);
  });

  test("lock({ signal }) rejects immediately if already aborted", async () => {
    using dir = tempDir("bun-file-lock", { "a.txt": "hello" });
    const err = await Bun.file(join(String(dir), "a.txt"))
      .lock({ signal: AbortSignal.abort() })
      .then(
        () => null,
        e => e,
      );
    expect(err?.code).toBe("ABORT_ERR");
  });

  // On Windows, LockFileEx semantics differ enough from flock (per-handle byte
  // ranges) that same-process shared→exclusive contention on separate handles
  // is not a reliable test; covered by the cross-process test above.
  test.skipIf(isWindows)(
    "nonblocking exclusive lock fails when shared lock is held on another fd",
    async () => {
      using dir = tempDir("bun-file-lock", { "a.txt": "hello" });
      const path = join(String(dir), "a.txt");
      await using _shared = await Bun.file(path).lock({ exclusive: false });
      const err = await Bun.file(path)
        .lock({ nonblocking: true })
        .then(
          () => null,
          e => e,
        );
      expect(err).not.toBeNull();
      expect(err.syscall).toBe("flock");
    },
  );

  test("Bun.file(fd).lock() and .unlock()", async () => {
    using dir = tempDir("bun-file-lock", { "a.txt": "hello" });
    const path = join(String(dir), "a.txt");
    const fd = openSync(path, "r+");
    try {
      const file = Bun.file(fd);
      const lock = await file.lock();
      await lock.unlock();
      // unlock() directly on the fd-backed file also works
      const lock2 = await file.lock();
      await file.unlock();
      await lock2[Symbol.asyncDispose]();
    } finally {
      closeSync(fd);
    }
  });

  test("unlock() on a path-backed file rejects", async () => {
    using dir = tempDir("bun-file-lock", { "a.txt": "hello" });
    const file = Bun.file(join(String(dir), "a.txt"));
    await expect(file.unlock()).rejects.toThrow(/FileLock/);
  });

  test("lock() on a byte-backed Blob throws", () => {
    const blob = new Blob(["hi"]);
    expect(() => (blob as any).lock()).toThrow(/only available on files/);
  });

  test("lock() creates the file if it does not exist", async () => {
    using dir = tempDir("bun-file-lock", {});
    const path = join(String(dir), "new.txt");
    await using _lock = await Bun.file(path).lock();
    expect(await Bun.file(path).exists()).toBe(true);
  });
});

describe("FileLock I/O", () => {
  test("write / read / truncate round-trip", async () => {
    using dir = tempDir("bun-file-lock", {});
    const path = join(String(dir), "rw.txt");
    await using lock = await Bun.file(path).lock();

    const n = await lock.write("hello world");
    expect(n).toBe(11);

    expect(await lock.text()).toBe("hello world");
    expect(await lock.text(5)).toBe("hello");

    const bytes = await lock.bytes();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes)).toBe("hello world");

    const read = await lock.read(5);
    expect(read).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(read)).toBe("hello");

    const ab = await lock.arrayBuffer();
    expect(ab).toBeInstanceOf(ArrayBuffer);
    expect(ab.byteLength).toBe(11);

    await lock.truncate(5);
    expect(await lock.text()).toBe("hello");

    await lock.truncate();
    expect(await lock.text()).toBe("");
  });

  test("write accepts ArrayBufferView", async () => {
    using dir = tempDir("bun-file-lock", {});
    await using lock = await Bun.file(join(String(dir), "buf.txt")).lock();
    const n = await lock.write(new Uint8Array([104, 105]));
    expect(n).toBe(2);
    expect(await lock.text()).toBe("hi");
  });

  test("I/O after unlock throws", async () => {
    using dir = tempDir("bun-file-lock", { "a.txt": "x" });
    const lock = await Bun.file(join(String(dir), "a.txt")).lock();
    await lock.unlock();
    expect(() => lock.write("x")).toThrow(/already released/);
    expect(() => lock.bytes()).toThrow(/already released/);
    expect(() => lock.truncate()).toThrow(/already released/);
  });

  test("truncate rejects negative length", async () => {
    using dir = tempDir("bun-file-lock", { "a.txt": "x" });
    await using lock = await Bun.file(join(String(dir), "a.txt")).lock();
    expect(() => lock.truncate(-1)).toThrow(/>= 0/);
  });
});

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";

async function readLine(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    const nl = buf.indexOf("\n");
    if (nl !== -1) return buf.slice(0, nl + 1);
    if (done) return buf;
  }
}

function spawnHolder(path: string) {
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
  // Start draining stderr immediately so a chatty debug build can't block.
  const stderr = holder.stderr.text();
  return { holder, stderr };
}

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

  test("close() releases the lock", async () => {
    using dir = tempDir("bun-file-lock", { "a.txt": "hello" });
    const path = join(String(dir), "a.txt");
    const lock = await Bun.file(path).lock();
    await lock.close();
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

    const { holder, stderr } = spawnHolder(path);
    await using _holder = holder;
    const reader = holder.stdout.getReader();
    expect(await readLine(reader)).toBe("locked\n");

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

    reader.releaseLock();
    const [, exitCode] = await Promise.all([stderr, holder.exited]);
    expect(exitCode).toBe(0);
  });

  test("AbortSignal aborts a pending lock", async () => {
    using dir = tempDir("bun-file-lock", { "a.txt": "hello" });
    const path = join(String(dir), "a.txt");

    const { holder, stderr } = spawnHolder(path);
    await using _holder = holder;
    const reader = holder.stdout.getReader();
    expect(await readLine(reader)).toBe("locked\n");

    const controller = new AbortController();
    const pending = Bun.file(path).lock({ signal: controller.signal });
    controller.abort("stop");
    const err = await pending.then(
      () => null,
      e => e,
    );
    expect(err).not.toBeNull();
    expect(err.name).toBe("AbortError");
    expect(err.code).toBe("ABORT_ERR");
    expect(err.cause).toBe("stop");

    holder.stdin.write("go\n");
    holder.stdin.end();
    reader.releaseLock();
    await Promise.all([stderr, holder.exited]);
  });

  test("lock({ signal }) rejects immediately if already aborted", async () => {
    using dir = tempDir("bun-file-lock", { "a.txt": "hello" });
    const err = await Bun.file(join(String(dir), "a.txt"))
      .lock({ signal: AbortSignal.abort("nope") })
      .then(
        () => null,
        e => e,
      );
    expect(err?.name).toBe("AbortError");
    expect(err?.code).toBe("ABORT_ERR");
    expect(err?.cause).toBe("nope");
  });

  test("nonblocking exclusive lock fails when shared lock is held on another fd", async () => {
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
  });

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

  test("lock() rejects non-boolean option values", async () => {
    using dir = tempDir("bun-file-lock", { "a.txt": "hello" });
    const file = Bun.file(join(String(dir), "a.txt"));
    expect(() => file.lock({ exclusive: "false" as any })).toThrow(/boolean/);
    expect(() => file.lock({ nonblocking: 1 as any })).toThrow(/boolean/);
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

  test("pending I/O survives unlock()", async () => {
    using dir = tempDir("bun-file-lock", { "a.txt": "hello" });
    const lock = await Bun.file(join(String(dir), "a.txt")).lock();
    const pending = lock.bytes();
    await lock.unlock();
    expect(new TextDecoder().decode(await pending)).toBe("hello");
  });

  test("truncate rejects negative length", async () => {
    using dir = tempDir("bun-file-lock", { "a.txt": "x" });
    await using lock = await Bun.file(join(String(dir), "a.txt")).lock();
    expect(() => lock.truncate(-1)).toThrow(/>= 0/);
  });

  test("bytes(n) clamps to file size", async () => {
    using dir = tempDir("bun-file-lock", { "a.txt": "hello" });
    await using lock = await Bun.file(join(String(dir), "a.txt")).lock();
    const result = await lock.bytes(Number.MAX_SAFE_INTEGER);
    expect(result.byteLength).toBe(5);
    expect(new TextDecoder().decode(result)).toBe("hello");
  });
});

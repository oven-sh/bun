import { $ } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tls } from "harness";
import { mkfifo } from "mkfifo";
import fs, {
  closeSync,
  constants,
  existsSync,
  openAsBlob,
  openSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// Every change below changes the size or the mtime. node cannot see any other change either.
describe.concurrent("fs.openAsBlob pins the file", () => {
  const notReadable = expect.objectContaining({ name: "NotReadableError", message: "The blob could not be read" });

  async function pinned(contents: string | Uint8Array = "hello", options?: { type?: string }) {
    const dir = tempDir("open-as-blob", { "a.txt": contents });
    const file = join(String(dir), "a.txt");
    return { dir, file, blob: await openAsBlob(file, options) };
  }

  it("reads an unchanged file, more than once", async () => {
    const { dir, file, blob } = await pinned();
    using _ = dir;
    expect(blob.size).toBe(5);
    expect(await blob.text()).toBe("hello");
    expect(await blob.text()).toBe("hello");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new TextEncoder().encode("hello"));
    expect(await blob.bytes()).toEqual(new TextEncoder().encode("hello"));
    expect(await blob.slice(1, 4).text()).toBe("ell");
    expect(await blob.slice(1).slice(1, 3).text()).toBe("ll");
    expect(await new Response(blob).text()).toBe("hello");
    expect(await new Response(blob.stream()).text()).toBe("hello");
    expect(await new File([blob], "n").text()).toBe("hello");
    expect(await (await openAsBlob(Buffer.from(file))).text()).toBe("hello");
    expect(await (await openAsBlob(Bun.pathToFileURL(file))).text()).toBe("hello");
  });

  it("keeps the size and does not sniff the type", async () => {
    const { dir, file, blob } = await pinned();
    using _ = dir;
    expect(blob.type).toBe("");
    // A type goes into a `Content-Type` header as it is, so one that a `Blob` cannot have is dropped.
    expect((await openAsBlob(file, { type: "a\r\nb: c" })).type).toBe("");
    expect((await openAsBlob(file, {})).type).toBe("");
    expect((await openAsBlob(file, { type: "" })).type).toBe("");
    expect((await openAsBlob(file, { type: "text/plain" })).type).toBe("text/plain");
    expect((await openAsBlob(file, { type: "TEXT/Plain" })).type).toBe("TEXT/Plain");
    writeFileSync(file, "swapped!");
    expect(blob.size).toBe(5);
    expect(blob.slice(1, 4).size).toBe(3);
  });

  it("rejects every read once the file changes", async () => {
    const { dir, file, blob } = await pinned();
    using _ = dir;
    const sliceBefore = blob.slice(1, 4);
    writeFileSync(file, "swapped!");

    await expect(blob.text()).rejects.toEqual(notReadable);
    await expect(blob.text()).rejects.toBeInstanceOf(DOMException);
    await expect(blob.arrayBuffer()).rejects.toEqual(notReadable);
    await expect(blob.bytes()).rejects.toEqual(notReadable);
    await expect(blob.json()).rejects.toEqual(notReadable);
    await expect(sliceBefore.text()).rejects.toEqual(notReadable);
    await expect(blob.slice(1, 4).text()).rejects.toEqual(notReadable);
    await expect(new File([blob], "n").text()).rejects.toEqual(notReadable);
    await expect(new Response(blob).text()).rejects.toEqual(notReadable);
    await expect(new Request("http://example.com", { method: "POST", body: blob }).text()).rejects.toEqual(notReadable);
    const url = URL.createObjectURL(blob);
    try {
      await expect(fetch(url).then(res => res.text())).rejects.toEqual(notReadable);
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  it.each([
    ["truncated", (file: string) => writeFileSync(file, "hi")],
    ["appended", (file: string) => fs.appendFileSync(file, " world")],
    ["deleted", (file: string) => unlinkSync(file)],
    [
      "touched",
      (file: string) => {
        // Only the nanoseconds of the mtime count, so move them and keep the second.
        const ms = Number(statSync(file, { bigint: true }).mtimeNs / 1_000_000n);
        fs.utimesSync(file, new Date(), new Date(ms - (ms % 1000) + ((ms + 500) % 1000)));
      },
    ],
  ])("rejects a read of a %s file", async (_name, change) => {
    const { dir, file, blob } = await pinned();
    using _ = dir;
    change(file);
    await expect(blob.text()).rejects.toEqual(notReadable);
    await expect(blob.stream().getReader().read()).rejects.toEqual(notReadable);
  });

  it("fails the first read of a stream, not getReader()", async () => {
    const { dir, file, blob } = await pinned();
    using _ = dir;
    const before = blob.stream();
    writeFileSync(file, "swapped!");
    const after = blob.stream();
    for (const stream of [before, after, new Response(blob).body!]) {
      const reader = stream.getReader();
      await expect(reader.read()).rejects.toEqual(notReadable);
    }
  });

  it("fails a stream when the file changes between two reads", async () => {
    // 300000 bytes reach the consumer as more than one chunk.
    const { dir, file, blob } = await pinned(Buffer.alloc(300_000, "a"));
    using _ = dir;
    let chunks = 0;
    const read = async () => {
      for await (const _chunk of blob.stream()) {
        chunks++;
        writeFileSync(file, "swapped!");
      }
    };
    await expect(read()).rejects.toEqual(notReadable);
    expect(chunks).toBeGreaterThan(0);
  });

  // node compares the file that it opened. A new file at the path is not that file.
  const afterTheLastBytes: [string, (file: string) => void][] = [["deleted", file => unlinkSync(file)]];
  // Windows does not rename over a file that is open.
  if (!isWindows) {
    afterTheLastBytes.push([
      "replaced",
      file => {
        writeFileSync(file + ".new", "swapped!");
        fs.renameSync(file + ".new", file);
      },
    ]);
  }
  it.each(afterTheLastBytes)(
    "ends a stream of a file that is %s after its last bytes were read",
    async (_name, change) => {
      const { dir, file, blob } = await pinned();
      using _ = dir;
      const reader = blob.stream().getReader();
      expect(await reader.read()).toEqual({ done: false, value: new TextEncoder().encode("hello") });
      change(file);
      expect(await reader.read()).toEqual({ done: true, value: undefined });
      await expect(blob.text()).rejects.toEqual(notReadable);
    },
  );

  it("rejects a read of an empty file that is written later", async () => {
    const { dir, file, blob } = await pinned("");
    using _ = dir;
    expect(blob.size).toBe(0);
    expect(await blob.text()).toBe("");
    writeFileSync(file, "abc");
    await expect(blob.text()).rejects.toEqual(notReadable);
    await expect(blob.stream().getReader().read()).rejects.toEqual(notReadable);
  });

  it("opens a directory and rejects the read", async () => {
    using dir = tempDir("open-as-blob-dir", {});
    const blob = await openAsBlob(String(dir));
    await expect(blob.text()).rejects.toEqual(notReadable);
  });

  it("resolves a relative path again at each read", async () => {
    using dir = tempDir("open-as-blob-cwd", { "a.txt": "hello", "other/.keep": "" });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const blob = await require("node:fs").openAsBlob("a.txt");
        console.log(await blob.text());
        process.chdir("other");
        console.log(await blob.text().then(() => "resolved", err => err.name));`,
      ],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "hello\nNotReadableError\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  it.each([
    ["below", 5],
    ["above", 100_000],
  ])("rejects a fetch body %s the sendfile threshold once the file changes", async (_name, size) => {
    const { dir, file, blob } = await pinned(Buffer.alloc(size, "a"));
    using _ = dir;
    await using server = Bun.serve({ port: 0, fetch: async req => new Response(String((await req.bytes()).length)) });
    expect(await (await fetch(server.url, { method: "POST", body: blob })).text()).toBe(String(size));
    writeFileSync(file, Buffer.alloc(size + 1, "b"));
    await expect(fetch(server.url, { method: "POST", body: blob })).rejects.toEqual(notReadable);
  });

  it("does not send a changed file in a multipart retry", async () => {
    const { dir, file, blob } = await pinned();
    using _ = dir;
    await using server = Bun.serve({
      port: 0,
      fetch: async req => new Response(await ((await req.formData()).get("file") as File).text()),
    });
    const upload = async () => {
      const form = new FormData();
      form.append("file", blob, "a.txt");
      const res = await fetch(server.url, { method: "POST", body: form });
      return await res.text();
    };
    expect(await upload()).toBe("hello");
    writeFileSync(file, "swapped!");
    await expect(upload()).rejects.toEqual(notReadable);
  });

  it("throws when the path cannot be stat'd", () => {
    using dir = tempDir("open-as-blob-missing", {});
    const missing = join(String(dir), "missing.txt");
    // The stat error, as node main throws since https://github.com/nodejs/node/pull/65517.
    expect(() => openAsBlob(missing)).toThrow(
      expect.objectContaining({ code: "ENOENT", syscall: "stat", path: missing }),
    );
  });

  it("validates its arguments like node", () => {
    const invalidArgType = expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" });
    // @ts-expect-error
    expect(() => openAsBlob()).toThrow(invalidArgType);
    // @ts-expect-error
    expect(() => openAsBlob(import.meta.path, null)).toThrow(invalidArgType);
    // @ts-expect-error
    expect(() => openAsBlob(import.meta.path, { type: 123 })).toThrow(invalidArgType);
  });

  it("is not cloneable, and every other Blob of the file is", async () => {
    const { dir, file, blob } = await pinned();
    using _ = dir;
    expect(() => structuredClone(blob)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_STATE",
        message: "Invalid state: File-backed Blobs are not cloneable",
      }),
    );
    // As in node. The clone has the pin.
    const clones = [blob.slice(1, 4), blob.slice(), new Blob([blob]), new File([blob], "n")].map(each =>
      structuredClone(each),
    );
    expect(await Promise.all(clones.map(clone => clone.text()))).toEqual(["ell", "hello", "hello", "hello"]);
    writeFileSync(file, "swapped!");
    expect(clones.map(clone => clone.size)).toEqual([3, 5, 5, 5]);
    for (const clone of [...clones, structuredClone(blob.slice())]) {
      await expect(clone.text()).rejects.toEqual(notReadable);
    }
  });

  it.each([
    ["below", 5],
    ["above", 100_000],
  ])("Bun.serve sends an unchanged file %s the sendfile threshold, and fails a changed one", async (_name, size) => {
    const { dir, file, blob } = await pinned(Buffer.alloc(size, "a"));
    using _ = dir;
    await using server = Bun.serve({
      port: 0,
      development: false,
      routes: { "/route": new Response(blob) },
      fetch: req => (new URL(req.url).pathname === "/handler" ? new Response(blob) : new Response("no route")),
      error: err => new Response(err.name, { status: 500 }),
    });
    for (const path of ["/handler", "/route"]) {
      const res = await fetch(new URL(path, server.url));
      expect({ path, status: res.status, length: (await res.bytes()).length }).toEqual({
        path,
        status: 200,
        length: size,
      });
    }
    writeFileSync(file, Buffer.alloc(size + 1, "b"));
    const handler = await fetch(new URL("/handler", server.url));
    expect({ status: handler.status, body: await handler.text() }).toEqual({ status: 500, body: "NotReadableError" });
    // A file route that cannot open its file yields to the next handler.
    const route = await fetch(new URL("/route", server.url));
    expect(await route.text()).toBe("no route");
  });

  it("Bun.write copies an unchanged file, and keeps the destination when the source changed", async () => {
    const { dir, file, blob } = await pinned(Buffer.alloc(100_000, "a"));
    using _ = dir;
    const destination = join(String(dir), "copy.bin");
    expect(await Bun.write(destination, blob)).toBe(100_000);
    expect(await Bun.file(destination).bytes()).toEqual(new Uint8Array(100_000).fill(97));

    writeFileSync(file, "swapped!");
    await expect(Bun.write(destination, blob)).rejects.toEqual(notReadable);
    expect(statSync(destination).size).toBe(100_000);
  });

  it("Bun.write of the file onto itself does not resolve with a wrong count", async () => {
    const { dir, file, blob } = await pinned();
    using _ = dir;
    if (isWindows) {
      // libuv takes a copy of a file onto itself as done.
      expect(await Bun.write(blob, blob)).toBe(5);
      expect(readFileSync(file, "utf8")).toBe("hello");
    } else {
      // The destination is truncated before the copy, as for a `Bun.file()`. Then the pin fails.
      await expect(Bun.write(blob, blob)).rejects.toEqual(notReadable);
    }
  });

  // The FIFO is smaller than the file, so the copy cannot end before this test drains it.
  it.skipIf(isWindows)("Bun.write rejects when the source changes during the copy", async () => {
    const size = 1024 * 1024;
    const { dir, file, blob } = await pinned(Buffer.alloc(size, "a"));
    using _ = dir;
    const fifo = join(String(dir), "fifo");
    mkfifo(fifo, 0o666);
    const readEnd = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
    const writeEnd = openSync(fifo, "w");
    try {
      const write = Bun.write(Bun.file(writeEnd), blob);
      let settled = false;
      const settle = () => void (settled = true);
      write.then(settle, settle);
      const chunk = Buffer.alloc(65536);
      let drained = 0;
      const drain = async (until: number) => {
        while (drained < until) {
          try {
            drained += readSync(readEnd, chunk, 0, Math.min(chunk.length, until - drained));
          } catch (err: any) {
            if (err.code !== "EAGAIN") throw err;
            // The FIFO is empty. A copy that is over does not fill it again.
            if (settled) return;
            await new Promise(resolve => setImmediate(resolve));
          }
        }
      };
      await drain(1);
      fs.appendFileSync(file, "b");
      await drain(size);
      expect(drained).toBe(size);
      await expect(write).rejects.toEqual(notReadable);
    } finally {
      closeSync(writeEnd);
      closeSync(readEnd);
    }
  });

  it("TLS options read a key through the pin", async () => {
    using dir = tempDir("open-as-blob-tls", { "key.pem": tls.key, "cert.pem": tls.cert });
    const keyFile = join(String(dir), "key.pem");
    const options = async () => ({
      key: await openAsBlob(keyFile),
      cert: await openAsBlob(join(String(dir), "cert.pem")),
    });
    {
      await using server = Bun.serve({ port: 0, tls: await options(), fetch: () => new Response("ok") });
      const res = await fetch(server.url, { tls: { rejectUnauthorized: false } });
      expect(await res.text()).toBe("ok");
    }
    const stale = await options();
    fs.appendFileSync(keyFile, "\n");
    expect(() => Bun.serve({ port: 0, tls: stale, fetch: () => new Response("ok") })).toThrow(notReadable);
  });

  it("Bun.spawn reads stdin through the pin", async () => {
    const { dir, file, blob } = await pinned();
    using _ = dir;
    const echo = () =>
      Bun.spawn({
        cmd: [bunExe(), "-e", "process.stdout.write(await Bun.stdin.text())"],
        env: bunEnv,
        stdin: blob,
        stdout: "pipe",
        stderr: "inherit",
      });
    {
      await using proc = echo();
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect({ stdout, exitCode }).toEqual({ stdout: "hello", exitCode: 0 });
    }
    writeFileSync(file, "swapped!");
    expect(echo).toThrow(notReadable);
  });

  // Only a read honours the pin. A write goes to the path, as it does for a `Bun.file()`.
  it("writes to the file through the Blob, and then fails its reads", async () => {
    const { dir, file, blob } = await pinned();
    using _ = dir;
    expect(await Bun.write(blob, "written")).toBe(7);
    expect(readFileSync(file, "utf8")).toBe("written");
    await expect(blob.text()).rejects.toEqual(notReadable);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "process.stdout.write('from the child')"],
      env: bunEnv,
      stdout: await openAsBlob(file),
      stderr: "inherit",
    });
    expect(await proc.exited).toBe(0);
    expect(readFileSync(file, "utf8")).toBe("from the child");

    // The size of the pin is not a limit for a copy into the file.
    const source = join(String(dir), "source.txt");
    writeFileSync(source, "a source that is longer");
    expect(await Bun.write(await openAsBlob(file), Bun.file(source))).toBe(23);
    expect(readFileSync(file, "utf8")).toBe("a source that is longer");

    // The name, `exists()` and `lastModified` are of the path, as they are for a `Bun.file()`.
    const written = await openAsBlob(file);
    fs.utimesSync(file, new Date(), new Date(1_000_000_000_000));
    expect(await Bun.write(written, "again")).toBe(5);
    // @ts-expect-error BunFile members are not on node's Blob
    expect({ lastModified: written.lastModified, exists: await written.exists() }).toEqual({
      lastModified: Math.floor(statSync(file).mtimeMs),
      exists: true,
    });

    // @ts-expect-error BunFile members are not on node's Blob
    await written.unlink();
    // @ts-expect-error BunFile members are not on node's Blob
    expect({ onDisk: existsSync(file), exists: await written.exists() }).toEqual({ onDisk: false, exists: false });
  });

  // The command opens the path. The Blob is the name of the file there, as a `Bun.file()` is.
  it("is its path in the shell", async () => {
    const { dir, file, blob } = await pinned();
    using _ = dir;
    expect(await $`cat ${blob}`.text()).toBe("hello");
    expect(await $`cat < ${blob}`.text()).toBe("hello");
    await $`echo first > ${blob}`;
    await $`echo second >> ${blob}`;
    expect(readFileSync(file, "utf8")).toBe("first\nsecond\n");
    expect(await $`cat < ${blob}`.text()).toBe("first\nsecond\n");
  });

  it("is its path for import()", async () => {
    using dir = tempDir("open-as-blob-import", { "module.js": "export default 42;" });
    const url = URL.createObjectURL(await openAsBlob(join(String(dir), "module.js")));
    try {
      expect((await import(url)).default).toBe(42);
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  it("Bun.Image reads it as a Response body", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const { dir, file, blob } = await pinned(png);
    using _ = dir;
    const image = new Bun.Image(blob);
    expect((await new Response(image.png()).bytes()).subarray(1, 4)).toEqual(Buffer.from("PNG"));
    expect(await new Bun.Image(blob).metadata()).toEqual({ width: 1, height: 1, format: "png" });

    fs.appendFileSync(file, "b");
    // `image` has the bytes that it read through the pin.
    expect(await image.metadata()).toEqual({ width: 1, height: 1, format: "png" });
    expect(() => new Response(new Bun.Image(blob).png())).toThrow(notReadable);
    await expect(new Bun.Image(blob).metadata()).rejects.toEqual(notReadable);
  });

  it("takes a file descriptor as before", async () => {
    const { dir, file } = await pinned();
    using _ = dir;
    const fd = openSync(file, "r");
    try {
      // @ts-expect-error node takes a path only
      expect(await (await openAsBlob(fd)).text()).toBe("hello");
    } finally {
      closeSync(fd);
    }
  });

  it("sends no Content-Type for an empty type", async () => {
    const { dir, file, blob } = await pinned();
    using _ = dir;
    await using server = Bun.serve({ port: 0, fetch: req => new Response(String(req.headers.get("content-type"))) });
    expect(await (await fetch(server.url, { method: "POST", body: blob })).text()).toBe("null");
    const typed = await openAsBlob(file, { type: "text/x-pinned" });
    expect(await (await fetch(server.url, { method: "POST", body: typed })).text()).toBe("text/x-pinned");
  });
});

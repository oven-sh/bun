import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { appendFileSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

it("offset should work in Bun.file() #4963", async () => {
  const filename = tmpdir() + "/bun.test.offset.txt";
  await Bun.write(filename, "contents");
  const file = Bun.file(filename);
  const slice = file.slice(2, file.size);
  const contents = await slice.text();
  expect(contents).toBe("ntents");
});

// do_read_loop picks its read target per iteration: the 64 KB stack buffer
// when self.buffer's spare capacity is smaller, otherwise the Vec's spare
// capacity directly. Cover both branches plus the max_length cap so the
// branch selection and the commit_spare path stay tied to the same decision.
describe("Bun.file read-loop target selection", () => {
  function pattern(size: number, seed: number) {
    const out = Buffer.alloc(size);
    for (let i = 0; i < size; i++) out[i] = (i * seed + 7) & 0xff;
    return out;
  }

  it.each([
    ["small file (stack-buffer path)", 1024],
    ["64 KB boundary", 64 * 1024],
    ["large file (spare-capacity path)", 256 * 1024 + 17],
  ] as const)("%s", async (_label, size) => {
    const bytes = pattern(size, 131);
    using dir = tempDir("bun-file-read-target", {});
    const p = path.join(String(dir), "data.bin");
    await Bun.write(p, bytes);

    const buf = new Uint8Array(await Bun.file(p).arrayBuffer());
    expect(buf.length).toBe(size);
    expect(Bun.hash(buf)).toBe(Bun.hash(bytes));
  });

  it("slice(offset, end) honours max_length across the stack/spare split", async () => {
    const size = 256 * 1024;
    const bytes = pattern(size, 97);
    using dir = tempDir("bun-file-read-slice", {});
    const p = path.join(String(dir), "data.bin");
    await Bun.write(p, bytes);

    // 70_000 bytes: larger than one stack-buffer fill, smaller than the whole
    // file, and not a multiple of 64 KB.
    const start = 10;
    const end = 70_010;
    const buf = new Uint8Array(await Bun.file(p).slice(start, end).arrayBuffer());
    expect(buf.length).toBe(end - start);
    expect(Bun.hash(buf)).toBe(Bun.hash(bytes.subarray(start, end)));
  });
});

// `syscr` in /proc/self/io counts the read syscalls of a process.
const hasSyscr =
  isLinux &&
  (() => {
    try {
      return /^syscr: \d+$/m.test(readFileSync("/proc/self/io", "utf8"));
    } catch {
      return false;
    }
  })();

// After a stat, a reader stops at the size from its own fstat and issues no read() to find EOF.
describe.skipIf(!hasSyscr)("Bun.file read syscalls for a file of known size", () => {
  const fixture = /* js */ `
    import { readFileSync } from "node:fs";
    const file = process.argv.at(-1);
    const syscr = () => Number(/^syscr: (\\d+)$/m.exec(readFileSync("/proc/self/io", "utf8"))[1]);
    const expected = readFileSync(file, "utf8");
    const drain = async stream => {
      const decoder = new TextDecoder();
      let out = "";
      for await (const chunk of stream) out += decoder.decode(chunk, { stream: true });
      return out + decoder.decode();
    };
    const N = 100;
    async function perOp(op) {
      for (let i = 0; i < 5; i++) await op();
      const before = syscr();
      let ok = true;
      for (let i = 0; i < N; i++) ok = (await op()) === expected && ok;
      const reads = (syscr() - before) / N;
      return { ok, readsPerOp: Math.round(reads), reads };
    }
    const open = touch => { const f = Bun.file(file); touch(f); return f; };
    console.log(JSON.stringify({
      lastModifiedThenText: await perOp(() => open(f => f.lastModified).text()),
      lastModifiedThenStream: await perOp(() => drain(open(f => f.lastModified).stream())),
      sizeThenText: await perOp(() => open(f => f.size).text()),
      sizeThenStream: await perOp(() => drain(open(f => f.size).stream())),
      bodyStream: await perOp(() => drain(new Response(Bun.file(file)).body)),
    }));
  `;

  it("one read() per operation, no EOF probe", async () => {
    using dir = tempDir("bun-file-read-count", { "data.txt": Buffer.alloc(64 * 1024, "a").toString() });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture, path.join(String(dir), "data.txt")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const measured: Record<string, { ok: boolean; readsPerOp: number; reads: number }> = JSON.parse(stdout);
    const counts = Object.fromEntries(
      Object.entries(measured).map(([k, v]) => [k, { ok: v.ok, readsPerOp: v.readsPerOp }]),
    );
    const one = { ok: true, readsPerOp: 1 };
    const want = {
      lastModifiedThenText: one,
      lastModifiedThenStream: one,
      sizeThenText: one,
      sizeThenStream: one,
      bodyStream: one,
    };
    if (!Bun.deepEquals(counts, want)) console.error("read syscalls per operation, not rounded:", measured);
    // One read() returns the whole 64 KiB. A second one per operation is the EOF probe.
    expect(counts).toEqual(want);
    expect(exitCode).toBe(0);
  });
});

// A stat size is a hint: a procfs file reports 0 bytes and has content, and a file can grow.
describe("a stat of a Bun.file() does not limit a later read", () => {
  const triggers = {
    ".size": (f: Bun.BunFile) => void f.size,
    "exists()": (f: Bun.BunFile) => f.exists(),
    ".lastModified": (f: Bun.BunFile) => void f.lastModified,
    "structuredClone()": (f: Bun.BunFile) => void structuredClone(f),
  };
  type Trigger = keyof typeof triggers;
  const drain = async (stream: ReadableStream<Uint8Array>) =>
    Buffer.from(await new Response(stream).bytes()).toString();
  const echo = () => Bun.serve({ port: 0, fetch: async req => new Response(await req.text()) });

  describe.skipIf(!isLinux)("procfs file (st_size is 0)", () => {
    const procfs = "/proc/version";
    // Read inside the tests: a skipped describe still runs this callback on macOS and Windows.
    const content = () => readFileSync(procfs, "utf8");

    it.each(Object.keys(triggers) as Trigger[])("%s, then every reader returns the content", async name => {
      const expected = content();
      const touched = async () => {
        const f = Bun.file(procfs);
        await triggers[name](f);
        return f;
      };
      await using server = echo();
      const form = new FormData();
      form.append("f", await touched());

      expect(expected.length).toBeGreaterThan(0);
      expect({
        size: (await touched()).size,
        text: await (await touched()).text(),
        bytes: Buffer.from(await (await touched()).bytes()).toString(),
        arrayBuffer: Buffer.from(await (await touched()).arrayBuffer()).toString(),
        stream: await drain((await touched()).stream()),
        responseBody: await drain(new Response(await touched()).body!),
        responseText: await new Response(await touched()).text(),
        formData: await ((await new Response(form).formData()).get("f") as File).text(),
        fetchUpload: await (await fetch(server.url, { method: "POST", body: await touched() })).text(),
      }).toEqual({
        size: 0,
        text: expected,
        bytes: expected,
        arrayBuffer: expected,
        stream: expected,
        responseBody: expected,
        responseText: expected,
        formData: expected,
        fetchUpload: expected,
      });
    });

    it.each(Object.keys(triggers) as Trigger[])("%s, then a slice still reads its window", async name => {
      const expected = content();
      const f = Bun.file(procfs);
      await triggers[name](f);
      expect({
        text: await f.slice(0, 10).text(),
        responseBody: await drain(new Response(f.slice(0, 10)).body!),
        tail: await f.slice(6).text(),
      }).toEqual({
        text: expected.slice(0, 10),
        responseBody: expected.slice(0, 10),
        tail: expected.slice(6),
      });
    });
  });

  it.each(Object.keys(triggers) as Trigger[])("%s, then the file grows: a read returns all of it", async name => {
    using dir = tempDir("bun-file-read-grew", { "data.txt": "1234" });
    const p = path.join(String(dir), "data.txt");
    const f = Bun.file(p);
    await triggers[name](f);
    writeFileSync(p, "12345678");
    expect({ text: await f.text(), stream: await drain(f.stream()) }).toEqual({
      text: "12345678",
      stream: "12345678",
    });
  });

  it("a fetch upload after .size sends the file as it is now", async () => {
    // 40 KiB and more takes the sendfile path where there is one.
    const before = Buffer.alloc(40 * 1024, "a").toString();
    const after = before + Buffer.alloc(40 * 1024, "b").toString();
    using dir = tempDir("bun-file-read-upload", { "data.txt": before });
    const p = path.join(String(dir), "data.txt");
    await using server = echo();

    const f = Bun.file(p);
    expect(f.size).toBe(before.length);
    writeFileSync(p, after);
    const sent = await (await fetch(server.url, { method: "POST", body: f })).text();
    expect(Bun.hash(sent)).toBe(Bun.hash(after));
    expect(sent.length).toBe(after.length);
  });

  it("an S3 upload after .size sends the file as it is now", async () => {
    const received: number[] = [];
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method === "PUT") received.push((await req.arrayBuffer()).byteLength);
        return new Response("", { headers: { etag: '"x"' } });
      },
    });
    const client = new Bun.S3Client({
      endpoint: server.url.href,
      bucket: "b",
      accessKeyId: "a",
      secretAccessKey: "b",
    });
    using dir = tempDir("bun-file-read-s3", { "data.txt": "0123456789" });
    const p = path.join(String(dir), "data.txt");

    const f = Bun.file(p);
    expect(f.size).toBe(10);
    appendFileSync(p, "abcdefghij");
    expect({ written: await client.write("key", f), received }).toEqual({ written: 20, received: [20] });
  });

  it("an empty file reads empty after a stat", async () => {
    using dir = tempDir("bun-file-read-empty", { "empty.txt": "" });
    const f = Bun.file(path.join(String(dir), "empty.txt"));
    expect(await f.exists()).toBe(true);
    expect({ size: f.size, text: await f.text(), stream: await drain(f.stream()) }).toEqual({
      size: 0,
      text: "",
      stream: "",
    });
  });

  it("exists() sees a file that is created after the first call", async () => {
    using dir = tempDir("bun-file-exists-later", {});
    const p = path.join(String(dir), "later.txt");
    const f = Bun.file(p);
    const before = { exists: await f.exists(), size: f.size };
    writeFileSync(p, "hello");
    expect({ before, after: { exists: await f.exists(), size: f.size, text: await f.text() } }).toEqual({
      before: { exists: false, size: 0 },
      after: { exists: true, size: 5, text: "hello" },
    });
  });
});

// Each reader returns what the file has at the time of the read, whatever stat ran before.
describe("a read of a Bun.file() returns the file as it is now", () => {
  const stats: Record<string, (f: Bun.BunFile) => unknown> = {
    "no stat": () => {},
    ".size": f => f.size,
    "exists()": f => f.exists(),
    ".lastModified": f => f.lastModified,
    "structuredClone()": f => structuredClone(f),
  };
  const changes: Record<string, (p: string) => void> = {
    "no change": () => {},
    "grows": p => appendFileSync(p, "abcdefghij"),
    "shrinks": p => writeFileSync(p, "0123"),
    "is rewritten": p => writeFileSync(p, "ABCDEFGHIJ"),
  };
  const readers: Record<string, (f: Bun.BunFile) => Promise<string>> = {
    "text()": f => f.text(),
    "bytes()": async f => Buffer.from(await f.bytes()).toString(),
    "arrayBuffer()": async f => Buffer.from(await f.arrayBuffer()).toString(),
    "stream()": async f => Buffer.from(await Bun.readableStreamToBytes(f.stream())).toString(),
    "new Response(f).text()": f => new Response(f).text(),
    "slice(2, 30).text()": f => f.slice(2, 30).text(),
  };

  it.each(Object.keys(stats))("after %s", async stat => {
    using dir = tempDir("bun-file-read-now", {});
    const wrong: string[] = [];
    let n = 0;
    for (const [change, mutate] of Object.entries(changes)) {
      for (const [reader, read] of Object.entries(readers)) {
        const p = path.join(String(dir), `${n++}.txt`);
        writeFileSync(p, "0123456789");
        const f = Bun.file(p);
        await stats[stat](f);
        mutate(p);
        const now = readFileSync(p, "utf8");
        const expected = reader.startsWith("slice") ? now.slice(2, 30) : now;
        const got = await read(f);
        if (got !== expected) wrong.push(`the file ${change}, ${reader}: ${JSON.stringify(got)}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

// After a stat a reader stops at the size from its own fstat at open. With no stat it reads to EOF.
describe("a file that grows while a stream reads it", () => {
  const MiB = 1024 * 1024;
  const appended = 64 * 1024;

  it.each([
    ["a file that nothing statted", MiB + appended, (_f: Bun.BunFile) => {}],
    ["a file after .size", MiB, (f: Bun.BunFile) => void f.size],
    ["a file after exists()", MiB, (f: Bun.BunFile) => f.exists()],
    ["a file after .lastModified", MiB, (f: Bun.BunFile) => void f.lastModified],
    ["a file after structuredClone()", MiB, (f: Bun.BunFile) => void structuredClone(f)],
  ] as const)("%s: the stream returns %d bytes", async (_name, total, stat) => {
    using dir = tempDir("bun-file-read-stream-grows", {});
    const p = path.join(String(dir), "data.bin");
    writeFileSync(p, Buffer.alloc(MiB, "a"));
    const f = Bun.file(p);
    await stat(f);

    const reader = f.stream().getReader();
    let chunk = await reader.read();
    appendFileSync(p, Buffer.alloc(appended, "b"));
    let received = 0;
    while (!chunk.done) {
      received += chunk.value.length;
      chunk = await reader.read();
    }
    expect(received).toBe(total);
  });
});

// slice() runs no stat: only a file that something statted before has a length it can use.
describe("Bun.file().slice() after .size matches an in-memory Blob", () => {
  const data = "0123456789";
  const cases: [number?, number?][] = [
    [],
    [3],
    [0, 4],
    [2, 8],
    [5, 5000],
    [10],
    [15],
    [20, 30],
    [-3],
    [-50, 3],
    [2, -2],
    [-5, -2],
    [-2, -5],
    [-5, Infinity],
    [0, 0],
  ];
  const drain = async (stream: ReadableStream<Uint8Array>) =>
    Buffer.from(await new Response(stream).bytes()).toString();
  const statted = (p: string) => {
    const f = Bun.file(p);
    void f.size;
    return f;
  };

  it("size, text() and stream() of each window", async () => {
    using dir = tempDir("bun-file-slice-matrix", { "data.txt": data });
    const open = () => statted(path.join(String(dir), "data.txt"));
    const blob = new Blob([data]);

    const got = [];
    const want = [];
    for (const args of cases) {
      got.push({
        args,
        size: open().slice(...args).size,
        text: await open()
          .slice(...args)
          .text(),
        stream: await drain(
          open()
            .slice(...args)
            .stream(),
        ),
      });
      const expected = await blob.slice(...args).text();
      want.push({ args, size: blob.slice(...args).size, text: expected, stream: expected });
    }
    expect(got).toEqual(want);
  });

  it("slices of slices", async () => {
    using dir = tempDir("bun-file-slice-nested", { "data.txt": data });
    const f = () => statted(path.join(String(dir), "data.txt"));
    const blob = new Blob([data]);
    expect({
      inner: await f().slice(2, 8).slice(-3).text(),
      fromEndTwice: await f().slice(-5).slice(1, -1).text(),
      pastEof: await f().slice(5, 5000).slice(-2).text(),
    }).toEqual({
      inner: await blob.slice(2, 8).slice(-3).text(),
      fromEndTwice: await blob.slice(-5).slice(1, -1).text(),
      pastEof: await blob.slice(5, 5000).slice(-2).text(),
    });
  });

  it("expect(slice).toHaveLength() is the length of the window in the file", async () => {
    using dir = tempDir("bun-file-slice-length", { "data.txt": data });
    expect(statted(path.join(String(dir), "data.txt")).slice(5, 5000)).toHaveLength(5);
  });

  it("an index from the end counts from the length that .size reports", async () => {
    using dir = tempDir("bun-file-slice-stale", { "data.txt": data });
    const p = path.join(String(dir), "data.txt");
    const f = Bun.file(p);
    expect(f.size).toBe(10);
    writeFileSync(p, data + "abcdefghij");
    const tail = f.slice(-3);
    expect({ fileSize: f.size, size: tail.size, text: await tail.text() }).toEqual({
      fileSize: 10,
      size: 3,
      text: "789",
    });
  });
});

// A stat pins `.size` and exists() of the handle, so slice() must leave the handle as it found it.
describe("slice() of a Bun.file() runs no stat", () => {
  const data = "0123456789";

  it.each([
    ["slice(-3)", (f: Bun.BunFile) => f.slice(-3)],
    ["slice(0, 5).size", (f: Bun.BunFile) => f.slice(0, 5).size],
    ["slice(0, 5).exists()", (f: Bun.BunFile) => f.slice(0, 5).exists()],
  ] as const)("%s, then the file grows: .size of the file is the new length", async (_name, call) => {
    using dir = tempDir("bun-file-slice-no-stat", { "data.txt": data });
    const p = path.join(String(dir), "data.txt");
    const f = Bun.file(p);
    await call(f);
    appendFileSync(p, "abcdefghij");
    expect(f.size).toBe(20);
  });

  it("slice(-2), then the file is removed: exists() of the file is false", async () => {
    using dir = tempDir("bun-file-slice-no-stat", { "data.txt": data });
    const p = path.join(String(dir), "data.txt");
    const f = Bun.file(p);
    f.slice(-2);
    unlinkSync(p);
    expect(await f.exists()).toBe(false);
  });

  it("slice(-5), then the file grows: the file still reads whole", async () => {
    const before = "abcdefghijklmnopqrstuvwxyz";
    using dir = tempDir("bun-file-slice-no-stat", { "data.txt": before });
    const p = path.join(String(dir), "data.txt");
    const file = Bun.file(p);
    file.slice(-5);
    appendFileSync(p, data);
    expect({
      body: (await Bun.readableStreamToBytes(new Response(file).body!)).length,
      size: file.size,
      text: await file.text(),
    }).toEqual({ body: 36, size: 36, text: before + data });
  });
});

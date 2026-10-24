import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { appendFileSync, readFileSync, truncateSync, writeFileSync } from "node:fs";
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

const asks: Record<string, (f: Bun.BunFile) => unknown> = {
  ".size": f => f.size,
  "exists()": f => f.exists(),
  "structuredClone()": f => structuredClone(f),
};
// `new Response(stream)` takes the Blob back out of an unread stream. This reads the stream itself.
const drain = async (stream: ReadableStream<Uint8Array>) => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
};

// `.size`, exists() and structuredClone() ask the file system for the size. The answer is not the byte budget of a later read.
describe("a read of a Bun.file() returns the file as it is now", () => {
  const changes: Record<string, (p: string) => void> = {
    "does not change": () => {},
    "grows": p => appendFileSync(p, "abcdefghij"),
    "shrinks": p => writeFileSync(p, "0123"),
    "is rewritten": p => writeFileSync(p, "ABCDEFGHIJ"),
  };
  const readers: Record<string, (f: Bun.BunFile) => Promise<string>> = {
    "text()": f => f.text(),
    "bytes()": async f => Buffer.from(await f.bytes()).toString(),
    "arrayBuffer()": async f => Buffer.from(await f.arrayBuffer()).toString(),
    "stream()": f => drain(f.stream()),
    "new Response(f).text()": f => new Response(f).text(),
    "new Response(f).body": f => drain(new Response(f).body!),
    "FormData part": async f => {
      const form = new FormData();
      form.append("part", f);
      return ((await new Response(form).formData()).get("part") as Blob).text();
    },
  };

  it.each([
    ["nothing", (_f: Bun.BunFile) => {}],
    [".lastModified", (f: Bun.BunFile) => f.lastModified],
    ["expect().toHaveLength()", (f: Bun.BunFile) => expect(f).toHaveLength(10)],
    ...Object.entries(asks),
  ])("after %s", async (_name, ask) => {
    using dir = tempDir("bun-file-read-now", {});
    const wrong: string[] = [];
    let n = 0;
    for (const [change, mutate] of Object.entries(changes)) {
      for (const [reader, read] of Object.entries(readers)) {
        const p = path.join(String(dir), `${n++}.txt`);
        writeFileSync(p, "0123456789");
        const f = Bun.file(p);
        await ask(f);
        mutate(p);
        const got = await read(f);
        if (got !== readFileSync(p, "utf8")) wrong.push(`the file ${change}, ${reader}: ${JSON.stringify(got)}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("a fetch upload after .size sends the file as it is now", async () => {
    // From 32 KiB on, fetch() uses sendfile where it can.
    const before = Buffer.alloc(40 * 1024, "a").toString();
    const after = before + Buffer.alloc(40 * 1024, "b").toString();
    using dir = tempDir("bun-file-read-upload", { "data.txt": before });
    const p = path.join(String(dir), "data.txt");
    await using server = Bun.serve({ port: 0, fetch: async req => new Response(await req.text()) });

    const f = Bun.file(p);
    expect(f.size).toBe(before.length);
    writeFileSync(p, after);
    const sent = await (await fetch(server.url, { method: "POST", body: f })).text();
    expect({ length: sent.length, same: sent === after }).toEqual({ length: after.length, same: true });
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

  // A procfs file is a regular file whose st_size is 0, and it has content.
  it.skipIf(!isLinux).each(Object.keys(asks))("%s of a procfs file, then a stream returns the content", async ask => {
    const expected = readFileSync("/proc/version", "utf8");
    const asked = async () => {
      const f = Bun.file("/proc/version");
      await asks[ask](f);
      return f;
    };
    expect(expected).not.toBe("");
    expect({
      stream: await drain((await asked()).stream()),
      body: await drain(new Response(await asked()).body!),
    }).toEqual({ stream: expected, body: expected });
  });

  it("Bun.inspect() of a Response does not limit its body", async () => {
    using dir = tempDir("bun-file-read-inspect", { "data.txt": "0123456789" });
    const p = path.join(String(dir), "data.txt");
    const response = new Response(Bun.file(p));
    expect(Bun.inspect(response)).toStartWith("Response (10 bytes) {");
    appendFileSync(p, "abcdefghij");
    expect(await response.text()).toBe("0123456789abcdefghij");
  });

  it(".lastModified after a write gives .size the new length", async () => {
    using dir = tempDir("bun-file-size-after-write", { "data.txt": "0123456789" });
    const f = Bun.file(path.join(String(dir), "data.txt"));
    expect(f.size).toBe(10);
    await f.write(Buffer.alloc(25, "a"));
    expect(f.lastModified).toBeGreaterThan(0);
    expect({ size: f.size, text: await f.text() }).toEqual({ size: 25, text: Buffer.alloc(25, "a").toString() });
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

// A reader of a handle that was asked for its size stops at the size from its own fstat, so it issues no read() to find EOF.
describe.skipIf(!hasSyscr)("Bun.file read syscalls", () => {
  const fixture = /* js */ `
    import { readFileSync } from "node:fs";
    const file = process.argv.at(-1);
    const syscr = () => Number(/^syscr: (\\d+)$/m.exec(readFileSync("/proc/self/io", "utf8"))[1]);
    const content = readFileSync(file, "utf8");
    const drain = async stream => {
      const decoder = new TextDecoder();
      let out = "";
      for await (const chunk of stream) out += decoder.decode(chunk, { stream: true });
      return out + decoder.decode();
    };
    const N = 100;
    async function perOp(op, expected = content) {
      for (let i = 0; i < 5; i++) await op();
      const before = syscr();
      let ok = true;
      for (let i = 0; i < N; i++) ok = (await op()) === expected && ok;
      return { ok, readsPerOp: Math.round((syscr() - before) / N) };
    }
    const open = ask => { const f = Bun.file(file); ask(f); return f; };
    const asked = async () => { const f = Bun.file(file); await f.exists(); return f; };
    console.log(JSON.stringify({
      text: await perOp(() => Bun.file(file).text()),
      lastModifiedThenText: await perOp(() => open(f => f.lastModified).text()),
      sizeThenText: await perOp(() => open(f => f.size).text()),
      existsThenText: await perOp(async () => (await asked()).text()),
      sizeThenStream: await perOp(() => drain(open(f => f.size).stream())),
      sizeThenSliceText: await perOp(() => open(f => f.size).slice(100).text(), content.slice(100)),
      sizeThenSliceStream: await perOp(() => drain(open(f => f.size).slice(100).stream()), content.slice(100)),
      bodyStream: await perOp(() => drain(new Response(Bun.file(file)).body)),
    }));
  `;

  it("an asked handle takes one read() per operation", async () => {
    using dir = tempDir("bun-file-read-count", { "data.txt": Buffer.alloc(64 * 1024, "a").toString() });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture, path.join(String(dir), "data.txt")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    // One read() returns the whole 64 KiB. A handle that nothing asked for its size takes a second one, which finds EOF.
    const one = { ok: true, readsPerOp: 1 };
    const two = { ok: true, readsPerOp: 2 };
    expect(JSON.parse(stdout)).toEqual({
      text: two,
      lastModifiedThenText: two,
      sizeThenText: one,
      existsThenText: one,
      sizeThenStream: one,
      sizeThenSliceText: one,
      sizeThenSliceStream: one,
      bodyStream: one,
    });
    expect(exitCode).toBe(0);
  });
});

// A stream of a handle that was asked for its size ends at the size of the file when the stream opens it. Any other stream reads to EOF.
describe("a file that grows while a stream reads it", () => {
  const MiB = 1024 * 1024;
  const appended = 64 * 1024;
  // Takes the first chunk, appends to the file, then reads to the end of the stream.
  async function readWhileTheFileGrows(stream: ReadableStream<Uint8Array>, p: string) {
    const reader = stream.getReader();
    let chunk = await reader.read();
    appendFileSync(p, Buffer.alloc(appended, "b"));
    const received: Uint8Array[] = [];
    while (!chunk.done) {
      received.push(chunk.value);
      chunk = await reader.read();
    }
    return Buffer.concat(received);
  }

  it.each([
    ["nothing", MiB + appended, (_f: Bun.BunFile) => {}],
    [".lastModified", MiB + appended, (f: Bun.BunFile) => void f.lastModified],
    [".size", MiB, asks[".size"]],
    ["exists()", MiB, asks["exists()"]],
    ["structuredClone()", MiB, asks["structuredClone()"]],
  ] as const)("after %s the stream returns %d bytes", async (_name, total, ask) => {
    using dir = tempDir("bun-file-read-stream-grows", {});
    const p = path.join(String(dir), "data.bin");
    writeFileSync(p, Buffer.alloc(MiB, "a"));
    const f = Bun.file(p);
    await ask(f);

    const bytes = await readWhileTheFileGrows(f.stream(), p);
    expect({ length: bytes.length, same: bytes.equals(readFileSync(p).subarray(0, total)) }).toEqual({
      length: total,
      same: true,
    });
  });

  // A slice has its own window. Its stream does not stop at the size that the file has when the stream opens it.
  it.each([
    ["slice.stream()", (slice: Blob) => slice.stream()],
    ["new Response(slice).body", (slice: Blob) => new Response(slice).body!],
  ] as const)("%s of a slice of an asked handle reads to the end of the file", async (_name, open) => {
    using dir = tempDir("bun-file-read-slice-grows", {});
    const p = path.join(String(dir), "data.bin");
    writeFileSync(p, Buffer.alloc(2 * MiB, "a"));
    const f = Bun.file(p);
    expect(f.size).toBe(2 * MiB);
    const slice = f.slice(0, 2 * MiB);
    truncateSync(p, MiB);

    const bytes = await readWhileTheFileGrows(open(slice), p);
    expect({ length: bytes.length, same: bytes.equals(readFileSync(p)) }).toEqual({
      length: MiB + appended,
      same: true,
    });
  });
});

// slice() runs no stat. After `.size` it places its window against the length that `.size` found, as an in-memory Blob does.
describe("Bun.file().slice() after .size", () => {
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
    [2 ** 44],
    [2 ** 44, 2 ** 44 + 4],
  ];
  const asked = (p: string, ask: (f: Bun.BunFile) => unknown = f => f.size) => {
    const f = Bun.file(p);
    ask(f);
    return f;
  };

  it("size, text() and stream() of each window match an in-memory Blob", async () => {
    using dir = tempDir("bun-file-slice-matrix", { "data.txt": data });
    const open = () => asked(path.join(String(dir), "data.txt"));
    const blob = new Blob([data]);

    const got = [];
    const want = [];
    for (const args of cases) {
      const windows = [open().slice(...args), open().slice(...args), open().slice(...args)];
      got.push({
        args,
        size: windows[0].size,
        text: await windows[1].text(),
        stream: await drain(windows[2].stream()),
      });
      const expected = await blob.slice(...args).text();
      want.push({ args, size: blob.slice(...args).size, text: expected, stream: expected });
    }
    expect(got).toEqual(want);
  });

  it("slices of slices match an in-memory Blob", async () => {
    using dir = tempDir("bun-file-slice-nested", { "data.txt": data });
    const f = () => asked(path.join(String(dir), "data.txt"));
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
    expect(f().slice(5, 5000)).toHaveLength(5);
  });

  it("`.size` that answers from the stat of `.lastModified` places later slices too", async () => {
    using dir = tempDir("bun-file-slice-cached-stat", { "data.txt": data });
    const f = asked(path.join(String(dir), "data.txt"), f => [f.lastModified, f.size]);
    expect({ size: f.slice(0, 100).size, tail: await f.slice(-3).text() }).toEqual({ size: 10, tail: "789" });
  });

  // `.lastModified` and a body stream stat the file for themselves. They do not ask the handle for its size.
  it.each([
    [".lastModified", (f: Bun.BunFile) => void f.lastModified],
    ["new Response(file).body", (f: Bun.BunFile) => void new Response(f).body],
  ] as const)("%s, then the file grows: slice(0, 15) is the 15 bytes", async (_name, look) => {
    using dir = tempDir("bun-file-slice-other-stat", { "data.txt": data });
    const p = path.join(String(dir), "data.txt");
    const f = asked(p, look);
    appendFileSync(p, "abcdefghij");
    const slice = f.slice(0, 15);
    expect({ size: slice.size, text: await slice.text() }).toEqual({ size: 15, text: "0123456789abcde" });
  });

  it("a view that comes back out of a body, a stream or a structured clone keeps its size and its slices", async () => {
    using dir = tempDir("bun-file-derived-view", { "data.txt": data });
    const p = path.join(String(dir), "data.txt");
    const throughBody = async (blob: Blob) => {
      const response = new Response(blob);
      expect(response.body).toBeInstanceOf(ReadableStream);
      return await response.blob();
    };
    const headers = (() => {
      const response = new Response(Bun.file(p).slice(5));
      expect(response.body).toBeInstanceOf(ReadableStream);
      const clone = response.clone();
      return [Bun.inspect(response).split("\n")[0], Bun.inspect(clone).split("\n")[0]];
    })();
    expect({
      bodySize: (await throughBody(Bun.file(p))).size,
      bodyTail: await (await throughBody(Bun.file(p))).slice(-4).text(),
      sliceBodySize: (await throughBody(Bun.file(p).slice(5))).size,
      sliceBodyTail: await (await throughBody(Bun.file(p).slice(5))).slice(-4).text(),
      streamTail: await (await new Response(asked(p).stream()).blob()).slice(-4).text(),
      cloneSize: structuredClone(asked(p)).size,
      cloneTail: await structuredClone(asked(p)).slice(-4).text(),
      sliceCloneSize: structuredClone(asked(p).slice(4)).size,
      partTail: await new Blob([asked(p)]).slice(-4).text(),
      slicePartSize: new Blob([asked(p).slice(5, 5000)]).size,
      responsePartTail: await (await new Response([asked(p)]).blob()).slice(-4).text(),
      headers,
    }).toEqual({
      bodySize: 10,
      bodyTail: "6789",
      sliceBodySize: 5,
      sliceBodyTail: "6789",
      streamTail: "6789",
      cloneSize: 10,
      cloneTail: "6789",
      sliceCloneSize: 6,
      partTail: "6789",
      slicePartSize: 5,
      responsePartTail: "6789",
      headers: ["Response (5 bytes) {", "Response (5 bytes) {"],
    });
  });
});

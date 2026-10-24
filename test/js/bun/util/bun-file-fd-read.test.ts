import { describe, expect, test } from "bun:test";
import { closeSync, openSync, readSync, writeSync } from "fs";
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

  test("empty regular file via fd resolves with empty content", async () => {
    using dir = tempDir("bun-file-fd-read", { "fd-empty.txt": "" });
    const path = join(String(dir), "fd-empty.txt");

    expect(await withFd(path, fd => Bun.file(fd).text())).toBe("");
    expect((await withFd(path, fd => Bun.file(fd).arrayBuffer())).byteLength).toBe(0);
  });
});

const streamText = async (stream: ReadableStream<Uint8Array>) => {
  let text = "";
  for await (const chunk of stream) text += Buffer.from(chunk);
  return text;
};

// stdin is one open file description that this process shares with the process that
// started it. The parent here reads the first line before it starts the child, and reads
// again after the child exits. A stream of stdin starts at the position and leaves it
// after the bytes it took, and `left` is what the next reader gets.
describe("a stream of stdin when stdin is a regular file inherited at an offset", () => {
  const consumed = "SECRET-HEADER\n";
  const rest = "body1\nbody2\n";

  async function runAfterParentRead(js: string) {
    using dir = tempDir("bun-stdin-file-offset", { "in.txt": consumed + rest });
    const fd = openSync(join(String(dir), "in.txt"), "r");
    try {
      readSync(fd, Buffer.alloc(consumed.length));
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", js],
        env: bunEnv,
        stdin: fd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const buf = Buffer.alloc(consumed.length + rest.length);
      return { stdout, stderr, exitCode, left: buf.toString("utf8", 0, readSync(fd, buf)) };
    } finally {
      closeSync(fd);
    }
  }

  async function runEach(scripts: Record<string, string>) {
    const names = Object.keys(scripts);
    const results = await Promise.all(names.map(name => runAfterParentRead(scripts[name])));
    return Object.fromEntries(names.map((name, i) => [name, results[i]]));
  }

  const print = "process.stdout.write(JSON.stringify(s))";
  const readsTheRest = { stdout: JSON.stringify(rest), stderr: "", exitCode: 0, left: "" };

  test("Bun.stdin.stream() and the console iterator", async () => {
    expect(
      await runEach({
        "Bun.stdin.stream()": `let s = ""; for await (const c of Bun.stdin.stream()) s += Buffer.from(c); ${print};`,
        "new Response(Bun.stdin.stream()).text()": `const s = await new Response(Bun.stdin.stream()).text(); ${print};`,
        "Bun.file(0).stream()": `const s = await new Response(Bun.file(0).stream()).text(); ${print};`,
        "Bun.stdin.size, then Bun.stdin.stream()": `Bun.stdin.size; let s = ""; for await (const c of Bun.stdin.stream()) s += Buffer.from(c); ${print};`,
        "for await (const line of console)": `const lines = []; for await (const line of console) lines.push(line); const s = lines.join("\\n"); ${print};`,
      }),
    ).toEqual({
      "Bun.stdin.stream()": readsTheRest,
      "new Response(Bun.stdin.stream()).text()": readsTheRest,
      "Bun.file(0).stream()": readsTheRest,
      "Bun.stdin.size, then Bun.stdin.stream()": readsTheRest,
      "for await (const line of console)": readsTheRest,
    });
  });

  test("a Response over Bun.stdin", async () => {
    expect(
      await runEach({
        "new Response(Bun.stdin).body": `let s = ""; for await (const c of new Response(Bun.stdin).body) s += Buffer.from(c); ${print};`,
        "new Response(Bun.stdin).clone()": `const s = await new Response(Bun.stdin).clone().text(); ${print};`,
        "HTMLRewriter": `const s = await new HTMLRewriter().transform(new Response(Bun.stdin)).text(); ${print};`,
      }),
    ).toEqual({
      "new Response(Bun.stdin).body": readsTheRest,
      "new Response(Bun.stdin).clone()": readsTheRest,
      "HTMLRewriter": readsTheRest,
    });
  });

  // prompt() reads stdin through a 4096-byte buffer. It gives back what it read past its line.
  test("prompt() takes one line and a stream gets the lines after it", async () => {
    expect(
      await runAfterParentRead(
        `const answer = prompt("name?"); const lines = []; for await (const line of console) lines.push(line); process.stdout.write(JSON.stringify([answer, lines]));`,
      ),
    ).toEqual({
      stdout: `name? ${JSON.stringify(["body1", ["body2", ""]])}`,
      stderr: "",
      exitCode: 0,
      left: "",
    });
  });

  // A slice of stdin that starts at 0 is a budget from the position, as it is for a pipe.
  test("Bun.stdin.slice(0, n).stream() takes the next n bytes", async () => {
    const slice = `let s = ""; for await (const c of Bun.stdin.slice(0, 6).stream()) s += Buffer.from(c);`;
    expect(
      await runEach({
        "slice(0, 6).stream()": `${slice} ${print};`,
        "slice(0, 6).stream(), then Bun.stdin.stream()": `${slice} s = [s, await new Response(Bun.stdin.stream()).text()]; ${print};`,
        "streams that nothing reads": `process.stdin; Bun.stdin.stream();`,
      }),
    ).toEqual({
      "slice(0, 6).stream()": { stdout: JSON.stringify("body1\n"), stderr: "", exitCode: 0, left: "body2\n" },
      "slice(0, 6).stream(), then Bun.stdin.stream()": {
        stdout: JSON.stringify(["body1\n", "body2\n"]),
        stderr: "",
        exitCode: 0,
        left: "",
      },
      "streams that nothing reads": { stdout: "", stderr: "", exitCode: 0, left: rest },
    });
  });
});

// Only stdin follows its position. A stream of any other descriptor starts at the offset
// of the Blob and does not move the position. `next` is what `readSync` gets afterwards.
test("a stream of a Bun.file(fd) that is not stdin does not depend on the position of the descriptor", async () => {
  const content = "0123456789abcdefghij";
  using dir = tempDir("bun-file-fd-position", { "in.txt": content });
  const path = join(String(dir), "in.txt");

  async function afterFiveBytes(read: (fd: number) => Promise<string>) {
    const fd = openSync(path, "r");
    try {
      readSync(fd, Buffer.alloc(5));
      const bytes = await read(fd);
      const buf = Buffer.alloc(content.length);
      return { bytes, next: buf.toString("utf8", 0, readSync(fd, buf)) };
    } finally {
      closeSync(fd);
    }
  }

  const result: Record<string, unknown> = {
    "stream()": await afterFiveBytes(fd => streamText(Bun.file(fd).stream())),
    ".size, then stream()": await afterFiveBytes(fd => {
      const file = Bun.file(fd);
      file.size;
      return streamText(file.stream());
    }),
    "slice(0, 6).stream()": await afterFiveBytes(fd => streamText(Bun.file(fd).slice(0, 6).stream())),
    "slice(2, 6).stream()": await afterFiveBytes(fd => streamText(Bun.file(fd).slice(2, 6).stream())),
  };

  async function withFd<T>(file: string, flags: string, read: (fd: number) => Promise<T>) {
    const fd = openSync(join(String(dir), file), flags);
    try {
      return await read(fd);
    } finally {
      closeSync(fd);
    }
  }

  result["stream(), then text()"] = await withFd("in.txt", "r", async fd => [
    await streamText(Bun.file(fd).stream()),
    await Bun.file(fd).text(),
  ]);
  result["text(), then stream()"] = await withFd("in.txt", "r", async fd => [
    await Bun.file(fd).text(),
    await streamText(Bun.file(fd).stream()),
  ]);
  result["a written fd, then stream()"] = await withFd("out.txt", "w+", fd => {
    writeSync(fd, "just written");
    return streamText(Bun.file(fd).stream());
  });

  const atByte5 = content.slice(5);
  expect(result).toEqual({
    "stream()": { bytes: content, next: atByte5 },
    ".size, then stream()": { bytes: content, next: atByte5 },
    "slice(0, 6).stream()": { bytes: "012345", next: atByte5 },
    "slice(2, 6).stream()": { bytes: "2345", next: atByte5 },
    "stream(), then text()": [content, content],
    "text(), then stream()": [content, content],
    "a written fd, then stream()": "just written",
  });
});

import { file, spawn, version, type Socket } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, exampleSite, tempDir } from "harness";
import net from "net";

const exampleServer = exampleSite("http");

const bodyTypes = [
  {
    body: Request,
    fn: (body?: BodyInit | null, headers?: HeadersInit) =>
      new Request("http://example.com/", {
        method: "POST",
        body,
        headers,
      }),
  },
  {
    body: Response,
    fn: (body?: BodyInit | null, headers?: HeadersInit) => new Response(body, { headers }),
  },
];

const bufferTypes = [
  ArrayBuffer,
  SharedArrayBuffer,
  Buffer,
  Uint8Array,
  Uint8ClampedArray,
  Uint16Array,
  Uint32Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Float16Array,
  Float32Array,
  Float64Array,
];

// getRandomValues takes integer-typed views only, so fill through a Uint8Array
// view to cover the ArrayBuffer/SharedArrayBuffer/Float* cases too.
function randomFilled(bufferType: (typeof bufferTypes)[number], length: number) {
  const buffer = new (bufferType as any)(length);
  const bytes =
    buffer instanceof ArrayBuffer || buffer instanceof SharedArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  crypto.getRandomValues(bytes);
  return buffer;
}

const utf8 = [
  {
    string: "",
    buffer: new Uint8Array(0),
  },
  {
    string: "Hello world",
    buffer: new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64]),
  },
  {
    string: "🫠",
    buffer: new Uint8Array([0xf0, 0x9f, 0xab, 0xa0]),
  },
  {
    string: "⁉️",
    buffer: new Uint8Array([0xe2, 0x81, 0x89, 0xef, 0xb8, 0x8f]),
  },
];

for (const { body, fn } of bodyTypes) {
  describe(body.name, () => {
    describe("constructor", () => {
      test("undefined", () => {
        expect(() => fn()).not.toThrow();
        expect(fn().body).toBeNull();
      });
      test("null", () => {
        expect(() => fn(null)).not.toThrow();
        expect(fn(null).body).toBeNull();
      });
      describe("string", () => {
        for (const { string } of utf8) {
          test(`"${string}"`, async () => {
            expect(() => fn(string)).not.toThrow();
            expect(await fn(string).text()).toBe(string);
          });
        }
      });
      for (const bufferType of bufferTypes) {
        const buffers = [
          {
            label: "empty buffer",
            buffer: () => new bufferType(0),
          },
          {
            label: "small buffer",
            buffer: () => randomFilled(bufferType, 1_000),
          },
          {
            label: "large buffer",
            buffer: () => randomFilled(bufferType, 1_000_000),
          },
        ];
        describe(bufferType.name, () => {
          for (const { label, buffer } of buffers) {
            test(label, async () => {
              const actual = buffer();
              expect(() => fn(actual)).not.toThrow();
              expect(await fn(actual).arrayBuffer()).toStrictEqual(arrayBuffer(actual));
            });
          }
        });
      }
      describe("Blob", () => {
        const blobs = [
          {
            label: "empty blob",
            blob: () => new Blob(),
          },
          {
            label: "blob with 1 part",
            blob: () => new Blob(["hello"]),
          },
          {
            label: "blob with multiple parts",
            blob: () => new Blob(["hello", "world", new Blob(["!"])]),
          },
          {
            label: "blob with content-type",
            blob: () =>
              new Blob(["{}"], {
                type: "application/json",
              }),
          },
        ];
        for (const { label, blob } of blobs) {
          test(label, async () => {
            const actual = blob();
            expect(() => fn(actual)).not.toThrow();
            expect(await fn(actual).blob()).toStrictEqual(actual);
          });
        }
      });
      describe("FormData", () => {
        const forms = [
          {
            label: "empty form",
            formData: (form: FormData) => {},
          },
          {
            label: "form with text entry",
            formData: (form: FormData) => {
              form.set("value", "true");
            },
          },
          {
            label: "form with file entry",
            formData: (form: FormData) => {
              form.set("first", new Blob([]), "first.txt");
              form.set(
                "second",
                new Blob(["[]"], {
                  type: "application/json",
                }),
                "second.json",
              );
            },
          },
          {
            label: "form with Bun.file()",
            formData: (form: FormData) => {
              const url = new URL("resources/index.html", import.meta.url);
              form.set("index", file(url), "index.html");
            },
          },
        ];
        for (const { label, formData } of forms) {
          test(label, async () => {
            const actual = new FormData();
            formData(actual);
            expect(() => fn(actual)).not.toThrow();
            expect(await fn(actual).formData()).toStrictEqual(actual);
          });
        }
      });
      describe("ReadableStream", () => {
        const streams = [
          {
            label: "direct stream",
            stream: () =>
              new ReadableStream({
                type: "direct",
                async pull(controller) {
                  await controller.write("bye\n");
                  await controller.end();
                },
              }),
            content: "bye\n",
            skip: true, // hangs
          },
          {
            label: "Bun.file() stream",
            stream: () => {
              const url = new URL("resources/index.html", import.meta.url);
              const { readable } = file(url);
              return readable;
            },
            content: /Example Domain/,
            skip: true, // fails, text is empty
          },
          {
            label: "Bun.spawn() stream",
            stream: async () => {
              const { stdout } = await spawn({
                cmd: [process.argv0, "--version"],
              });
              expect(stdout).not.toBeUndefined();
              return stdout as ReadableStream;
            },
            content: new RegExp(version),
          },
          {
            label: "fetch() stream",
            stream: async () => {
              const { body } = await fetch(exampleServer.url);
              expect(body).not.toBeNull();
              return body as ReadableStream;
            },
            content: /Example Domain/,
          },
          // Blob-backed streams are not wrapped: the constructor takes the
          // blob out of the stream and stores it as the body itself.
          {
            label: "Blob.stream()",
            stream: () => new Blob(["bye\n"]).stream(),
            content: "bye\n",
          },
          {
            label: ".body of an unread in-memory body",
            stream: () => new Response("bye\n").body as ReadableStream,
            content: "bye\n",
          },
        ];
        for (const { label, stream, content, skip } of streams) {
          const it = skip ? test.skip : test;
          it(label, async () => {
            expect(async () => fn(await stream())).not.toThrow();
            const text = await fn(await stream()).text();
            if (typeof content === "string") {
              expect(text).toBe(content);
            } else {
              expect(content.test(text)).toBe(true);
            }
          });
        }
      });
      test(body.name, async () => {
        for (const { string, buffer } of utf8) {
          expect(() => {
            fn(buffer);
          }).not.toThrow();
          expect(await fn(buffer).text()).toBe(string);
        }
      });
    });
    // Two places move a blob out of a blob-backed stream and into the body:
    // the constructor (above), and the readers, when the body getter has
    // already turned an in-memory body into a stream that nothing has read.
    // Either way the body ends up holding the blob again, type included.
    describe("blob-backed stream bodies", () => {
      test("the constructor keeps the type of the Blob behind the stream", async () => {
        const blob = await fn(new Blob(["bye"], { type: "text/x-bun" }).stream()).blob();
        expect([blob.type, await blob.text()]).toEqual(["text/x-bun", "bye"]);
      });

      test("blob() after the body getter returns the original Blob's type and bytes", async () => {
        const subject = fn(new Blob(["bye"], { type: "text/x-bun" }));
        expect(subject.body).toBeInstanceOf(ReadableStream);
        const blob = await subject.blob();
        expect([blob.type, await blob.text(), subject.bodyUsed]).toEqual(["text/x-bun", "bye", true]);
      });

      test("text() after the body getter returns a string body's bytes", async () => {
        const subject = fn("bye");
        expect(subject.body).toBeInstanceOf(ReadableStream);
        expect(await subject.text()).toBe("bye");
        expect(subject.bodyUsed).toBe(true);
      });

      // The readers move an unread Bun.file() stream back into a Blob the same
      // way. That Blob has to cover the slice the stream was made from, not
      // the whole file. (text() is not in here: it pumps the stream instead.)
      describe("made from a sliced Bun.file()", () => {
        const alphabet = "abcdefghijklmnopqrstuvwxyz";

        test("bytes() returns the window of the slice the stream was made from", async () => {
          using dir = tempDir("body-file-slice-stream", { "data.txt": alphabet });
          const file = () => Bun.file(`${dir}/data.txt`);
          const bytesOf = async (blob: Blob) => Buffer.from(await fn(blob.stream()).bytes()).toString();
          expect({
            "slice(3, 8)": await bytesOf(file().slice(3, 8)),
            "slice(21)": await bytesOf(file().slice(21)),
            "slice(3, 1000)": await bytesOf(file().slice(3, 1000)),
            "slice(4, 4)": await bytesOf(file().slice(4, 4)),
            "slice(3, 20).slice(2, 6)": await bytesOf(file().slice(3, 20).slice(2, 6)),
            "whole file": await bytesOf(file()),
          }).toEqual({
            "slice(3, 8)": "defgh",
            "slice(21)": "vwxyz",
            "slice(3, 1000)": "defghijklmnopqrstuvwxyz",
            "slice(4, 4)": "",
            "slice(3, 20).slice(2, 6)": "fghi",
            "whole file": alphabet,
          });
        });

        test("arrayBuffer() and blob() return the slice too", async () => {
          using dir = tempDir("body-file-slice-stream-readers", { "data.txt": alphabet });
          const slice = () => Bun.file(`${dir}/data.txt`).slice(3, 8);
          const blob = await fn(slice().stream()).blob();
          expect({
            arrayBuffer: Buffer.from(await fn(slice().stream()).arrayBuffer()).toString(),
            blob: [blob.size, await blob.text()],
          }).toEqual({
            arrayBuffer: "defgh",
            blob: [5, "defgh"],
          });
        });

        test("json() parses only the slice", async () => {
          using dir = tempDir("body-file-slice-stream-json", { "data.json": `--{"ok":true}--` });
          expect(await fn(Bun.file(`${dir}/data.json`).slice(2, 13).stream()).json()).toEqual({ ok: true });
        });

        test("bytes() after the body getter turned a sliced Bun.file() body into a stream", async () => {
          using dir = tempDir("body-file-slice-body-getter", { "data.txt": alphabet });
          const subject = fn(Bun.file(`${dir}/data.txt`).slice(3, 8));
          expect(subject.body).toBeInstanceOf(ReadableStream);
          expect([Buffer.from(await subject.bytes()).toString(), subject.bodyUsed]).toEqual(["defgh", true]);
        });
      });
    });
    for (const { string, buffer } of utf8) {
      describe("arrayBuffer()", () => {
        test("undefined", async () => {
          expect(await fn().arrayBuffer()).toStrictEqual(new ArrayBuffer(0));
        });
        test("null", async () => {
          expect(await fn(null).arrayBuffer()).toStrictEqual(new ArrayBuffer(0));
        });
        test(`"${string}"`, async () => {
          expect(await fn(string).arrayBuffer()).toStrictEqual(buffer.buffer);
        });
      });
      describe("bytes()", () => {
        test("undefined", async () => {
          expect(await fn().bytes()).toStrictEqual(new Uint8Array(0));
        });
        test("null", async () => {
          expect(await fn(null).bytes()).toStrictEqual(new Uint8Array(0));
        });
        test(`"${string}"`, async () => {
          expect(await fn(string).bytes()).toStrictEqual(new Uint8Array(buffer));
        });
      });
      describe("text()", () => {
        test("undefined", async () => {
          expect(await fn().text()).toBe("");
        });
        test("null", async () => {
          expect(await fn(null).text()).toBe("");
        });
        test(`"${string}"`, async () => {
          expect(await fn(buffer).text()).toBe(string);
        });
      });
      describe("textStream()", () => {
        test("undefined", async () => {
          const stream = fn().textStream();
          expect(stream instanceof ReadableStream).toBe(true);
          expect(await Array.fromAsync(stream)).toEqual([]);
        });
        test("null", async () => {
          const stream = fn(null).textStream();
          expect(stream instanceof ReadableStream).toBe(true);
          expect(await Array.fromAsync(stream)).toEqual([]);
        });
        test(`"${string}" (string body)`, async () => {
          const stream = fn(string).textStream();
          expect(stream instanceof ReadableStream).toBe(true);
          expect((await Array.fromAsync(stream)).join("")).toBe(string);
        });
        test(`"${string}" (buffer body)`, async () => {
          const stream = fn(buffer).textStream();
          expect(stream instanceof ReadableStream).toBe(true);
          const chunks = await Array.fromAsync(stream);
          for (const chunk of chunks) {
            expect(typeof chunk).toBe("string");
          }
          expect(chunks.join("")).toBe(string);
        });
      });
    }
    describe("textStream()", () => {
      test("yields string chunks from a ReadableStream body", async () => {
        const input = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("hello "));
            controller.enqueue(new TextEncoder().encode("world"));
            controller.close();
          },
        });
        const stream = fn(input).textStream();
        const chunks = await Array.fromAsync(stream);
        for (const chunk of chunks) {
          expect(typeof chunk).toBe("string");
        }
        expect(chunks.join("")).toBe("hello world");
      });
      test("joins multi-byte characters split across chunks", async () => {
        // "🫠" is F0 9F AB A0
        const input = new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([0xf0, 0x9f]));
            controller.enqueue(new Uint8Array([0xab]));
            controller.enqueue(new Uint8Array([0xa0]));
            controller.close();
          },
        });
        expect((await Array.fromAsync(fn(input).textStream())).join("")).toBe("🫠");
      });
      test("strips a leading UTF-8 BOM", async () => {
        const input = new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]);
        expect((await Array.fromAsync(fn(input).textStream())).join("")).toBe("hi");
      });
      test("replaces invalid sequences with U+FFFD", async () => {
        const input = new Uint8Array([0x61, 0xff, 0x62]);
        expect((await Array.fromAsync(fn(input).textStream())).join("")).toBe("a\ufffdb");
      });
      test.each([
        ["surrogate lead + second byte", [0xed, 0xa0]],
        ["overlong 4-byte lead + second byte", [0xf0, 0x80]],
        ["out-of-range 4-byte lead + second byte", [0xf4, 0x90]],
        ["0xF5 (never a valid lead)", [0xf5]],
        ["0xC0 (overlong 2-byte lead)", [0xc0]],
      ])("does not hold back a definitely-invalid trailing prefix: %s", async (_, trailing) => {
        // An invalid prefix at the end of a chunk should be replaced
        // immediately (the WHATWG decoder emits U+FFFD), not held back to the
        // next chunk. Assert via observable chunk timing: the first read of
        // the output stream must not be empty.
        let sc!: ReadableStreamDefaultController;
        const input = new ReadableStream({
          start(c) {
            sc = c;
            c.enqueue(new Uint8Array([0x61, ...trailing]));
          },
        });
        const reader = fn(input).textStream().getReader();
        const first = await reader.read();
        expect(first.done).toBe(false);
        expect(first.value!.startsWith("a\ufffd")).toBe(true);
        sc.close();
      });
      test.each([
        ["ascii", Buffer.alloc(1000, "abcd").toString()],
        ["mixed", Buffer.alloc(1000, "hello 🫠 ").toString()],
      ])("decodes a large %s chunk from a ReadableStream body", async (_, big) => {
        const input = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(big));
            controller.close();
          },
        });
        expect((await Array.fromAsync(fn(input).textStream())).join("")).toBe(big);
      });
      test("marks body as used", async () => {
        const r = fn("hello");
        expect(r.bodyUsed).toBe(false);
        const stream = r.textStream();
        expect(r.bodyUsed).toBe(true);
        expect((await Array.fromAsync(stream)).join("")).toBe("hello");
      });
      test("throws TypeError synchronously when body is unusable", async () => {
        const r = fn("hello");
        await r.text();
        expect(r.bodyUsed).toBe(true);
        expect(() => r.textStream()).toThrow(TypeError);
      });
      test("throws TypeError when body stream is locked", () => {
        const r = fn("hello");
        r.body!.getReader();
        expect(() => r.textStream()).toThrow(TypeError);
      });
      test("locks a previously-accessed .body stream", async () => {
        const r = fn("hello");
        const stream = r.body!;
        expect(stream.locked).toBe(false);
        const ts = r.textStream();
        expect(stream.locked).toBe(true);
        expect(() => stream.getReader()).toThrow(TypeError);
        await expect(stream.cancel()).rejects.toBeInstanceOf(TypeError);
        expect((await Array.fromAsync(ts)).join("")).toBe("hello");
        expect(stream.locked).toBe(false);
      });
      test("releases the source stream on close and cancel", async () => {
        {
          const source = new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array([65]));
              c.close();
            },
          });
          const ts = fn(source).textStream();
          expect(source.locked).toBe(true);
          expect((await Array.fromAsync(ts)).join("")).toBe("A");
          expect(source.locked).toBe(false);
        }
        {
          const source = new ReadableStream({
            pull(c) {
              c.enqueue(new Uint8Array([65]));
            },
          });
          const ts = fn(source).textStream();
          expect(source.locked).toBe(true);
          await ts.cancel();
          expect(source.locked).toBe(false);
        }
      });
      test("second textStream() call throws", () => {
        const r = fn("hello");
        r.textStream();
        expect(() => r.textStream()).toThrow(TypeError);
      });
      test("ignores Content-Type charset", async () => {
        const result = fn(new Uint8Array([0xf0, 0x9f, 0xab, 0xa0]), {
          "Content-Type": "text/plain; charset=iso-8859-1",
        });
        expect((await Array.fromAsync(result.textStream())).join("")).toBe("🫠");
      });
      test("propagates errors from a ReadableStream body", async () => {
        const input = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("hello"));
            controller.error(new Error("boom"));
          },
        });
        const stream = fn(input).textStream();
        await expect(async () => {
          for await (const _ of stream) {
          }
        }).toThrow("boom");
      });
      test("cancel propagates to the source stream", async () => {
        let cancelled: unknown;
        const input = new ReadableStream({
          pull(controller) {
            controller.enqueue(new TextEncoder().encode("x"));
          },
          cancel(reason) {
            cancelled = reason;
          },
        });
        const stream = fn(input).textStream();
        await stream.cancel("stop");
        expect(cancelled).toBe("stop");
      });
      test("cancels the source stream when it produces a non-BufferSource chunk", async () => {
        let cancelled: unknown;
        const input = new ReadableStream({
          start(controller) {
            controller.enqueue("oops");
          },
          cancel(reason) {
            cancelled = reason;
          },
        });
        const stream = fn(input).textStream();
        await expect(async () => {
          for await (const _ of stream) {
          }
        }).toThrow(TypeError);
        expect(cancelled).toBeInstanceOf(TypeError);
      });
      test("treats a detached BufferSource chunk as empty", async () => {
        const view = new Uint8Array([0x68, 0x69]);
        structuredClone(view, { transfer: [view.buffer] });
        const input = new ReadableStream({
          start(controller) {
            controller.enqueue(view);
            controller.enqueue(new Uint8Array([0x21]));
            controller.close();
          },
        });
        expect((await Array.fromAsync(fn(input).textStream())).join("")).toBe("!");
      });
      test("accepts raw ArrayBuffer chunks from a ReadableStream body", async () => {
        const input = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("hi").buffer);
            controller.close();
          },
        });
        expect((await Array.fromAsync(fn(input).textStream())).join("")).toBe("hi");
      });
      test("concurrent reads with a source that closes without enqueueing", async () => {
        let sc!: ReadableStreamDefaultController;
        const source = new ReadableStream({
          start(c) {
            sc = c;
          },
        });
        const reader = fn(source).textStream().getReader();
        await Promise.resolve();
        const p1 = reader.read();
        const p2 = reader.read();
        await Promise.resolve();
        sc.close();
        expect(await p1).toEqual({ value: undefined, done: true });
        expect(await p2).toEqual({ value: undefined, done: true });
      });
      test("cancel after source close with a queued flush chunk", async () => {
        // closeSteps' flush enqueues a replacement char into the output queue
        // and releases the source reader; a subsequent output cancel() must
        // tolerate the already-released reader.
        let sc!: ReadableStreamDefaultController;
        const source = new ReadableStream({
          start(c) {
            sc = c;
          },
        });
        const reader = fn(source).textStream().getReader();
        await Promise.resolve();
        reader.read();
        await Promise.resolve();
        reader.read();
        await Promise.resolve();
        sc.enqueue(new Uint8Array([0x41, 0xc2]));
        sc.enqueue(new Uint8Array([0xa9, 0xc2]));
        sc.close();
        await Promise.resolve();
        await reader.cancel();
        expect(source.locked).toBe(false);
      });
      test("re-entrant closeSteps via flush enqueue does not double-release", async () => {
        let sc!: ReadableStreamDefaultController;
        const source = new ReadableStream({
          start(c) {
            sc = c;
          },
        });
        const reader = fn(source).textStream().getReader();
        await Promise.resolve();
        const p1 = reader.read();
        const p2 = reader.read();
        await Promise.resolve();
        await Promise.resolve();
        // 0xC2 is held back; the chunk-step's callPullIfNeeded queues a third
        // TextDecode read on the source reader.
        sc.enqueue(new Uint8Array([0xc2]));
        await Promise.resolve();
        sc.close();
        expect((await p1).value).toBe("\ufffd");
        expect((await p2).done).toBe(true);
        expect(source.locked).toBe(false);
      });
      const writeChunk = async (sock: net.Socket, bytes: number[]) => {
        sock.write(bytes.length.toString(16) + "\r\n");
        sock.write(Uint8Array.from(bytes));
        sock.write("\r\n");
        await new Promise(r => setImmediate(r));
      };
      if (body === Response) {
        test("streams a fetch response body", async () => {
          await using server = Bun.serve({
            port: 0,
            fetch() {
              const chunks = ["hello ", "world 🫠"];
              return new Response(
                new ReadableStream({
                  start(controller) {
                    for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
                    controller.close();
                  },
                }),
              );
            },
          });
          const res = await fetch(server.url);
          const stream = res.textStream();
          expect(res.bodyUsed).toBe(true);
          expect(() => res.textStream()).toThrow(TypeError);
          const out = (await Array.fromAsync(stream)).join("");
          expect(out).toBe("hello world 🫠");
        });
        test("Bun's ReadableStream.text() on a fetch textStream() yields decoded text", async () => {
          await using server = Bun.serve({
            port: 0,
            fetch: () => new Response(new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0xff, 0x62])),
          });
          const res = await fetch(server.url);
          // The native-handle buffered fast path must not bypass the decode.
          expect(await res.textStream().text()).toBe("a\ufffdb");
        });
        // A native pull whose bytes all decode to the empty string (held back
        // as an incomplete UTF-8 sequence or a BOM prefix) must keep the pull
        // loop going. Each non-empty enqueue (and the initial read) banks one
        // re-pull via m_pullAgain, so the stall appears once two consecutive
        // pulls decode to nothing.
        const rawChunkedServer = async (body: (sock: net.Socket) => Promise<void>) => {
          const listening = Promise.withResolvers<void>();
          const server = net.createServer(sock => {
            sock.on("error", () => {});
            sock.once("data", async () => {
              sock.write("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n");
              await body(sock);
            });
          });
          server.listen(0, "127.0.0.1", () => listening.resolve());
          await listening.promise;
          return {
            port: (server.address() as net.AddressInfo).port,
            [Symbol.asyncDispose]: () => new Promise<void>(r => server.close(() => r())),
          };
        };
        test.each([
          ["leading 4-byte char split 2-way", [[0xf0, 0x9f], [0xab, 0xa0], [0x42]], "🫠B"],
          ["leading 4-byte char split 3-way", [[0xf0], [0x9f, 0xab], [0xa0], [0x42]], "🫠B"],
          ["leading 3-byte char split 2-way", [[0xe4], [0xb8, 0xad], [0x42]], "中B"],
          ["4-byte char as [lead][cont][cont cont]", [[0x41], [0xf0], [0x9f], [0xab, 0xa0], [0x42]], "A🫠B"],
          ["4-byte char byte-at-a-time", [[0x41], [0xf0], [0x9f], [0xab], [0xa0], [0x42]], "A🫠B"],
          ["3-byte char byte-at-a-time", [[0x41], [0xe4], [0xb8], [0xad], [0x42]], "A中B"],
          ["BOM byte-at-a-time then text", [[0xef], [0xbb], [0xbf], [0x68], [0x69]], "hi"],
          ["incomplete tail only then close", [[0xf0], [0x9f]], "\ufffd"],
          ["text then incomplete tail then close", [[0x41], [0xf0], [0x9f]], "A\ufffd"],
          ["BOM prefix only then close", [[0xef], [0xbb]], "\ufffd"],
        ])(
          "completes a fetch textStream() when consecutive chunks decode to nothing: %s",
          async (_, parts, expected) => {
            await using server = await rawChunkedServer(async sock => {
              for (const p of parts) await writeChunk(sock, p);
              sock.end("0\r\n\r\n");
            });
            const res = await fetch(`http://127.0.0.1:${server.port}/`);
            const chunks = await Array.fromAsync(res.textStream());
            for (const chunk of chunks) expect(typeof chunk).toBe("string");
            expect(chunks.join("")).toBe(expected);
          },
        );
        test("rejects a fetch textStream() when the connection drops after an empty decode", async () => {
          // The client must consume "A" before the drop reaches the HTTP
          // thread: a failure that arrives in the same progress update as
          // unread body bytes errors the body and discards those bytes.
          const consumedFirstChunk = Promise.withResolvers<void>();
          await using server = await rawChunkedServer(async sock => {
            await writeChunk(sock, [0x41]);
            await consumedFirstChunk.promise;
            for (const p of [[0xf0], [0x9f]]) await writeChunk(sock, p);
            sock.destroy();
          });
          const res = await fetch(`http://127.0.0.1:${server.port}/`);
          let received = "";
          let error: any;
          try {
            for await (const ch of res.textStream()) {
              received += ch;
              consumedFirstChunk.resolve();
            }
          } catch (e) {
            error = e;
          } finally {
            // Let the server finish (and close the socket) if the stream ended early.
            consumedFirstChunk.resolve();
          }
          expect({ code: error?.code, received }).toEqual({ code: "ECONNRESET", received: "A" });
        });
      }
      if (body === Request) {
        test("streams an incoming request body server-side", async () => {
          const { promise, resolve, reject } = Promise.withResolvers<{
            chunks: string[];
            bodyUsedAfter: boolean;
            secondCallThrew: boolean;
          }>();
          await using server = Bun.serve({
            port: 0,
            async fetch(req) {
              try {
                const stream = req.textStream();
                const chunks = await Array.fromAsync(stream);
                let secondCallThrew = false;
                try {
                  req.textStream();
                } catch (e) {
                  secondCallThrew = e instanceof TypeError;
                }
                resolve({ chunks, bodyUsedAfter: req.bodyUsed, secondCallThrew });
              } catch (e) {
                reject(e);
              }
              return new Response("ok");
            },
          });
          await fetch(server.url, {
            method: "POST",
            body: new ReadableStream({
              start(c) {
                for (const s of ["hello ", "world 🫠"]) c.enqueue(new TextEncoder().encode(s));
                c.close();
              },
            }),
          });
          const result = await promise;
          for (const chunk of result.chunks) {
            expect(typeof chunk).toBe("string");
          }
          expect(result.chunks.join("")).toBe("hello world 🫠");
          expect(result.bodyUsedAfter).toBe(true);
          expect(result.secondCallThrew).toBe(true);
        });
        test("completes server-side when a multi-byte character is split across upload chunks", async () => {
          const done = Promise.withResolvers<string>();
          await using server = Bun.serve({
            port: 0,
            async fetch(req) {
              try {
                done.resolve((await Array.fromAsync(req.textStream())).join(""));
              } catch (e: any) {
                done.reject(e);
              }
              return new Response("ok");
            },
          });
          const connected = Promise.withResolvers<void>();
          const sock = net.connect(server.port, "127.0.0.1", () => connected.resolve());
          sock.on("error", () => {});
          await connected.promise;
          try {
            sock.write("POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n");
            for (const p of [[0x41], [0xf0], [0x9f], [0xab, 0xa0], [0x42]]) await writeChunk(sock, p);
            sock.write("0\r\n\r\n");
            expect(await done.promise).toBe("A🫠B");
          } finally {
            sock.end();
          }
        });
        test("rejects when the client aborts mid-upload server-side", async () => {
          const firstChunk = Promise.withResolvers<void>();
          const done = Promise.withResolvers<{ name: string; received: string }>();
          await using server = Bun.serve({
            port: 0,
            async fetch(req) {
              const received: string[] = [];
              try {
                for await (const c of req.textStream()) {
                  received.push(c);
                  firstChunk.resolve();
                }
                done.resolve({ name: "<no error>", received: received.join("") });
              } catch (e: any) {
                done.resolve({ name: e?.name, received: received.join("") });
              }
              return new Response("ok");
            },
          });
          const connected = Promise.withResolvers<void>();
          const sock = net.connect(server.port, "127.0.0.1", () => connected.resolve());
          sock.on("error", () => {});
          await connected.promise;
          sock.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 1000\r\n\r\nhello");
          await firstChunk.promise;
          sock.destroy();
          const result = await done.promise;
          expect(result).toEqual({ name: "AbortError", received: "hello" });
        });
      }
    });
    describe("json()", () => {
      const validTests: [string, unknown][] = [
        ["true", true],
        ["1234", 1234],
        ['"hello"', "hello"],
        ["null", null],
        ['["abc",123]', ["abc", 123]],
        ["{}", {}],
        ["[[[[[[]]]]]]", [[[[[[]]]]]]],
        ['{"a":1}', { a: 1 }],
        ['{"emoji":"😀"}', { emoji: "😀" }],
        ["{}\n", {}],
        ["\n[]\n", []],
        ["\ttrue\n", true],
        ['\r\n{"hello":1}\r\n', { hello: 1 }],
      ];
      for (const [actual, expected] of validTests) {
        test(actual.trim(), async () => {
          expect(await fn(actual).json()).toStrictEqual(expected);
        });
      }
      const invalidTests: string[] = [
        "",
        " ",
        "undefined",
        "Infinity",
        "NaN",
        "10n",
        "{",
        "[",
        "{{}}",
        "()",
        "[[]",
        "{a:1}",
        '{1:"a"}',
        '{"a":1,}',
        "[1,2,]",
        "'hello'",
        '"hello',
        "😀",
      ];
      for (const actual of invalidTests) {
        test(actual || "<empty>", async () => {
          expect(async () => await fn(actual).json()).toThrow(SyntaxError);
        });
      }
    });
    describe("formData()", () => {
      test("undefined", () => {
        expect(async () => await fn().formData()).toThrow(TypeError);
      });
      test("null", () => {
        expect(async () => await fn(null).formData()).toThrow(TypeError);
      });
      const validTests = [
        {
          label: "multipart with no entries",
          headers: {
            "Content-Type": "multipart/form-data; boundary=def456",
          },
          body: ["--def456--"],
          formData: (form: FormData) => {},
        },
        {
          label: "multipart with text entry",
          headers: {
            "Content-Type": "multipart/form-data; boundary=abc123",
          },
          body: ["--abc123", 'Content-Disposition: form-data; name="metadata"', "", '{"ok":true}\n', "--abc123--", ""],
          formData: (form: FormData) => {
            form.set("metadata", '{"ok":true}\n');
          },
        },
        {
          label: "multipart with file entry",
          headers: {
            "Content-Type": "multipart/form-data; boundary=--456789",
          },
          body: [
            "----456789",
            'Content-Disposition: form-data; name="file"; filename="index.html"',
            "Content-Type: text/html;charset=utf-8",
            "",
            "<html><body><h1>Hello</h1></body></html>\n",
            "----456789--",
            "",
          ],
          formData: (form: FormData) => {
            const file = new Blob(["<html><body><h1>Hello</h1></body></html>\n"], {
              type: "text/html;charset=utf-8",
            });
            form.set("file", file, "index.html");
          },
        },
        {
          label: "multipart with file that has utf-8 filename (rfc5987)",
          headers: {
            "Content-Type": "multipart/form-data; boundary=--abcdefg",
          },
          body: [
            "----abcdefg",
            "Content-Disposition: form-data; name=\"emoji\"; filename*UTF-8''%F0%9F%9A%80.js",
            "Content-Type: application/javascript;charset=utf-8",
            "",
            'console.log("🚀");\n',
            "----abcdefg--",
            "",
          ],
          formData: (form: FormData) => {
            const file = new Blob(['console.log("🚀");\n'], {
              type: "application/javascript;charset=utf-8",
            });
            form.set("emoji", file, "🚀.js");
          },
        },
        {
          label: "multipart with unquoted name",
          headers: {
            "Content-Type": "multipart/form-data; boundary=--123456",
          },
          body: [
            "----123456",
            "Content-Disposition: form-data; name=value",
            "Content-Type: text/plain",
            "",
            "goodbye",
            "----123456--",
            "",
          ],
          formData: (form: FormData) => {
            form.set("value", "goodbye");
          },
        },
        {
          label: "url encoded with no entries",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: [],
          formData: (form: FormData) => {},
        },
        {
          label: "url encoded",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: ["ok=true&name=bun"],
          formData: (form: FormData) => {
            form.set("ok", "true");
            form.set("name", "bun");
          },
        },
        {
          label: "url encoded with utf-8 entry",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
          },
          body: ["emoji=%F0%9F%8F%B3%EF%B8%8F%E2%80%8D%F0%9F%8C%88"],
          formData: (form: FormData) => {
            form.set("emoji", "🏳️‍🌈");
          },
        },
      ];
      for (const { label, body, headers, formData } of validTests) {
        test(label, async () => {
          const expected = new FormData();
          formData(expected);
          expect(await fn(body.join("\r\n"), headers).formData()).toStrictEqual(expected);
        });
      }
      const invalidTests = [
        {
          label: "empty body",
          headers: {
            "Content-Type": "application/octet-stream",
          },
          body: [],
        },
        {
          label: "text body",
          headers: {
            "Content-Type": "text/plain",
          },
          body: ["how are you?"],
        },
        {
          label: "multipart with no boundary",
          headers: {
            "Content-Type": "multipart/form-data",
          },
          body: ["--abc123", 'Content-Disposition: form-data; name="value"', "", "hello", "--abc123--", ""],
        },
        {
          label: "multipart with malformed boundary",
          headers: {
            "Content-Type": "multipart/form-data; boundary=abc123",
          },
          body: ["--", 'Content-Disposition: form-data; name="value"', "", '{"ok":true}\n', "----", ""],
        },
      ];
      for (const { label, body, headers } of invalidTests) {
        test(label, () => {
          expect(async () => await fn(body.join("\r\n"), headers).formData()).toThrow(TypeError);
        });
      }
    });
    describe("body", () => {
      test("undefined", () => {
        expect(fn().body).toBeNull();
      });
      test("null", () => {
        expect(fn(null).body).toBeNull();
      });
      const tests = [
        {
          label: "string",
          body: () => "bun",
        },
        {
          label: "Buffer",
          body: () => Buffer.from("bun", "utf-8"),
        },
        {
          label: "Uint8Array",
          body: () => new Uint8Array([0x62, 0x75, 0x6e]),
        },
        {
          label: "Blob",
          body: () => new Blob(["bun"]),
        },
        {
          label: "ReadableStream",
          body: () =>
            new ReadableStream({
              start(controller) {
                controller.enqueue("b");
                controller.enqueue("u");
                controller.enqueue("n");
                controller.close();
              },
            }),
        },
      ];
      for (const { label, body } of tests) {
        test(label, async () => {
          const actual = fn(body()).body;
          expect(actual).not.toBeNull();
          expect(actual instanceof ReadableStream).toBe(true);
          const stream = actual as ReadableStream;
          expect(stream.locked).toBe(false);
          expect(await stream.text()).toBe("bun");
        });
      }
    });
    describe("bodyUsed", () => {
      const tests: Record<string, { label?: string; body?: BodyInit | null; bodyUsed: boolean }[]> = {
        "text": [
          {
            body: undefined,
            bodyUsed: false,
          },
          {
            body: null,
            bodyUsed: false,
          },
          {
            body: "",
            bodyUsed: true,
          },
          {
            body: "bun",
            bodyUsed: true,
          },
        ],
        "json": [
          {
            body: "{}",
            bodyUsed: true,
          },
        ],
        "arrayBuffer": [
          {
            body: undefined,
            bodyUsed: false,
          },
          {
            body: null,
            bodyUsed: false,
          },
          {
            label: "Uint8Array",
            body: new Uint8Array([0x62, 0x75, 0x6e]),
            bodyUsed: true,
          },
        ],
        "blob": [
          {
            body: undefined,
            bodyUsed: false,
          },
          {
            body: null,
            bodyUsed: false,
          },
          {
            label: "Blob",
            body: new Blob(["bun"]),
            bodyUsed: true,
          },
        ],
        "formData": [
          {
            label: "FormData",
            body: new FormData(),
            bodyUsed: true,
          },
        ],
        "clone": [
          {
            body: null,
            bodyUsed: false,
          },
          {
            body: null,
            bodyUsed: false,
          },
          {
            body: "bun",
            bodyUsed: false,
          },
        ],
      };
      for (const [property, entries] of Object.entries(tests)) {
        describe(`${property}()`, () => {
          for (const { label, body, bodyUsed } of entries) {
            test(label || `${body}`, () => {
              const result = fn(body);
              expect(result).toHaveProperty("bodyUsed", false);
              // @ts-expect-error
              expect(() => result[property]()).not.toThrow();
              expect(result).toHaveProperty("bodyUsed", bodyUsed);
            });
          }
        });
      }
    });

    describe("new Response()", () => {
      ["text", "arrayBuffer", "bytes", "blob"].map(method => {
        test(method, async () => {
          const result = new Response();
          expect(result).toHaveProperty("bodyUsed", false);

          // @ts-expect-error
          await result[method]();
          expect(result).toHaveProperty("bodyUsed", false);
        });
      });
    });

    describe('new Request(url, {method: "POST" })', () => {
      ["text", "arrayBuffer", "bytes", "blob"].map(method => {
        test(method, async () => {
          const result = new Request("https://example.com", { method: "POST" });
          expect(result).toHaveProperty("bodyUsed", false);

          // @ts-expect-error
          await result[method]();
          expect(result).toHaveProperty("bodyUsed", false);
        });
      });
    });

    describe("new Request(url)", () => {
      ["text", "arrayBuffer", "bytes", "blob"].map(method => {
        test(method, async () => {
          const result = new Request("https://example.com");
          expect(result).toHaveProperty("bodyUsed", false);

          // @ts-expect-error
          await result[method]();
          expect(result).toHaveProperty("bodyUsed", false);
        });
      });
    });
  });
}

function arrayBuffer(buffer: BufferSource) {
  if (buffer instanceof ArrayBuffer) {
    return buffer;
  }
  if (buffer instanceof SharedArrayBuffer) {
    return new Uint8Array(new Uint8Array(buffer)).buffer;
  }
  return buffer.buffer;
}

// Consuming a string body via .text()/.json()/.arrayBuffer()/.bytes() used to
// permanently leak the whole body string (the adopted WTF::StringImpl +1 ref
// was never released), so RSS grew *linearly and never plateaued* across
// round-trips. The fix mirrors the Zig `defer str.deref()`. This asserts the
// leak is bounded: after a warmup, a second equal block of round-trips must
// not keep growing RSS (a linear leak adds ~block-size every block; a bounded
// impl plateaus). Absolute RSS is intentionally not asserted — only growth.
describe.concurrent("string body consumption does not leak", () => {
  // NOTE: `.text()` is intentionally excluded. It produces a large JS string
  // as its result, and discarded large JS strings are currently not reclaimed
  // by GC in this build independently of bodies — `Buffer.alloc(2e6).toString()`
  // in a loop leaks identically with no Blob/Response involved. That is a
  // separate bug from the missing body-string `deref`; mixing it in here would
  // test the wrong thing. These four consume into a parsed value / byte buffer
  // and measure the body-string lifetime cleanly.
  const cases: Array<[string, "Response" | "Request", string]> = [
    ["Response.json", "Response", "json"],
    ["Response.arrayBuffer", "Response", "arrayBuffer"],
    ["Response.bytes", "Response", "bytes"],
    ["Request.json", "Request", "json"],
  ];

  for (const [name, ctor, method] of cases) {
    test(name, async () => {
      // We need the *body string* to be large (that's the leaked ref) but the
      // consumer to be cheap, so the JSON arm uses whitespace padding + a tiny
      // value — valid JSON, ~SZ-byte body, near-free parse. `Buffer.alloc` is
      // avoided for body construction per the note above (separate reclaim
      // issue would pollute this measurement); `.repeat()` is also measurably
      // faster than `Buffer.alloc(..).toString()` on this path in debug.
      const makeBody = method === "json" ? `() => " ".repeat(SZ) + "0"` : `() => "z".repeat(SZ)`;
      const make =
        ctor === "Request"
          ? `b => new Request("http://example.com/", { method: "POST", body: b })`
          : `b => new Response(b)`;
      const src = `
        const SZ = 2_000_000, WARM = 50, BLOCK = 40;
        const rss = process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;
        const mb = () => (rss() / 1048576) | 0;
        const body = ${makeBody};
        const make = ${make};
        const run = async n => { for (let i = 0; i < n; i++) await make(body())[${JSON.stringify(method)}](); };
        await run(WARM); Bun.gc(true); const a = mb();
        await run(BLOCK); Bun.gc(true); const b = mb();
        await run(BLOCK); Bun.gc(true); const c = mb();
        console.log("BLOCK1:" + (b - a) + " BLOCK2:" + (c - b));
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", src],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const m = stdout.match(/BLOCK1:(-?\d+) BLOCK2:(-?\d+)/);
      expect(m).not.toBeNull();
      const block2 = Number(m![2]);
      // Bounded: BLOCK2 ≈ 0 (plateaued). Leaking: BLOCK2 ≈ 40 × ~3 MB ≈ 100+ MB
      // and keeps growing every block. 50 MB cleanly separates the two.
      expect(block2).toBeLessThan(50);
      expect(exitCode).toBe(0);
    });
  }
});

// https://github.com/oven-sh/bun/issues/6860
describe("constructing a body from an unusable ReadableStream", () => {
  const bytes = () =>
    new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("x"));
        c.close();
      },
    });
  test("a disturbed stream throws a TypeError", async () => {
    const rs = bytes();
    await new Response(rs).text();
    expect(() => new Response(rs)).toThrow(TypeError);
    expect(() => new Request("http://example.com/", { method: "POST", body: rs, duplex: "half" })).toThrow(TypeError);
  });
  test("a locked stream throws a TypeError", () => {
    const rs = bytes();
    rs.getReader();
    expect(() => new Response(rs)).toThrow(TypeError);
    expect(() => new Request("http://example.com/", { method: "POST", body: rs, duplex: "half" })).toThrow(TypeError);
  });
});

// Until the body arrives, a fetch() Response's size (the number Bun.inspect
// prints) is the upstream Content-Length. The body getter creates the stream
// from that size alone when no bytes have been received yet, and the size has
// to be carried over onto the stream, which reports it from then on.
test("a fetch() Response still reports the Content-Length after .body created the stream", async () => {
  const payload = "0123456789";
  const { promise: upstream, resolve: gotUpstream } = Promise.withResolvers<Socket>();
  using listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.write(`HTTP/1.1 200 OK\r\nContent-Length: ${payload.length}\r\nConnection: close\r\n\r\n`);
        gotUpstream(socket);
      },
      data() {},
    },
  });

  const response = await fetch(`http://127.0.0.1:${listener.port}/`);
  expect(Bun.inspect(response)).toStartWith(`Response (${payload.length} bytes)`);

  // The upstream socket has not written any of the body yet, so this stream
  // starts out empty and only knows the size.
  const stream = response.body!;
  expect(Bun.inspect(response)).toStartWith(`Response (${payload.length} bytes)`);

  (await upstream).end(payload);
  expect(await stream.text()).toBe(payload);
});

// WHATWG fetch (main fetch, "set internalResponse's body to null"): a response to
// a HEAD request, or with a null body status (204, 205, 304), has a null body,
// whatever the server frames after the head. Node and browsers agree. Bun used to
// hand out an empty stream instead, so reading it used the body up and clone()
// threw afterwards.
describe.concurrent("a fetch() Response that cannot have a body", () => {
  // The HEAD answer carries the Content-Length of the GET body, as RFC 9110
  // section 9.3.2 wants. RFC 9110 section 15.3.6 forbids content on a 205, but
  // HTTP/1.1 framing can still carry it, and the bytes must then be received and
  // dropped. Every answer closes its connection, so each fetch() below gets its
  // own socket.
  const wire = {
    noContent: "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n",
    resetContent: "HTTP/1.1 205 Reset Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
    resetContentWithContent: "HTTP/1.1 205 Reset Content\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello",
    notModified: 'HTTP/1.1 304 Not Modified\r\nETag: "x"\r\nConnection: close\r\n\r\n',
    toHead: "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\n",
    emptyContent: "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
  };

  // Answers the one request it gets with `answer`, once the request head is in.
  function listen(answer: string) {
    return Bun.listen<{ request: string }>({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          socket.data = { request: "" };
        },
        data(socket, data) {
          socket.data.request += data.toString("latin1");
          if (socket.data.request.includes("\r\n\r\n")) socket.end(answer);
        },
      },
    });
  }

  test.each([
    ["204", wire.noContent, undefined, 204, null],
    ["205", wire.resetContent, undefined, 205, "0"],
    ["205 whose server sent content anyway", wire.resetContentWithContent, undefined, 205, "5"],
    ["304", wire.notModified, undefined, 304, null],
    ["200 to a HEAD request", wire.toHead, { method: "HEAD" }, 200, "5"],
  ])("%s: the body is null and reading it does not use it up", async (_, answer, init, status, contentLength) => {
    using listener = listen(answer);
    const response = await fetch(`http://127.0.0.1:${listener.port}/`, init);
    await expect(response.json()).rejects.toThrow(SyntaxError);
    expect({
      status: response.status,
      contentLength: response.headers.get("content-length"),
      body: response.body,
      text: await response.text(),
      bytes: await response.bytes(),
      bodyUsed: response.bodyUsed,
      cloneBody: response.clone().body,
    }).toEqual({
      status,
      contentLength,
      body: null,
      text: "",
      bytes: new Uint8Array(0),
      bodyUsed: false,
      cloneBody: null,
    });
  });

  test("a 200 with empty content still has a body", async () => {
    using listener = listen(wire.emptyContent);
    const response = await fetch(`http://127.0.0.1:${listener.port}/`);
    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(await response.text()).toBe("");
    expect(response.bodyUsed).toBe(true);
  });

  test.each([
    ["204", wire.noContent, undefined],
    ["200 to a HEAD request", wire.toHead, { method: "HEAD" }],
  ])("%s: an abort after the response arrived has no body to error", async (_, answer, init) => {
    using listener = listen(answer);
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${listener.port}/`, { ...init, signal: controller.signal });
    controller.abort();
    expect(response.body).toBeNull();
    expect(await response.text()).toBe("");
  });

  test("content still arriving after a 205 resolved does not hold the process", async () => {
    // The server sends 3 of the 5 declared bytes with the head and the other 2
    // only once fetch() has resolved. Nothing but the fetch refs the event loop,
    // so the process only exits if the fetch stops waiting for a body no reader
    // can exist for: it closes the connection instead (the server sees the reset).
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          import net from "node:net";
          let upstream;
          const server = net.createServer(socket => {
            upstream = socket;
            socket.unref();
            socket.on("error", () => {});
            socket.once("data", () => {
              socket.write("HTTP/1.1 205 Reset Content\\r\\nContent-Length: 5\\r\\n\\r\\nhel");
            });
          });
          server.unref();
          await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
          const response = await fetch("http://127.0.0.1:" + server.address().port + "/");
          const body = response.body;
          upstream.write("lo");
          console.log(JSON.stringify({ status: response.status, body, text: await response.text() }));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ status: 205, body: null, text: "" });
    expect(exitCode).toBe(0);
  });
});

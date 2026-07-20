import {
  ArrayBufferSink,
  file,
  readableStreamToArray,
  readableStreamToArrayBuffer,
  readableStreamToBytes,
  readableStreamToText,
} from "bun";
import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir, tmpdirSync } from "harness";
import { mkfifo } from "mkfifo";
import { createReadStream, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

it("TransformStream", async () => {
  // https://developer.mozilla.org/en-US/docs/Web/API/TransformStream
  const TextEncoderStreamInterface = {
    start() {
      this.encoder = new TextEncoder();
    },
    transform(chunk, controller) {
      controller.enqueue(this.encoder.encode(chunk));
    },
  };

  let instances = new WeakMap();
  class JSTextEncoderStream extends TransformStream {
    constructor() {
      super(TextEncoderStreamInterface);
      instances.set(this, TextEncoderStreamInterface);
    }
    get encoding() {
      return instances.get(this).encoder.encoding;
    }
  }

  const stream = new JSTextEncoderStream();
  const { writable, readable } = stream;

  const writer = writable.getWriter();
  writer.write("hello");
  writer.write("world");
  writer.close();

  const reader = readable.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  reader.cancel();

  expect(Buffer.concat(chunks).toString()).toEqual("helloworld");
});

describe("readableStreamToFormData", () => {
  const fixtures = {
    withTextFile: [
      [
        "--WebKitFormBoundary7MA4YWxkTrZu0gW\r\n",
        'Content-Disposition: form-data; name="file"; filename="test.txt"\r\n',
        "Content-Type: text/plain\r\n",
        "\r\n",
        "hello world",
        "\r\n",
        "--WebKitFormBoundary7MA4YWxkTrZu0gW--\r\n",
        "\r\n",
      ],
      (() => {
        const fd = new FormData();
        fd.append("file", new Blob(["hello world"]), "test.txt");
        return fd;
      })(),
    ],
    withTextFileAndField: [
      [
        "--WebKitFormBoundary7MA4YWxkTrZu0gW\r\n",
        'Content-Disposition: form-data; name="field"\r\n',
        "\r\n",
        "value",
        "\r\n",
        "--WebKitFormBoundary7MA4YWxkTrZu0gW\r\n",
        'Content-Disposition: form-data; name="file"; filename="test.txt"\r\n',
        "Content-Type: text/plain\r\n",
        "\r\n",
        "hello world",
        "\r\n",
        "--WebKitFormBoundary7MA4YWxkTrZu0gW--\r\n",
        "\r\n",
      ],
      (() => {
        const fd = new FormData();
        fd.append("file", new Blob(["hello world"]), "test.txt");
        fd.append("field", "value");
        return fd;
      })(),
    ],

    with1Field: [
      [
        "--WebKitFormBoundary7MA4YWxkTrZu0gW\r\n",
        'Content-Disposition: form-data; name="field"\r\n',
        "\r\n",
        "value",
        "\r\n",
        "--WebKitFormBoundary7MA4YWxkTrZu0gW--\r\n",
        "\r\n",
      ],
      (() => {
        const fd = new FormData();
        fd.append("field", "value");
        return fd;
      })(),
    ],

    empty: [["--WebKitFormBoundary7MA4YWxkTrZu0gW--\r\n", "\r\n"], new FormData()],
  };
  for (let name in fixtures) {
    const [chunks, expected] = fixtures[name];
    function responseWithStart(start) {
      return new Response(
        new ReadableStream({
          start(controller) {
            for (let chunk of chunks) {
              controller.enqueue(chunk);
            }
            controller.close();
          },
        }),
        {
          headers: {
            "content-type": "multipart/form-data; boundary=WebKitFormBoundary7MA4YWxkTrZu0gW",
          },
        },
      );
    }

    function responseWithPull(start) {
      return new Response(
        new ReadableStream({
          pull(controller) {
            for (let chunk of chunks) {
              controller.enqueue(chunk);
            }
            controller.close();
          },
        }),
        {
          headers: {
            "content-type": "multipart/form-data; boundary=WebKitFormBoundary7MA4YWxkTrZu0gW",
          },
        },
      );
    }

    function responseWithPullAsync(start) {
      return new Response(
        new ReadableStream({
          async pull(controller) {
            for (let chunk of chunks) {
              await Bun.sleep(0);
              controller.enqueue(chunk);
            }
            controller.close();
          },
        }),
        {
          headers: {
            "content-type": "multipart/form-data; boundary=WebKitFormBoundary7MA4YWxkTrZu0gW",
          },
        },
      );
    }

    test("response.formData()", async () => {
      expect((await responseWithPull().formData()).toJSON()).toEqual(expected.toJSON());
      expect((await responseWithStart().formData()).toJSON()).toEqual(expected.toJSON());
      expect((await responseWithPullAsync().formData()).toJSON()).toEqual(expected.toJSON());
    });

    test("Bun.readableStreamToFormData", async () => {
      expect(
        (
          await Bun.readableStreamToFormData(await responseWithPull().body, "WebKitFormBoundary7MA4YWxkTrZu0gW")
        ).toJSON(),
      ).toEqual(expected.toJSON());
    });

    test("FormData.from", async () => {
      expect(FormData.from(await responseWithPull().text(), "WebKitFormBoundary7MA4YWxkTrZu0gW").toJSON()).toEqual(
        expected.toJSON(),
      );

      expect(FormData.from(await responseWithPull().blob(), "WebKitFormBoundary7MA4YWxkTrZu0gW").toJSON()).toEqual(
        expected.toJSON(),
      );

      expect(
        FormData.from(
          await (await responseWithPull().blob()).arrayBuffer(),
          "WebKitFormBoundary7MA4YWxkTrZu0gW",
        ).toJSON(),
      ).toEqual(expected.toJSON());
    });
  }

  test("URL-encoded example", async () => {
    const stream = new Response("hello=123").body;
    const formData = await Bun.readableStreamToFormData(stream);
    expect(formData.get("hello")).toBe("123");
  });
});

describe("WritableStream", () => {
  it("works", async () => {
    try {
      var chunks = [];
      var writable = new WritableStream({
        write(chunk, controller) {
          chunks.push(chunk);
        },
        close(er) {},
        abort(reason) {
          console.log("aborted!");
          console.log(reason);
        },
      });

      var writer = writable.getWriter();

      writer.write(new Uint8Array([1, 2, 3]));

      writer.write(new Uint8Array([4, 5, 6]));

      await writer.close();

      expect(JSON.stringify(Array.from(Buffer.concat(chunks)))).toBe(JSON.stringify([1, 2, 3, 4, 5, 6]));
    } catch (e) {
      console.log(e);
      console.log(e.stack);
      throw e;
    }
  });

  it("pipeTo", async () => {
    const rs = new ReadableStream({
      start(controller) {
        controller.enqueue("hello world");
        controller.close();
      },
    });

    let received;
    const ws = new WritableStream({
      write(chunk, controller) {
        received = chunk;
      },
    });
    await rs.pipeTo(ws);
    expect(received).toBe("hello world");
  });
});

describe("ReadableStream.prototype.tee", () => {
  it("class", () => {
    const [a, b] = new ReadableStream().tee();
    expect(a instanceof ReadableStream).toBe(true);
    expect(b instanceof ReadableStream).toBe(true);
  });

  describe("default stream", () => {
    it("works", async () => {
      var [a, b] = new ReadableStream({
        start(controller) {
          controller.enqueue("a");
          controller.enqueue("b");
          controller.enqueue("c");
          controller.close();
        },
      }).tee();

      expect(await readableStreamToText(a)).toBe("abc");
      expect(await readableStreamToText(b)).toBe("abc");
    });
  });

  describe("direct stream", () => {
    it("works", async () => {
      try {
        var [a, b] = new ReadableStream({
          pull(controller) {
            controller.write("a");
            controller.write("b");
            controller.write("c");
            controller.close();
          },
          type: "direct",
        }).tee();

        expect(await readableStreamToText(a)).toBe("abc");
        expect(await readableStreamToText(b)).toBe("abc");
      } catch (e) {
        console.log(e.message);
        console.log(e.stack);
        throw e;
      }
    });
  });
});

it("ReadableStream.prototype[Symbol.asyncIterator]", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue("hello");
      controller.enqueue("world");
      controller.close();
    },
    cancel(reason) {},
  });

  const chunks = [];
  try {
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
  } catch (e) {
    console.log(e.message);
    console.log(e.stack);
  }

  expect(chunks.join("")).toBe("helloworld");
});

it("ReadableStream.prototype[Symbol.asyncIterator] pull", async () => {
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue("hello");
      controller.enqueue("world");
      controller.close();
    },
    cancel(reason) {},
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  expect(chunks.join("")).toBe("helloworld");
});

it("ReadableStream.prototype[Symbol.asyncIterator] direct", async () => {
  const stream = new ReadableStream({
    pull(controller) {
      controller.write("hello");
      controller.write("world");
      controller.close();
    },
    type: "direct",
    cancel(reason) {},
  });

  const chunks = [];
  try {
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
  } catch (e) {
    console.log(e.message);
    console.log(e.stack);
  }

  expect(Buffer.concat(chunks).toString()).toBe("helloworld");
});

it("ReadableStream.prototype.values() cancel", async () => {
  var cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue("hello");
      controller.enqueue("world");
    },
    cancel(reason) {
      cancelled = true;
    },
  });

  for await (const chunk of stream.values({ preventCancel: false })) {
    break;
  }
  expect(cancelled).toBe(true);
});

it("ReadableStream.prototype.values() preventCancel", async () => {
  var cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue("hello");
      controller.enqueue("world");
    },
    cancel(reason) {
      cancelled = true;
    },
  });

  for await (const chunk of stream.values({ preventCancel: true })) {
    break;
  }
  expect(cancelled).toBe(false);
});

it("ReadableStream.prototype.values", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue("hello");
      controller.enqueue("world");
      controller.close();
    },
  });

  const chunks = [];
  for await (const chunk of stream.values()) {
    chunks.push(chunk);
  }
  expect(chunks.join("")).toBe("helloworld");
});

it.todoIf(isWindows || isMacOS)("Bun.file() read text from pipe", async () => {
  const fifoPath = join(tmpdirSync(), "bun-streams-test-fifo");
  try {
    unlinkSync(fifoPath);
  } catch {}

  console.log("here");
  mkfifo(fifoPath, 0o666);

  // 65k so its less than the max on linux
  const large = "HELLO!".repeat((((1024 * 65) / "HELLO!".length) | 0) + 1);

  const chunks = [];

  const proc = Bun.spawn({
    cmd: ["bash", join(import.meta.dir + "/", "bun-streams-test-fifo.sh"), fifoPath],
    stderr: "inherit",
    stdout: "pipe",
    stdin: null,
    env: {
      ...bunEnv,
      FIFO_TEST: large,
    },
  });
  const exited = proc.exited;
  proc.ref();

  const prom = (async function () {
    while (chunks.length === 0) {
      var out = Bun.file(fifoPath).stream();
      for await (const chunk of out) {
        chunks.push(chunk);
      }
    }
    return Buffer.concat(chunks).toString();
  })();

  const [status, output] = await Promise.all([exited, prom]);
  expect(output.length).toBe(large.length + 1);
  expect(output).toBe(large + "\n");
  expect(status).toBe(0);
});

it("exists globally", () => {
  expect(typeof ReadableStream).toBe("function");
  expect(typeof ReadableStreamBYOBReader).toBe("function");
  expect(typeof ReadableStreamBYOBRequest).toBe("function");
  expect(typeof ReadableStreamDefaultController).toBe("function");
  expect(typeof ReadableStreamDefaultReader).toBe("function");
  expect(typeof TransformStream).toBe("function");
  expect(typeof TransformStreamDefaultController).toBe("function");
  expect(typeof WritableStream).toBe("function");
  expect(typeof WritableStreamDefaultController).toBe("function");
  expect(typeof WritableStreamDefaultWriter).toBe("function");
  expect(typeof ByteLengthQueuingStrategy).toBe("function");
  expect(typeof CountQueuingStrategy).toBe("function");
});

it("new Response(stream).body", async () => {
  var stream = new ReadableStream({
    pull(controller) {
      controller.enqueue("hello");
      controller.enqueue("world");
      controller.close();
    },
    cancel() {},
  });
  var response = new Response(stream);
  expect(response.body).toBe(stream);
  expect(await response.text()).toBe("helloworld");
});

it("new Request({body: stream}).body", async () => {
  var stream = new ReadableStream({
    pull(controller) {
      controller.enqueue("hello");
      controller.enqueue("world");
      controller.close();
    },
    cancel() {},
  });
  var response = new Request({ body: stream, url: "https://example.com" });
  expect(response.body).toBe(stream);
  expect(await response.text()).toBe("helloworld");
});

it("ReadableStream (readMany)", async () => {
  var stream = new ReadableStream({
    pull(controller) {
      controller.enqueue("hello");
      controller.enqueue("world");
      controller.close();
    },
    cancel() {},
  });
  var reader = stream.getReader();
  const chunk = await reader.readMany();
  expect(chunk.value.join("")).toBe("helloworld");
  expect((await reader.read()).done).toBe(true);
});

it("ReadableStream (direct)", async () => {
  var stream = new ReadableStream({
    pull(controller) {
      controller.write("hello");
      controller.write("world");
      controller.close();
    },
    cancel() {},
    type: "direct",
  });
  var reader = stream.getReader();
  const chunk = await reader.read();
  expect(chunk.value.join("")).toBe(Buffer.from("helloworld").join(""));
  expect((await reader.read()).done).toBe(true);
  expect((await reader.read()).done).toBe(true);
});

it("ReadableStream (bytes)", async () => {
  var stream = new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.from("abdefgh"));
    },
    pull(controller) {},
    cancel() {},
    type: "bytes",
  });
  const chunks = [];
  const chunk = await stream.getReader().read();
  chunks.push(chunk.value);
  expect(chunks[0].join("")).toBe(Buffer.from("abdefgh").join(""));
});

it("ReadableStream (default)", async () => {
  var stream = new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.from("abdefgh"));
      controller.close();
    },
    pull(controller) {},
    cancel() {},
  });
  const chunks = [];
  const chunk = await stream.getReader().read();
  chunks.push(chunk.value);
  expect(chunks[0].join("")).toBe(Buffer.from("abdefgh").join(""));
});

describe("multi-chunk consumers produce exactly the concatenated bytes", () => {
  const source = chunks =>
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
  const base = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const cases = {
    "many typed-array views with offsets": {
      chunks: () => [base.subarray(1, 4), base.subarray(0, 0), base.subarray(4, 9), base.subarray(9)],
      expected: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    },
    "mixed ArrayBuffer, Uint8Array, and DataView": {
      chunks: () => [base.slice(0, 3).buffer, base.subarray(3, 6), new DataView(base.buffer, 6, 4)],
      expected: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    },
    "strings mixed with bytes": {
      chunks: () => ["ab", new Uint8Array([1, 2]), "cd"],
      expected: [...Buffer.from("ab"), 1, 2, ...Buffer.from("cd")],
    },
    "only strings": {
      chunks: () => ["hé", "llo"],
      expected: [...Buffer.from("héllo")],
    },
  };
  for (const [name, { chunks, expected }] of Object.entries(cases)) {
    it(name, async () => {
      expect(Array.from(await Bun.readableStreamToBytes(source(chunks())))).toEqual(expected);
      expect(Array.from(new Uint8Array(await Bun.readableStreamToArrayBuffer(source(chunks()))))).toEqual(expected);
      expect(Array.from(await new Response(source(chunks())).bytes())).toEqual(expected);
      expect(Array.from(new Uint8Array(await new Response(source(chunks())).arrayBuffer()))).toEqual(expected);
    });
  }

  const textCases = {
    "only strings": { chunks: () => ["hé", "llo"], text: "héllo" },
    "strings mixed with bytes": { chunks: () => ["ab", new Uint8Array([49, 50]), "cd"], text: "ab12cd" },
    "many typed-array views": {
      chunks: () => [new TextEncoder().encode("a\u00e9"), new TextEncoder().encode("b")],
      text: "aéb",
    },
    "single string with a BOM": { chunks: () => ["\uFEFFabc"], text: "abc" },
    "a BOM split across string chunks": { chunks: () => ["\uFEFF", "\uFEFFabc"], text: "abc" },
    "a BOM string chunk before bytes": { chunks: () => ["\uFEFF", new TextEncoder().encode("abc")], text: "abc" },
    "lone surrogate in a string chunk": { chunks: () => ["a\uD800b"], text: "a\uD800b" },
    "a BOM string chunk after bytes": { chunks: () => [new TextEncoder().encode("ab"), "\uFEFFcd"], text: "abcd" },
    "a surrogate pair split across string chunks after bytes": {
      chunks: () => [new TextEncoder().encode("x"), "\uD83D", "\uDE00"],
      text: "x\u{1F600}",
    },
    "invalid UTF-8 bytes": { chunks: () => [new Uint8Array([0x61, 0xff, 0x62])], text: "a\uFFFDb" },
  };
  for (const [name, { chunks, text }] of Object.entries(textCases)) {
    it(`text: ${name}`, async () => {
      expect(await Bun.readableStreamToText(source(chunks()))).toBe(text);
      expect(await new Response(source(chunks())).text()).toBe(text);
    });
  }

  it("a direct stream's buffered write reaches a waiting reader at the end of the tick", async () => {
    // No explicit flush() and pull never returns: only the controller's end-of-tick
    // flush can deliver the chunk.
    const rs = new ReadableStream({
      type: "direct",
      pull(c) {
        c.write("tick");
        return new Promise(() => {});
      },
    });
    const reader = rs.getReader();
    const result = await Promise.race([reader.read(), Bun.sleep(1000).then(() => "TIMEOUT")]);
    expect(result).not.toBe("TIMEOUT");
    expect(new TextDecoder().decode(result.value)).toBe("tick");
  });

  it("an async generator Response body delivers each yield to a JS reader as it is produced", async () => {
    async function* gen() {
      for (let i = 0; i < 3; i++) {
        yield `c${i};`;
        await Bun.sleep(30);
      }
    }
    const reader = new Response(gen()).body.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }
    // Batched-to-one delivery means the end-of-tick flush regressed.
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks.join("")).toBe("c0;c1;c2;");
  });

  it("canceling a direct stream's reader settles its pending read", async () => {
    const rs = new ReadableStream({
      type: "direct",
      async pull() {
        await new Promise(() => {});
      },
    });
    const reader = rs.getReader();
    const read = reader.read();
    await reader.cancel("bye");
    // https://github.com/oven-sh/bun/pull/33193: this read hung forever.
    const result = await read;
    expect(result.done).toBe(true);
  });

  it("canceling a direct stream invokes the source's cancel() callback", async () => {
    // reader.cancel(): controller materialized
    {
      let reason;
      const rs = new ReadableStream({
        type: "direct",
        pull(c) {
          c.write("hello");
          c.flush();
        },
        cancel(r) {
          reason = r;
        },
      });
      const reader = rs.getReader();
      await reader.read();
      await reader.cancel("bye");
      expect(reason).toBe("bye");
    }
    // stream.cancel() before any reader: controller not yet materialized
    {
      let reason;
      const rs = new ReadableStream({
        type: "direct",
        pull() {},
        cancel(r) {
          reason = r;
        },
      });
      await rs.cancel("early");
      expect(reason).toBe("early");
    }
    // the cancel promise chains onto the source's returned promise
    {
      const order = [];
      const rs = new ReadableStream({
        type: "direct",
        pull() {},
        async cancel() {
          await Promise.resolve();
          order.push("source");
        },
      });
      await rs.cancel();
      order.push("awaited");
      expect(order).toEqual(["source", "awaited"]);
    }
  });

  it("a direct stream's controller.write() throws after reader.cancel()", async () => {
    let capturedController;
    const rs = new ReadableStream({
      type: "direct",
      pull(c) {
        capturedController = c;
        c.write("a");
        c.flush();
      },
    });
    const reader = rs.getReader();
    await reader.read();
    await reader.cancel();
    expect(() => capturedController.write("b")).toThrow();
  });

  it("releasing a direct stream's reader during an async pull does not crash close", async () => {
    const rs = new ReadableStream({
      type: "direct",
      async pull(c) {
        await Promise.resolve();
        c.write(new Uint8Array(10));
        c.end();
      },
    });
    const reader = rs.getReader();
    const read = reader.read().catch(e => e);
    reader.releaseLock();
    await read;
    await Bun.sleep(0);
    // The flushed final chunk is delivered to the NEXT reader.
    const { value } = await rs.getReader().read();
    expect(value.byteLength).toBe(10);
  });

  // A type:"direct" pull() is re-invoked per read as a demand signal, but never while a
  // previous async pull() is still pending and never after end(). A pull that writes the
  // whole body and ends therefore runs exactly once.
  describe("a direct stream's async pull() is not re-entered while pending", () => {
    const N = 30000;
    const CS = 4096;
    const body = new Uint8Array(N);
    for (let i = 0; i < N; i++) body[i] = (i * 131) & 0xff;
    const makeSource = counter => ({
      type: "direct",
      async pull(c) {
        counter.pulls++;
        for (let o = 0; o < N; o += CS) {
          c.write(body.subarray(o, Math.min(o + CS, N)));
          await c.flush();
        }
        c.end();
      },
    });
    const readAll = async rs => {
      const reader = rs.getReader();
      const parts = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        total += value.length;
      }
      const out = new Uint8Array(total);
      let offset = 0;
      for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
      }
      return out;
    };

    it("via getReader()", async () => {
      const counter = { pulls: 0 };
      const bytes = await readAll(new ReadableStream(makeSource(counter)));
      expect(counter.pulls).toBe(1);
      expect(bytes.length).toBe(N);
      expect(bytes).toEqual(body);
    });

    it("via tee()", async () => {
      const counter = { pulls: 0 };
      const [a, b] = new ReadableStream(makeSource(counter)).tee();
      const [ba, bb] = await Promise.all([readAll(a), readAll(b)]);
      expect(counter.pulls).toBe(1);
      expect(ba.length).toBe(N);
      expect(bb.length).toBe(N);
      expect(ba).toEqual(body);
      expect(bb).toEqual(body);
    });

    it("via for-await", async () => {
      const counter = { pulls: 0 };
      let total = 0;
      for await (const chunk of new ReadableStream(makeSource(counter))) total += chunk.length;
      expect(counter.pulls).toBe(1);
      expect(total).toBe(N);
    });

    it("for-await receives the final chunk when end() follows a write without a flush", async () => {
      // end() runs while no reader is waiting, so onClose arms m_finalChunk; the next
      // for-await/tee read must receive it via its readRequest, not a dropped promise.
      const mk = () =>
        new ReadableStream({
          type: "direct",
          async pull(c) {
            c.write(new Uint8Array(10));
            await c.flush();
            c.write(new Uint8Array(20));
            c.end();
          },
        });
      let total = 0;
      for await (const chunk of mk()) total += chunk.byteLength;
      expect(total).toBe(30);
      const [a, b] = mk().tee();
      const [na, nb] = await Promise.all([readAll(a), readAll(b)]);
      expect({ a: na.length, b: nb.length }).toEqual({ a: 30, b: 30 });
    });

    it("via readMany()", async () => {
      const counter = { pulls: 0 };
      const reader = new ReadableStream(makeSource(counter)).getReader();
      let total = 0;
      while (true) {
        const r = await reader.readMany();
        if (r.done) break;
        for (const v of r.value) total += v.length;
      }
      expect(counter.pulls).toBe(1);
      expect(total).toBe(N);
    });

    it("a write buffered while no reader is waiting is delivered on the next read", async () => {
      const { promise: readerIdle, resolve: markReaderIdle } = Promise.withResolvers();
      const { promise: gate, resolve: openGate } = Promise.withResolvers();
      const { promise: wrote, resolve: markWrote } = Promise.withResolvers();
      const rs = new ReadableStream({
        type: "direct",
        async pull(c) {
          c.write(new Uint8Array(10));
          await c.flush();
          await readerIdle;
          c.write(new Uint8Array(20));
          markWrote();
          await gate;
          c.end();
        },
      });
      const reader = rs.getReader();
      expect((await reader.read()).value.byteLength).toBe(10);
      markReaderIdle();
      await wrote;
      // Yield one macrotask so the end-of-tick auto-flush has already run (and found no
      // waiting reader). The NEXT read must still drain the buffered 20 bytes from the sink.
      await new Promise(resolve => setImmediate(resolve));
      expect((await reader.read()).value.byteLength).toBe(20);
      openGate();
      expect((await reader.read()).done).toBe(true);
    });

    it("a per-call pull() that writes one chunk and returns is re-invoked on each read", async () => {
      let pulls = 0;
      const rs = new ReadableStream({
        type: "direct",
        async pull(c) {
          pulls++;
          if (pulls > 3) return c.end();
          await Promise.resolve();
          c.write(new Uint8Array([pulls]));
          c.flush();
        },
      });
      const reader = rs.getReader();
      const out = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const b of value) out.push(b);
      }
      expect({ pulls, out }).toEqual({ pulls: 4, out: [1, 2, 3] });
    });

    it("reads issued while pull() is suspended are each serviced by a subsequent pull", async () => {
      let pulls = 0;
      const gates = [];
      const rs = new ReadableStream({
        type: "direct",
        async pull(c) {
          pulls++;
          if (pulls > 3) return c.end();
          const { promise, resolve } = Promise.withResolvers();
          gates.push(resolve);
          await promise;
          c.write(new Uint8Array([pulls]));
          c.flush();
        },
      });
      const reader = rs.getReader();
      const p1 = reader.read();
      // These arrive while pull #1 is suspended: must NOT re-enter pull() concurrently,
      // and each must be serviced by a subsequent pull once the previous one settles.
      const p2 = reader.read();
      const p3 = reader.read();
      expect(pulls).toBe(1);
      gates.shift()();
      expect((await p1).value[0]).toBe(1);
      await new Promise(resolve => setImmediate(resolve));
      gates.shift()();
      expect((await p2).value[0]).toBe(2);
      await new Promise(resolve => setImmediate(resolve));
      gates.shift()();
      expect((await p3).value[0]).toBe(3);
      expect((await reader.read()).done).toBe(true);
    });

    // Three concurrent reads must each be serviced regardless of where the per-call
    // producer's write/flush sits relative to its first await.
    const perCallShapes = {
      "write without flush": () => {
        let n = 0;
        return async c => {
          n++;
          await Promise.resolve();
          c.write(new Uint8Array([n]));
        };
      },
      "write and flush before the first await": () => {
        let n = 0;
        return async c => {
          n++;
          c.write(new Uint8Array([n]));
          c.flush();
          await Promise.resolve();
        };
      },
      "first call async, later calls sync": () => {
        let n = 0;
        return c => {
          n++;
          if (n === 1)
            return Promise.resolve().then(() => {
              c.write(new Uint8Array([1]));
              c.flush();
            });
          c.write(new Uint8Array([n]));
          c.flush();
        };
      },
      "first call async, later calls sync without flush": () => {
        let n = 0;
        return c => {
          n++;
          if (n === 1)
            return Promise.resolve().then(() => {
              c.write(new Uint8Array([1]));
              c.flush();
            });
          c.write(new Uint8Array([n]));
        };
      },
    };
    it.each(Object.keys(perCallShapes))(
      "three concurrent reads are each serviced by a per-call pull (%s)",
      async shape => {
        const rs = new ReadableStream({ type: "direct", pull: perCallShapes[shape]() });
        const reader = rs.getReader();
        const reads = [reader.read(), reader.read(), reader.read()];
        const [r1, r2, r3] = await Promise.all(reads);
        expect({ r1: r1.value[0], r2: r2.value[0], r3: r3.value[0] }).toEqual({ r1: 1, r2: 2, r3: 3 });
      },
    );

    it("an async pull() that returns without writing is not re-invoked from its own fulfillment", async () => {
      // Edge-triggered re-pull: a do-nothing pull must not livelock the microtask queue.
      let pulls = 0;
      const rs = new ReadableStream({
        type: "direct",
        async pull() {
          pulls++;
        },
      });
      rs.getReader().read();
      await new Promise(resolve => setImmediate(resolve));
      expect(pulls).toBe(1);
    });

    it("a read whose demand was already satisfied does not cause a spurious re-pull", async () => {
      let pulls = 0;
      const rs = new ReadableStream({
        type: "direct",
        async pull(c) {
          pulls++;
          c.write(new Uint8Array([1]));
          await c.flush();
          c.write(new Uint8Array([2]));
          await c.flush();
        },
      });
      const reader = rs.getReader();
      await Promise.all([reader.read(), reader.read()]);
      await new Promise(resolve => setImmediate(resolve));
      // Both reads were satisfied by pull #1's two flushes; m_pullAgain set by the second
      // read() must not trigger a demand-less re-pull.
      expect(pulls).toBe(1);
    });
  });

  it("a patched Object.prototype.then that releases the reader mid-resolution does not crash", async () => {
    let releaseNow = null;
    Object.defineProperty(Object.prototype, "then", {
      configurable: true,
      get() {
        if (releaseNow) {
          const release = releaseNow;
          releaseNow = null;
          try {
            release();
          } catch {}
        }
        return undefined;
      },
    });
    try {
      let ctrl;
      const rs = new ReadableStream({
        type: "bytes",
        start(c) {
          ctrl = c;
        },
      });
      const reader = rs.getReader();
      const read = reader.read().catch(() => {});
      releaseNow = () => reader.releaseLock();
      ctrl.enqueue(new Uint8Array(8));
      await read;

      let ctrl2;
      const rs2 = new ReadableStream({
        type: "bytes",
        start(c) {
          ctrl2 = c;
        },
      });
      const byobReader = rs2.getReader({ mode: "byob" });
      const a = byobReader.read(new Uint8Array(4)).catch(() => {});
      const b = byobReader.read(new Uint8Array(4)).catch(() => {});
      ctrl2.close();
      releaseNow = () => byobReader.releaseLock();
      ctrl2.byobRequest?.respond(0);
      await Promise.all([a, b]);
    } finally {
      delete Object.prototype.then;
    }
    expect(true).toBe(true);
  });

  it("new ReadableStreamDefaultReader(lazyNativeStream) materializes it like getReader()", async () => {
    using dir = tempDir("reader-ctor", { "data.txt": "reader-ctor-data" });
    const reader = new ReadableStreamDefaultReader(Bun.file(join(String(dir), "data.txt")).stream());
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    expect(Buffer.concat(chunks).toString()).toBe("reader-ctor-data");
  });

  it("a queuing strategy size() result is coerced like Node (valueOf)", async () => {
    let calls = 0;
    const rs = new ReadableStream(
      {
        start(c) {
          c.enqueue("a");
          c.close();
        },
      },
      { highWaterMark: 5, size: () => ({ valueOf: () => (calls++, 2) }) },
    );
    expect(await Bun.readableStreamToText(rs)).toBe("a");
    expect(calls).toBe(1);
    const written = [];
    const ws = new WritableStream(
      {
        write(c) {
          written.push(c);
        },
      },
      { highWaterMark: 5, size: () => ({ valueOf: () => 3 }) },
    );
    const writer = ws.getWriter();
    await writer.write("z");
    expect(written).toEqual(["z"]);
  });

  it("text: an invalid chunk rejects rather than throwing", async () => {
    const p = Bun.readableStreamToText(source([42]));
    expect(p).toBeInstanceOf(Promise);
    await expect(p).rejects.toThrow(expect.objectContaining({ name: "TypeError" }));
    await expect(new Response(source([42])).text()).rejects.toThrow(expect.objectContaining({ name: "TypeError" }));
  });

  it("a detached chunk throws", () => {
    const chunk = new Uint8Array([1, 2, 3]);
    structuredClone(chunk.buffer, { transfer: [chunk.buffer] });
    // The chunk array is available synchronously, so the failure is synchronous too.
    expect(() => Bun.readableStreamToBytes(source([new Uint8Array([9]), chunk]))).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_STATE",
        message: "Invalid state: Cannot validate on a detached buffer",
      }),
    );
  });
});

it("readableStreamToArray", async () => {
  var queue = [Buffer.from("abdefgh")];
  var stream = new ReadableStream({
    pull(controller) {
      var chunk = queue.shift();
      if (chunk) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
    cancel() {},
    type: "bytes",
  });

  const chunks = await readableStreamToArray(stream);

  expect(chunks[0].join("")).toBe(Buffer.from("abdefgh").join(""));
});

it("readableStreamToArrayBuffer (bytes)", async () => {
  var queue = [Buffer.from("abdefgh")];
  var stream = new ReadableStream({
    pull(controller) {
      var chunk = queue.shift();
      if (chunk) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
    cancel() {},
    type: "bytes",
  });
  const buffer = await readableStreamToArrayBuffer(stream);
  expect(new TextDecoder().decode(new Uint8Array(buffer))).toBe("abdefgh");
});

it("readableStreamToArrayBuffer (default)", async () => {
  var queue = [Buffer.from("abdefgh")];
  var stream = new ReadableStream({
    pull(controller) {
      var chunk = queue.shift();
      if (chunk) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
    cancel() {},
  });

  const buffer = await readableStreamToArrayBuffer(stream);
  expect(new TextDecoder().decode(new Uint8Array(buffer))).toBe("abdefgh");
});

it("readableStreamToBytes (bytes)", async () => {
  var queue = [Buffer.from("abdefgh")];
  var stream = new ReadableStream({
    pull(controller) {
      var chunk = queue.shift();
      if (chunk) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
    cancel() {},
    type: "bytes",
  });
  const buffer = await readableStreamToBytes(stream);
  expect(new TextDecoder().decode(new Uint8Array(buffer))).toBe("abdefgh");
});

it("readableStreamToBytes (default)", async () => {
  var queue = [Buffer.from("abdefgh")];
  var stream = new ReadableStream({
    pull(controller) {
      var chunk = queue.shift();
      if (chunk) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
    cancel() {},
  });

  const buffer = await readableStreamToBytes(stream);
  expect(new TextDecoder().decode(new Uint8Array(buffer))).toBe("abdefgh");
});

describe("consuming an already-errored stream rejects instead of throwing", () => {
  const erroredStream = error =>
    new ReadableStream({
      start(controller) {
        controller.error(error);
      },
    });

  test.each([
    "readableStreamToArrayBuffer",
    "readableStreamToBytes",
    "readableStreamToBlob",
    "readableStreamToArray",
    "readableStreamToFormData",
    "readableStreamToText",
    "readableStreamToJSON",
  ])("Bun.%s", async name => {
    const error = new Error("boom");
    let promise;
    expect(() => {
      promise = Bun[name](erroredStream(error));
    }).not.toThrow();
    expect(promise).toBeInstanceOf(Promise);
    await expect(promise).rejects.toBe(error);
  });

  test.each(["arrayBuffer", "bytes", "blob", "formData", "text", "json"])("Response.prototype.%s", async name => {
    const error = new Error("boom");
    const response = new Response(erroredStream(error), {
      headers: { "content-type": "multipart/form-data; boundary=x" },
    });
    let promise;
    expect(() => {
      promise = response[name]();
    }).not.toThrow();
    expect(promise).toBeInstanceOf(Promise);
    await expect(promise).rejects.toBe(error);
  });

  test.each(["arrayBuffer", "bytes", "blob", "formData", "text", "json"])("Request.prototype.%s", async name => {
    const error = new Error("boom");
    const request = new Request("http://localhost/", {
      method: "POST",
      body: erroredStream(error),
      headers: { "content-type": "multipart/form-data; boundary=x" },
    });
    let promise;
    expect(() => {
      promise = request[name]();
    }).not.toThrow();
    expect(promise).toBeInstanceOf(Promise);
    await expect(promise).rejects.toBe(error);
  });
});

it("ReadableStream for Blob", async () => {
  var blob = new Blob(["abdefgh", "ijklmnop"]);
  expect(await blob.text()).toBe("abdefghijklmnop");
  var stream;
  try {
    stream = blob.stream();
    stream = blob.stream();
  } catch (e) {
    console.error(e);
    console.error(e.stack);
  }
  const chunks = [];
  var reader;
  reader = stream.getReader();

  while (true) {
    var chunk;
    try {
      chunk = await reader.read();
    } catch (e) {
      console.error(e);
      console.error(e.stack);
    }
    if (chunk.done) break;
    chunks.push(new TextDecoder().decode(chunk.value));
  }
  expect(chunks.join("")).toBe(new TextDecoder().decode(Buffer.from("abdefghijklmnop")));
});

it("ReadableStream for File", async () => {
  var blob = file(import.meta.dir + "/fetch.js.txt");
  var stream = blob.stream();
  const chunks = [];
  var reader = stream.getReader();
  stream = undefined;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    chunks.push(chunk.value);
  }
  reader = undefined;
  const output = new Uint8Array(await blob.arrayBuffer()).join("");
  const input = chunks.map(a => a.join("")).join("");
  expect(output).toBe(input);
});

it("ReadableStream for File errors", async () => {
  try {
    var blob = file(import.meta.dir + "/fetch.js.txt.notfound");
    blob.stream().getReader();
    throw new Error("should not reach here");
  } catch (e) {
    expect(e.code).toBe("ENOENT");
    expect(e.syscall).toBe("open");
  }
});

it("ReadableStream for empty blob closes immediately", async () => {
  var blob = new Blob([]);
  var stream = blob.stream();
  const chunks = [];
  var reader = stream.getReader();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    chunks.push(chunk.value);
  }

  expect(chunks.length).toBe(0);
});

it("ReadableStream for empty file closes immediately", async () => {
  const emptyFile = join(tmpdirSync(), "empty");
  writeFileSync(emptyFile, "");
  var blob = file(emptyFile);
  var stream;
  try {
    stream = blob.stream();
  } catch (e) {
    console.error(e.stack);
  }
  const chunks = [];
  var reader = stream.getReader();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    chunks.push(chunk.value);
  }

  expect(chunks.length).toBe(0);
});

it("ReadableStream errors the stream on pull rejection", async () => {
  let stream = new ReadableStream({
    pull(controller) {
      return Promise.reject("pull rejected");
    },
  });

  let reader = stream.getReader();
  let closed = reader.closed.catch(err => `closed: ${err}`);
  let read = reader.read().catch(err => `read: ${err}`);
  expect(await Promise.race([closed, read])).toBe("closed: pull rejected");
  expect(await read).toBe("read: pull rejected");
});

it("ReadableStream rejects pending reads when the lock is released", async () => {
  let { resolve, promise } = Promise.withResolvers();
  let stream = new ReadableStream({
    async pull(controller) {
      controller.enqueue("123");
      await promise;
      controller.enqueue("456");
      controller.close();
    },
  });

  let reader = stream.getReader();
  expect((await reader.read()).value).toBe("123");

  let read = reader.read();
  reader.releaseLock();
  // Released locks reject pending reads and `closed` with a TypeError (WHATWG),
  // carrying Node's ERR_INVALID_STATE code and messages (node compatibility).
  await expect(read).rejects.toThrow(
    expect.objectContaining({
      name: "TypeError",
      code: "ERR_INVALID_STATE",
      message: "Invalid state: Releasing reader",
    }),
  );
  await expect(reader.closed).rejects.toThrow(
    expect.objectContaining({
      name: "TypeError",
      code: "ERR_INVALID_STATE",
      message: "Invalid state: Reader released",
    }),
  );

  resolve();

  reader = stream.getReader();
  expect((await reader.read()).value).toBe("456");
});

it("new Response(stream).arrayBuffer() (bytes)", async () => {
  var queue = [Buffer.from("abdefgh")];
  var stream = new ReadableStream({
    pull(controller) {
      var chunk = queue.shift();
      if (chunk) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
    cancel() {},
    type: "bytes",
  });
  const buffer = await new Response(stream).arrayBuffer();
  expect(new TextDecoder().decode(buffer)).toBe("abdefgh");
});

it("new Response(stream).arrayBuffer() (default)", async () => {
  var queue = [Buffer.from("abdefgh")];
  var stream = new ReadableStream({
    pull(controller) {
      var chunk = queue.shift();
      if (chunk) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
    cancel() {},
  });
  const buffer = await new Response(stream).arrayBuffer();
  expect(new TextDecoder().decode(buffer)).toBe("abdefgh");
});

it("new Response(stream).arrayBuffer() (direct)", async () => {
  var queue = [Buffer.from("abdefgh")];
  var stream = new ReadableStream({
    pull(controller) {
      var chunk = queue.shift();
      controller.write(chunk);
      controller.close();
    },
    cancel() {},
    type: "direct",
  });
  const buffer = await new Response(stream).arrayBuffer();
  expect(new TextDecoder().decode(new Uint8Array(buffer))).toBe("abdefgh");
});

it("new Response(stream).bytes() (bytes)", async () => {
  var queue = [Buffer.from("abdefgh")];
  var stream = new ReadableStream({
    pull(controller) {
      var chunk = queue.shift();
      if (chunk) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
    cancel() {},
    type: "bytes",
  });
  const buffer = await new Response(stream).bytes();
  expect(new TextDecoder().decode(buffer)).toBe("abdefgh");
});

it("new Response(stream).bytes() (default)", async () => {
  var queue = [Buffer.from("abdefgh")];
  var stream = new ReadableStream({
    pull(controller) {
      var chunk = queue.shift();
      if (chunk) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
    cancel() {},
  });
  const buffer = await new Response(stream).bytes();
  expect(new TextDecoder().decode(buffer)).toBe("abdefgh");
});

it("new Response(stream).bytes() (direct)", async () => {
  var queue = [Buffer.from("abdefgh")];
  var stream = new ReadableStream({
    pull(controller) {
      var chunk = queue.shift();
      controller.write(chunk);
      controller.close();
    },
    cancel() {},
    type: "direct",
  });
  const buffer = await new Response(stream).bytes();
  expect(new TextDecoder().decode(buffer)).toBe("abdefgh");
});

it("new Response(stream).text() (bytes)", async () => {
  var queue = [Buffer.from("abdefgh")];
  var stream = new ReadableStream({
    pull(controller) {
      var chunk = queue.shift();
      if (chunk) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
    cancel() {},
    type: "bytes",
  });
  const text = await new Response(stream).text();
  expect(text).toBe("abdefgh");
});

it("new Response(stream).text() (default)", async () => {
  var queue = [Buffer.from("abdefgh")];
  var stream = new ReadableStream({
    pull(controller) {
      var chunk = queue.shift();
      if (chunk) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
    cancel() {},
  });
  const text = await new Response(stream).text();
  expect(text).toBe("abdefgh");
});

it("new Response(stream).text() (direct)", async () => {
  var queue = [Buffer.from("abdefgh")];
  var stream = new ReadableStream({
    pull(controller) {
      var chunk = queue.shift();
      controller.write(chunk);
      controller.close();
    },
    cancel() {},
    type: "direct",
  });
  const text = await new Response(stream).text();
  expect(text).toBe("abdefgh");
});

it("new Response(stream).json() (bytes)", async () => {
  var queue = [Buffer.from(JSON.stringify({ hello: true }))];
  var stream = new ReadableStream({
    pull(controller) {
      var chunk = queue.shift();
      if (chunk) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
    cancel() {},
    type: "bytes",
  });
  const json = await new Response(stream).json();
  expect(json.hello).toBe(true);
});

it("new Response(stream).json() (default)", async () => {
  var queue = [Buffer.from(JSON.stringify({ hello: true }))];
  var stream = new ReadableStream({
    pull(controller) {
      var chunk = queue.shift();
      if (chunk) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
    cancel() {},
  });
  const json = await new Response(stream).json();
  expect(json.hello).toBe(true);
});

it("new Response(stream).json() (direct)", async () => {
  var queue = [Buffer.from(JSON.stringify({ hello: true }))];
  var stream = new ReadableStream({
    pull(controller) {
      var chunk = queue.shift();
      controller.write(chunk);
      controller.close();
    },
    cancel() {},
    type: "direct",
  });
  const json = await new Response(stream).json();
  expect(json.hello).toBe(true);
});

it("new Response(stream).blob() (bytes)", async () => {
  var queue = [Buffer.from(JSON.stringify({ hello: true }))];
  var stream = new ReadableStream({
    pull(controller) {
      var chunk = queue.shift();
      if (chunk) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
    cancel() {},
    type: "bytes",
  });
  const response = new Response(stream);
  const blob = await response.blob();
  expect(await blob.text()).toBe('{"hello":true}');
});

it("new Response(stream).blob() (default)", async () => {
  var queue = [Buffer.from(JSON.stringify({ hello: true }))];
  var stream = new ReadableStream({
    pull(controller) {
      var chunk = queue.shift();
      if (chunk) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
    cancel() {},
  });
  const response = new Response(stream);
  const blob = await response.blob();
  expect(await blob.text()).toBe('{"hello":true}');
});

it("new Response(stream).blob() (direct)", async () => {
  var queue = [Buffer.from(JSON.stringify({ hello: true }))];
  var stream = new ReadableStream({
    pull(controller) {
      var chunk = queue.shift();
      controller.write(chunk);
      controller.close();
    },
    cancel() {},
    type: "direct",
  });
  const response = new Response(stream);
  const blob = await response.blob();
  expect(await blob.text()).toBe('{"hello":true}');
});

it("Blob.stream(undefined) does not crash", () => {
  var blob = new Blob(["abdefgh"]);
  var stream = blob.stream(undefined);
  expect(stream instanceof ReadableStream).toBeTrue();
  stream = blob.stream(null);
  expect(stream instanceof ReadableStream).toBeTrue();
});

it("Blob.stream() -> new Response(stream).text()", async () => {
  var blob = new Blob(["abdefgh"]);
  var stream = blob.stream();
  const text = await new Response(stream).text();
  expect(text).toBe("abdefgh");
});

it("Bun.file().stream() of a small file does not double-close the controller", async () => {
  // When the first pull returns data + EOF synchronously, both the native onClose
  // callback and the pull-result handler enqueue callClose for the same controller.
  // The second callClose must be a no-op rather than throwing ERR_INVALID_STATE
  // through reportError → process.on("uncaughtException").
  using dir = tempDir("file-stream-double-close", { "x.txt": "x" });
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `process.on("uncaughtException", e => {
         console.log(e?.code ?? e?.name, e?.message);
         process.exitCode = 1;
       });
       Bun.file(process.argv[1]).stream().getReader().releaseLock();`,
      join(String(dir), "x.txt"),
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});

it("Bun.file().stream() read text from large file", async () => {
  // Guard against reading the same repeating chunks
  // There were bugs previously where the stream would
  // repeat the same chunk over and over again
  var sink = new ArrayBufferSink();
  sink.start({ highWaterMark: 1024 * 1024 * 10 });
  var written = 0;
  var i = 0;
  while (written < 1024 * 1024 * 10) {
    written += sink.write(Bun.SHA1.hash((i++).toString(10), "hex"));
  }
  const hugely = Buffer.from(sink.end()).toString();
  const tmpfile = join(realpathSync(tmpdirSync()), "bun-streams-test.txt");
  writeFileSync(tmpfile, hugely);
  try {
    const chunks = [];
    for await (const chunk of Bun.file(tmpfile).stream()) {
      chunks.push(chunk);
    }
    const output = Buffer.concat(chunks).toString();
    expect(output).toHaveLength(hugely.length);
    expect(output).toBe(hugely);
  } finally {
    unlinkSync(tmpfile);
  }
});

it("fs.createReadStream(filename) should be able to break inside async loop", async () => {
  for (let i = 0; i < 10; i++) {
    const fileStream = createReadStream(join(import.meta.dir, "..", "fetch", "fixture.png"));
    for await (const chunk of fileStream) {
      expect(chunk).toBeDefined();
      break;
    }
    expect(true).toBe(true);
  }
});

it("pipeTo doesn't cause unhandled rejections on readable errors", async () => {
  // https://github.com/WebKit/WebKit/blob/3a75b5d2de94aa396a99b454ac47f3be9e0dc726/LayoutTests/streams/pipeTo-unhandled-promise.html
  let unhandledRejectionCaught = false;

  const catchUnhandledRejection = () => {
    unhandledRejectionCaught = true;
  };
  process.on("unhandledRejection", catchUnhandledRejection);

  const writable = new WritableStream();
  const readable = new ReadableStream({ start: c => c.error("error") });
  readable.pipeTo(writable).catch(() => {});

  await Bun.sleep(15);

  process.off("unhandledRejection", catchUnhandledRejection);

  expect(unhandledRejectionCaught).toBe(false);
});

it("pipeThrough doesn't cause unhandled rejections on readable errors", async () => {
  let unhandledRejectionCaught = false;

  const catchUnhandledRejection = () => {
    unhandledRejectionCaught = true;
  };
  process.on("unhandledRejection", catchUnhandledRejection);

  const readable = new ReadableStream({ start: c => c.error("error") });
  const ts = new TransformStream();
  readable.pipeThrough(ts);

  await Bun.sleep(15);

  process.off("unhandledRejection", catchUnhandledRejection);

  expect(unhandledRejectionCaught).toBe(false);
});

it("Handles exception during ReadableStream creation from Response.body", async () => {
  const dir = tmpdirSync();
  const testFile = join(dir, "test-fixture.js");
  writeFileSync(
    testFile,
    `
function recursiveFunction() {
  const url = new URL("https://example.com/path");
  const response = new Response("test");

  // Access Response.body which creates a ReadableStream
  const body = response.body;

  // Set up infinite recursion via URL.pathname setter
  url[Symbol.toPrimitive] = recursiveFunction;
  try {
    url.pathname = url; // Triggers toString() → toPrimitive → recursiveFunction()
  } catch (e) {
    // Stack overflow expected
    if (e instanceof RangeError || e.message?.includes("stack")) {
      process.exit(0);
    }
    throw e;
  }
}
recursiveFunction();
`,
  );

  await using proc = Bun.spawn({
    cmd: [bunExe(), testFile],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
});

it("handles exceptions during empty stream creation", () => {
  expect(() => {
    function foo() {
      try {
        foo();
      } catch (e) {}
      const v8 = new Blob();
      v8.stream();
    }
    foo();
    throw new Error("not stack overflow");
  }).toThrow("not stack overflow");
});

it("auto-allocated byte stream chunks are zero-filled before being exposed to the source", async () => {
  const CHUNK_SIZE = 4096;

  // Populate the allocator's free lists with same-sized blocks full of a
  // non-zero pattern so a recycled, non-zeroed allocation would be visible.
  for (let i = 0; i < 256; i++) {
    new Uint8Array(CHUNK_SIZE).fill(0xaa);
  }
  Bun.gc(true);

  let nonZeroIndex = -1;
  const stream = new ReadableStream({
    type: "bytes",
    autoAllocateChunkSize: CHUNK_SIZE,
    pull(controller) {
      const request = controller.byobRequest;
      if (!request) return;
      const view = request.view;
      // Per the Streams spec the auto-allocated chunk is `new
      // ArrayBuffer(autoAllocateChunkSize)`, which is zero-filled. A source
      // that under-writes and over-reports must hand the reader zeros, not
      // recycled heap contents.
      for (let i = 0; i < view.byteLength; i++) {
        if (view[i] !== 0) {
          nonZeroIndex = i;
          break;
        }
      }
      view[0] = 1;
      request.respond(view.byteLength);
    },
  });

  const reader = stream.getReader();
  const { done, value } = await reader.read();
  expect(done).toBe(false);
  expect(nonZeroIndex).toBe(-1);
  expect(value.byteLength).toBe(CHUNK_SIZE);
  // The byte the source actually wrote survives...
  expect(value[0]).toBe(1);
  // ...and every byte it did not write is zero.
  expect(value.subarray(1).every(b => b === 0)).toBe(true);
  reader.cancel();
});

it("ReadableStream BYOB read pending at close() + respond(0) returns a zero-length view of the caller's buffer", async () => {
  // Spec EOF pattern for byte sources: controller.close() leaves the pending
  // BYOB read unsettled; byobRequest.respond(0) then resolves it with a
  // zero-length view over the caller's (transferred) buffer, returning the
  // buffer for reuse. Only cancel() resolves pending reads with undefined.
  let ctrl;
  const rs = new ReadableStream({
    type: "bytes",
    start(c) {
      ctrl = c;
    },
  });
  const reader = rs.getReader({ mode: "byob" });
  const pending = reader.read(new Uint8Array(new ArrayBuffer(16)));
  ctrl.close();
  ctrl.byobRequest.respond(0);
  const { value, done } = await pending;
  expect(done).toBe(true);
  expect(value).toBeInstanceOf(Uint8Array);
  expect(value.byteLength).toBe(0);
  // The caller's 16-byte buffer comes back (transferred) for reuse.
  expect(value.buffer.byteLength).toBe(16);
  await reader.closed;
});

it("ReadableStream BYOB read pending at cancel() resolves with undefined", async () => {
  // Spec (ReadableStreamCancel step 6): pending readIntoRequests get their
  // close steps with undefined - { value: undefined, done: true }.
  const rs = new ReadableStream({
    type: "bytes",
    start() {},
  });
  const reader = rs.getReader({ mode: "byob" });
  const pending = reader.read(new Uint8Array(16));
  await reader.cancel("bye");
  const { value, done } = await pending;
  expect(done).toBe(true);
  expect(value).toBeUndefined();
  await reader.closed;
});

describe("pipeTo from a byte source", () => {
  it("delivers the enqueued chunks and resolves", async () => {
    const rs = new ReadableStream({
      type: "bytes",
      start(c) {
        c.enqueue(new Uint8Array([1, 2, 3]));
        c.enqueue(new Uint8Array([4, 5]));
        c.close();
      },
    });
    const chunks = [];
    await rs.pipeTo(
      new WritableStream({
        write(chunk) {
          chunks.push(Array.from(chunk));
        },
      }),
    );
    expect(chunks).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
  });

  it("pipeThrough an identity TransformStream forwards the chunks", async () => {
    const rs = new ReadableStream({
      type: "bytes",
      start(c) {
        c.enqueue(new Uint8Array([1, 2, 3]));
        c.enqueue(new Uint8Array([4, 5]));
        c.close();
      },
    });
    const reader = rs.pipeThrough(new TransformStream()).getReader();
    const chunks = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(Array.from(value));
    }
    expect(chunks).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
  });

  it("a pull-based byte source responding via byobRequest delivers its bytes", async () => {
    let written = 0;
    const rs = new ReadableStream({
      type: "bytes",
      autoAllocateChunkSize: 4,
      pull(controller) {
        if (written >= 8) {
          controller.close();
          return;
        }
        const view = controller.byobRequest.view;
        // respond() detaches `view`'s buffer, so its byteLength reads 0 afterwards.
        const byteLength = view.byteLength;
        for (let i = 0; i < byteLength; i++) {
          view[i] = written + i;
        }
        controller.byobRequest?.respond(byteLength);
        written += byteLength;
      },
    });
    const received = [];
    await rs.pipeTo(
      new WritableStream({
        write(chunk) {
          received.push(...chunk);
        },
      }),
    );
    expect(received).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("preventClose: false closes the destination when the byte source closes", async () => {
    const rs = new ReadableStream({
      type: "bytes",
      start(c) {
        c.enqueue(new Uint8Array([9]));
        c.close();
      },
    });
    const chunks = [];
    let closed = false;
    await rs.pipeTo(
      new WritableStream({
        write(chunk) {
          chunks.push(Array.from(chunk));
        },
        close() {
          closed = true;
        },
      }),
      { preventClose: false },
    );
    expect(chunks).toEqual([[9]]);
    expect(closed).toBe(true);
  });
});

// Async stack frames on stream errors created inside native reactions (no JS frames of
// their own): the `for await` and `pipeTo` awaiters must get the awaiting function's frames.
function serveStalledBody() {
  // One flushed chunk, then the body stalls until the test releases it (a pull left
  // parked at process exit would leave the aborted request's native sink alive).
  const { promise: parked, resolve: unpark } = Promise.withResolvers();
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    async fetch() {
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(c) {
            c.write("part1");
            await c.flush();
            await parked;
            c.end();
          },
        }),
        { headers: { "Content-Length": "100000" } },
      );
    },
  });
  return { server, unpark };
}

test("for await over a stream that errors natively includes async stack frames", async () => {
  const { server, unpark } = serveStalledBody();
  async function level2() {
    const res = await fetch(server.url);
    const iterator = res.body[Symbol.asyncIterator]();
    await iterator.next();
    // The connection dies while the loop below is awaiting the next chunk, so the
    // error is created from a native callback with no JavaScript frames of its own.
    server.stop(true);
    while (!(await iterator.next()).done) {}
  }
  async function level1() {
    await level2();
  }
  let caught;
  try {
    await level1();
  } catch (e) {
    caught = e;
  } finally {
    unpark();
    await Bun.sleep(0);
    server.stop(true);
  }
  expect(caught).toBeDefined();
  expect(caught.stack).toContain("at async level2");
  expect(caught.stack).toContain("at async level1");
});

test("pipeTo from a stream that errors natively includes async stack frames", async () => {
  const { server, unpark } = serveStalledBody();
  async function level2() {
    const res = await fetch(server.url);
    await res.body.pipeTo(
      new WritableStream({
        write() {
          server.stop(true);
        },
      }),
    );
  }
  async function level1() {
    await level2();
  }
  let caught;
  try {
    await level1();
  } catch (e) {
    caught = e;
  } finally {
    unpark();
    await Bun.sleep(0);
    server.stop(true);
  }
  expect(caught).toBeDefined();
  expect(caught.stack).toContain("at async level2");
  expect(caught.stack).toContain("at async level1");
});

// https://github.com/oven-sh/bun/issues/6860
describe("Bun.readableStreamTo* on an already used stream", () => {
  const consumers = [
    "readableStreamToText",
    "readableStreamToArrayBuffer",
    "readableStreamToBytes",
    "readableStreamToJSON",
    "readableStreamToArray",
    "readableStreamToBlob",
  ];
  const makeStream = () =>
    new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('"hello"'));
        c.close();
      },
    });

  for (const consumer of consumers) {
    test(`${consumer} rejects after the stream was consumed by a Bun helper`, async () => {
      const stream = makeStream();
      await Bun.readableStreamToText(stream);
      await expect(Bun[consumer](stream)).rejects.toThrow("ReadableStream has already been used");
    });
  }

  test("rejects after the stream was consumed through a reader", async () => {
    const stream = makeStream();
    const reader = stream.getReader();
    while (!(await reader.read()).done) {}
    reader.releaseLock();
    await expect(Bun.readableStreamToText(stream)).rejects.toThrow("ReadableStream has already been used");
  });

  test("rejects after the stream was cancelled", async () => {
    const stream = makeStream();
    await stream.cancel();
    await expect(Bun.readableStreamToArrayBuffer(stream)).rejects.toThrow("ReadableStream has already been used");
  });

  test("still reports a locked stream as locked", async () => {
    const stream = makeStream();
    const reader = stream.getReader();
    await expect(Bun.readableStreamToText(stream)).rejects.toThrow("ReadableStream is locked");
    reader.releaseLock();
  });

  test("new Response(stream) after consumption still throws", async () => {
    const stream = makeStream();
    await Bun.readableStreamToText(stream);
    expect(() => new Response(stream).arrayBuffer()).toThrow();
  });
});

// Text assembly past the string limit must throw a catchable out-of-memory error, never
// abort the process. The synthetic allocation limit makes the path testable without
// multi-gigabyte inputs; a subprocess isolates the lowered limit.
describe("text consumers reject strings over the string allocation limit", () => {
  const runInSubprocess = async source => {
    const script = `
      import { setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
      setSyntheticAllocationLimitForTesting(32 * 1024 * 1024);
      const big = "x".repeat(8 * 1024 * 1024);
      let caught;
      try {
        ${source}
      } catch (e) {
        caught = e;
      }
      if (!caught) throw new Error("expected an out-of-memory error");
      console.log(caught.message);
    `;
    const proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };

  test("Bun.readableStreamToText", async () => {
    const { stdout, stderr, exitCode } = await runInSubprocess(`
      const stream = new ReadableStream({
        start(c) {
          for (let i = 0; i < 6; i++) c.enqueue(big);
          c.close();
        },
      });
      await Bun.readableStreamToText(stream);
    `);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "Out of memory", exitCode: 0 });
  });

  test("direct stream text sink", async () => {
    const { stdout, stderr, exitCode } = await runInSubprocess(`
      const stream = new ReadableStream({
        type: "direct",
        pull(c) {
          for (let i = 0; i < 6; i++) c.write(big);
          c.end();
        },
      });
      await Bun.readableStreamToText(stream);
    `);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "Out of memory", exitCode: 0 });
  });

  test("mixed string and binary chunks", async () => {
    const { stdout, stderr, exitCode } = await runInSubprocess(`
      const stream = new ReadableStream({
        start(c) {
          for (let i = 0; i < 6; i++) {
            c.enqueue(big);
            c.enqueue(new Uint8Array(1));
          }
          c.close();
        },
      });
      await Bun.readableStreamToText(stream);
    `);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "Out of memory", exitCode: 0 });
  });
});

// A source pull() that runs inside the pipe's in-place drain and synchronously errors the
// destination and aborts the pipe's signal must not touch the released writer afterwards.
// https://github.com/oven-sh/bun/pull/33193
it("pipeTo survives a pull() that errors the destination and aborts mid-drain", async () => {
  const ac = new AbortController();
  let sinkController;
  let pulls = 0;
  const readable = new ReadableStream({
    start(c) {
      c.enqueue("a");
      c.enqueue("b");
      c.enqueue("c");
    },
    pull(c) {
      pulls++;
      if (pulls === 1) {
        sinkController.error(new Error("dest dead"));
        ac.abort(new Error("stop"));
        return;
      }
      c.enqueue("d");
    },
  });
  const writable = new WritableStream(
    {
      start(c) {
        sinkController = c;
      },
      write() {},
    },
    new CountQueuingStrategy({ highWaterMark: 16 }),
  );
  expect(
    await readable.pipeTo(writable, { signal: ac.signal, preventAbort: true, preventCancel: true }).then(
      () => "fulfilled",
      e => `rejected:${e.constructor.name}`,
    ),
  ).toBe("rejected:Error");
});

// For a pull-driven source, readMany must return chunks the pull pipeline enqueued while the
// previous wake settled (the drain runs after the controller's follow-up pull, not before).
it("readMany batches the pipelined pull's chunk with the delivered one", async () => {
  let pulls = 0;
  const rs = new ReadableStream({
    pull(c) {
      pulls++;
      if (pulls <= 6) c.enqueue("c" + pulls);
      else c.close();
    },
  });
  const reader = rs.getReader();
  const wakes = [];
  while (true) {
    const r = await reader.readMany();
    if (r.done) break;
    wakes.push(r.value.join(","));
  }
  expect(wakes).toEqual(["c1", "c2", "c3,c4", "c5,c6"]);
});

// A chunk the pipe has already dequeued when a shutdown begins must still be written to the
// destination (the shutdown waits for pending writes); it must not vanish.
// https://github.com/oven-sh/bun/pull/33329
it("pipeTo writes an already-dequeued chunk when the signal aborts mid-drain", async () => {
  const ac = new AbortController();
  let pulls = 0;
  const written = [];
  const rs = new ReadableStream({
    start(c) {
      c.enqueue("a");
      c.enqueue("b");
      c.enqueue("c");
    },
    pull() {
      if (++pulls === 1) ac.abort(new Error("stop"));
    },
  });
  const ws = new WritableStream(
    {
      write(chunk) {
        written.push(chunk);
      },
    },
    new CountQueuingStrategy({ highWaterMark: 16 }),
  );
  const outcome = await rs.pipeTo(ws, { signal: ac.signal }).then(
    () => "fulfilled",
    e => "rejected:" + e.message,
  );
  // Node 26 agrees byte-for-byte: every dequeued chunk is written before the abort finishes.
  expect({ outcome, written }).toEqual({ outcome: "rejected:stop", written: ["a", "b", "c"] });
});

// When a Bun native sink (spawn stdin, Bun.serve response body) consumes a TransformStream's
// readable and then tears it down on abort, the transform controller API must not segfault.
it("TransformStreamDefaultController survives after a native sink tears down its readable", async () => {
  const script = `
    process.on("unhandledRejection", () => {});
    const actions = {
      desiredSize: c => c.desiredSize,
      enqueue: c => c.enqueue(new Uint8Array([1])),
      terminate: c => c.terminate(),
      error: c => c.error(new Error("bad payload")),
    };
    for (const [name, fn] of Object.entries(actions)) {
      let ctrl;
      const ts = new TransformStream({ start(c) { ctrl = c; } });
      const child = Bun.spawn({
        cmd: [process.execPath, "-e", "setInterval(()=>{},1e5)"],
        stdin: ts.readable, stdout: "ignore", stderr: "ignore",
      });
      child.kill();
      await child.exited;
      // The stdin sink's finally step releases its reader and clears the readable's
      // controller slot; unlocked is the observable post-teardown condition.
      while (ts.readable.locked) await new Promise(r => setImmediate(r));
      let outcome;
      try { outcome = "returned:" + fn(ctrl); } catch (e) { outcome = "threw:" + e?.constructor?.name; }
      console.log(name, outcome);
    }
    console.log("SURVIVED");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  void stderr;
  expect({ stdout: stdout.trim().split("\n"), exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: [
      "desiredSize returned:null",
      "enqueue threw:TypeError",
      "terminate returned:undefined",
      "error returned:undefined",
      "SURVIVED",
    ],
    exitCode: 0,
    signalCode: null,
  });
});

// https://github.com/oven-sh/bun/pull/33193 — constructing any stream class with a newTarget
// from a non-Zig realm (a node:vm context) must not downcast that realm's global object.
test("streams constructors survive a foreign-realm (node:vm) newTarget", async () => {
  const script = `
    const vm = require("node:vm");
    const context = vm.createContext({});
    const foreign = vm.runInContext("(function F(){})", context);
    const byteStream = () => new ReadableStream({ type: "bytes" });
    const readerCtor = Object.getPrototypeOf(new ReadableStream().getReader()).constructor;
    const byobCtor = Object.getPrototypeOf(byteStream().getReader({ mode: "byob" })).constructor;
    const writerCtor = Object.getPrototypeOf(new WritableStream().getWriter()).constructor;
    const cases = [
      [CountQueuingStrategy, [{ highWaterMark: 1 }]],
      [ByteLengthQueuingStrategy, [{ highWaterMark: 1 }]],
      [ReadableStream, []],
      [WritableStream, []],
      [TransformStream, []],
      [TextEncoderStream, []],
      [TextDecoderStream, []],
      [readerCtor, [new ReadableStream()]],
      [byobCtor, [byteStream()]],
      [writerCtor, [new WritableStream()]],
    ];
    for (const [C, args] of cases) {
      const constructed = Reflect.construct(C, args, foreign);
      if (Object.getPrototypeOf(constructed) !== foreign.prototype) throw new Error(C.name + ": wrong prototype");
    }
    // A non-object foreign prototype falls back to the constructor realm's structure.
    const bare = vm.runInContext("(function G(){})", context);
    bare.prototype = 5;
    const fallback = Reflect.construct(CountQueuingStrategy, [{ highWaterMark: 2 }], bare);
    if (!(fallback instanceof CountQueuingStrategy)) throw new Error("fallback: wrong prototype");
    if (fallback.highWaterMark !== 2) throw new Error("fallback: object broken");
    console.log("OK");
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "OK",
    exitCode: 0,
    signalCode: null,
  });
});

// https://github.com/oven-sh/bun/pull/33193 — TransferArrayBuffer must produce a
// fixed-length buffer, or user resize() invalidates the byte controller's recorded sizes.
test("byte streams transfer resizable ArrayBuffers to fixed-length", async () => {
  const script = `
    // BYOB read: the pull-into descriptor's transferred buffer must be fixed-length.
    {
      let resizeError = null;
      const rs = new ReadableStream({
        type: "bytes",
        pull(c) {
          const view = c.byobRequest.view;
          if (view.buffer.resizable) throw new Error("byobRequest view buffer is resizable");
          try { view.buffer.resize(0); } catch (e) { resizeError = e; }
          c.byobRequest.respond(view.byteLength);
        },
      });
      const rab = new ArrayBuffer(8, { maxByteLength: 64 });
      const { value } = await rs.getReader({ mode: "byob" }).read(new Uint8Array(rab));
      if (!(resizeError instanceof TypeError)) throw new Error("resize() unexpectedly succeeded");
      if (value.byteLength !== 8) throw new Error("wrong read length: " + value.byteLength);
      if (rab.byteLength !== 0) throw new Error("source buffer not detached");
    }
    // enqueue: a resizable-backed chunk is delivered over a fixed-length buffer.
    {
      const rab = new ArrayBuffer(8, { maxByteLength: 64 });
      new Uint8Array(rab).set([1, 2, 3, 4, 5, 6, 7, 8]);
      const rs = new ReadableStream({ type: "bytes", start(c) { c.enqueue(new Uint8Array(rab)); } });
      const { value } = await rs.getReader().read();
      if (value.buffer.resizable) throw new Error("delivered chunk buffer is resizable");
      if (String(new Uint8Array(value.buffer)) !== "1,2,3,4,5,6,7,8") throw new Error("wrong bytes");
      if (rab.byteLength !== 0) throw new Error("chunk buffer not detached");
    }
    // resize-then-enqueue inside pull must reject the read, not abort the process.
    {
      const rs = new ReadableStream({
        type: "bytes",
        pull(c) {
          c.byobRequest.view.buffer.resize(0);
          c.enqueue(new Uint8Array(10));
        },
      });
      let rejection = null;
      try {
        await rs.getReader({ mode: "byob" }).read(new Uint8Array(new ArrayBuffer(64, { maxByteLength: 1024 })));
      } catch (e) {
        rejection = e;
      }
      if (!(rejection instanceof TypeError)) throw new Error("expected read() to reject with TypeError");
    }
    console.log("OK");
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "OK",
    exitCode: 0,
    signalCode: null,
  });
});

// https://github.com/oven-sh/bun/pull/33193 — the bulk drain must reset the queue BEFORE
// the user pull(): reentrant enqueues must survive and a reentrant close() must take effect.
describe("bulk drain runs the user pull() against the already-reset queue", () => {
  const makeSource = enqueue => {
    let pulls = 0;
    return {
      start(c) {
        c.enqueue(enqueue("A"));
      },
      pull(c) {
        if (++pulls >= 2) {
          c.enqueue(enqueue("B"));
          c.close();
        }
      },
    };
  };

  test("text() keeps a chunk enqueued during the drain and settles on close()", async () => {
    const rs = new ReadableStream(
      makeSource(s => s),
      { highWaterMark: 2 },
    );
    await Bun.sleep(0); // let start + the initial pull settle so pull #2 fires inside the drain
    expect(await rs.text()).toBe("AB");
  });

  test("text() on a byte stream keeps a chunk enqueued during the drain", async () => {
    const encoder = new TextEncoder();
    const rs = new ReadableStream({ type: "bytes", ...makeSource(s => encoder.encode(s)) }, { highWaterMark: 2 });
    await Bun.sleep(0);
    expect(await rs.text()).toBe("AB");
  });

  test("readMany() leaves the reentrantly-enqueued chunk readable and the stream closable", async () => {
    const rs = new ReadableStream(
      makeSource(s => s),
      { highWaterMark: 2 },
    );
    await Bun.sleep(0);
    const reader = rs.getReader();
    const first = await reader.readMany();
    expect(first).toEqual({ value: ["A"], size: 1, done: false });
    expect(await reader.read()).toEqual({ value: "B", done: false });
    expect(await reader.read()).toEqual({ value: undefined, done: true });
    await reader.closed;
  });
});

// https://github.com/oven-sh/bun/pull/33193 — a reentrant next()/return() from a
// synchronous pull() must chain onto the in-flight iteration instead of racing it.
describe("ReadableStream async iterator reentrancy", () => {
  test("return() from inside a synchronous pull() does not crash", async () => {
    const script = `
      let it, phase = 0;
      const rs = new ReadableStream(
        {
          pull(c) {
            if (++phase === 2) {
              it.return("bye");
              return new Promise(() => {});
            }
          },
        },
        { highWaterMark: 1 },
      );
      it = rs.values();
      await null; await null; await null; // let start + the initial pull settle
      it.next(); // fires pull #2 synchronously, which reenters via it.return()
      await Bun.sleep(10);
      console.log("SURVIVED");
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "SURVIVED",
      exitCode: 0,
      signalCode: null,
    });
  });

  test("return() from inside a dequeueing pull() settles after the ongoing next()", async () => {
    let it,
      phase = 0,
      returnPromise;
    const rs = new ReadableStream(
      {
        pull(c) {
          if (++phase === 2) {
            returnPromise = it.return("bye");
            c.enqueue("x");
          } else {
            c.enqueue("first");
          }
        },
      },
      { highWaterMark: 1 },
    );
    it = rs.values();
    const r1 = await it.next(); // pull #2 fires inside this next()'s dequeue
    expect(r1).toEqual({ value: "first", done: false });
    expect(await returnPromise).toEqual({ value: "bye", done: true });
    expect(await it.next()).toEqual({ value: undefined, done: true });
  });

  test("queued next() calls resolve in call order as chunks arrive", async () => {
    let controller;
    const rs = new ReadableStream({
      start(c) {
        controller = c;
      },
    });
    const it = rs.values();
    const p1 = it.next();
    const p2 = it.next();
    const p3 = it.next();
    controller.enqueue("a");
    controller.enqueue("b");
    controller.enqueue("c");
    const p4 = it.next(); // must chain after p3, not after whichever promise settled last
    controller.enqueue("d");
    controller.close();
    expect(await Promise.all([p1, p2, p3, p4])).toEqual([
      { value: "a", done: false },
      { value: "b", done: false },
      { value: "c", done: false },
      { value: "d", done: false },
    ]);
    expect(await it.next()).toEqual({ value: undefined, done: true });
  });
});

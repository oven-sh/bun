import {
  file,
  readableStreamToArrayBuffer,
  readableStreamToBytes,
  readableStreamToArray,
  readableStreamToText,
  ArrayBufferSink,
} from "bun";
import { expect, it, describe, test } from "bun:test";
import { mkfifo } from "mkfifo";
import { realpathSync, unlinkSync, writeFileSync, createReadStream } from "node:fs";
import { join } from "node:path";
import { tmpdirSync } from "harness";

const isWindows = process.platform === "win32";

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

it.skipIf(isWindows)("Bun.file() read text from pipe", async () => {
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

it("Blob.stream() -> new Response(stream).text()", async () => {
  var blob = new Blob(["abdefgh"]);
  var stream = blob.stream();
  const text = await new Response(stream).text();
  expect(text).toBe("abdefgh");
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

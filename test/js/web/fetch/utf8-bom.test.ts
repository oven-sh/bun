import { describe, expect, it, test } from "bun:test";
import { Readable } from "node:stream";
import consumers from "node:stream/consumers";

describe("UTF-8 BOM should be ignored", () => {
  test("handles empty strings", async () => {
    const blob = new Response(new Blob([Buffer.from([0xef, 0xbb, 0xbf])]));

    expect(await blob.text()).toHaveLength(0);
    expect(async () => await blob.json()).toThrow();
  });

  test("handles UTF8 BOM + emoji", async () => {
    const blob = new Response(new Blob([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("🌎")]));

    expect(await blob.text()).toHaveLength(2);
    expect(async () => await blob.json()).toThrow();
  });

  describe("Blob", () => {
    describe("with emoji", () => {
      it("in text()", async () => {
        const blob = new Blob(["\uFEFFHello, World! 🌎"], { type: "text/plain" });
        expect(await blob.text()).toBe("Hello, World! 🌎");
      });

      it("in json()", async () => {
        const blob = new Blob(['\uFEFF{"hello":"World 🌎"}'], { type: "application/json" });
        expect(await blob.json()).toStrictEqual({ "hello": "World 🌎" } as any);
      });

      it("in formData()", async () => {
        const blob = new Blob(["\uFEFFhello=world 🌎"], { type: "application/x-www-form-urlencoded" });
        const formData = await blob.formData();
        expect(formData.get("hello")).toBe("world 🌎");
      });
    });

    it("in text()", async () => {
      const blob = new Blob(["\uFEFFHello, World!"], { type: "text/plain" });
      expect(await blob.text()).toBe("Hello, World!");
    });

    it("in json()", async () => {
      const blob = new Blob(['\uFEFF{"hello":"World"}'], { type: "application/json" });
      expect(await blob.json()).toEqual({ "hello": "World" } as any);
    });

    it("in formData()", async () => {
      const blob = new Blob(["\uFEFFhello=world"], { type: "application/x-www-form-urlencoded" });
      const formData = await blob.formData();
      expect(formData.get("hello")).toBe("world");
    });
  });

  describe("Response", () => {
    it("in text()", async () => {
      const response = new Response(Buffer.from("\uFEFFHello, World!"), { headers: { "content-type": "text/plain" } });
      expect(await response.text()).toBe("Hello, World!");
    });

    it("in json()", async () => {
      const response = new Response(Buffer.from('\uFEFF{"hello":"World"}'), {
        headers: { "content-type": "application/json" },
      });
      expect(await response.json()).toEqual({ "hello": "World" } as any);
    });

    it("in formData()", async () => {
      const response = new Response(Buffer.from("\uFEFFhello=world"), {
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      const formData = await response.formData();
      expect(formData.get("hello")).toBe("world");
    });
  });

  describe("Request", () => {
    it("in text()", async () => {
      const request = new Request("https://example.com", {
        body: Buffer.from("\uFEFFHello, World!"),
        headers: { "content-type": "text/plain" },
      });
      expect(await request.text()).toBe("Hello, World!");
    });

    it("in json()", async () => {
      const request = new Request("https://example.com", {
        body: Buffer.from('\uFEFF{"hello":"World"}'),
        headers: { "content-type": "application/json" },
      });
      expect(await request.json()).toEqual({ "hello": "World" } as any);
    });

    it("in formData()", async () => {
      const request = new Request("https://example.com", {
        body: Buffer.from("\uFEFFhello=world"),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      const formData = await request.formData();
      expect(formData.get("hello")).toBe("world");
    });
  });

  describe("readable stream", () => {
    it("in Bun.readableStreamToText()", async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from("\uFEFFHello, World!"));
          controller.close();
        },
      });
      expect(await Bun.readableStreamToText(stream)).toBe("Hello, World!");
    });

    it("in Bun.readableStreamToJSON()", async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from('\uFEFF{"hello":"World"}'));
          controller.close();
        },
      });
      expect(await Bun.readableStreamToJSON(stream)).toEqual({ "hello": "World" } as any);
    });

    it("in ReadableStream.prototype.text()", async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from("\uFEFFHello, World!"));
          controller.close();
        },
      });
      expect(await stream.text()).toBe("Hello, World!");
    });

    it("in ReadableStream.prototype.json()", async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from('\uFEFF{"hello":"World"}'));
          controller.close();
        },
      });
      expect(await stream.json()).toEqual({ "hello": "World" });
    });

    it("in Bun.readableStreamToFormData()", async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from("\uFEFFhello=world"));
          controller.close();
        },
      });
      const formData = await Bun.readableStreamToFormData(stream);
      expect(formData.get("hello")).toBe("world");
    });

    it("in Bun.readableStreamToBlob()", async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from("\uFEFFHello, World!"));
          controller.close();
        },
      });
      const blob = await Bun.readableStreamToBlob(stream);
      expect(await blob.text()).toBe("Hello, World!");
    });

    it("in ReadableStream.prototype.blob()", async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from("\uFEFFHello, World!"));
          controller.close();
        },
      });
      const blob = await stream.blob();
      expect(await blob.text()).toBe("Hello, World!");
    });
  });
});

// text() of a string body or a stream body is one UTF-8 decode of its bytes: it drops exactly one
// leading EF BB BF, and json() parses that text. A string stands for its UTF-8.
// (A Blob body that starts with FF FE follows another rule; see blob.test.ts.)
describe("text() and json() drop one leading UTF-8 BOM for string and stream bodies", () => {
  type Chunk = string | Uint8Array;
  const url = "http://localhost/";
  const MARK = [0xef, 0xbb, 0xbf];
  const utf8 = new TextEncoder();
  const bytes = (...parts: (string | number[])[]) =>
    new Uint8Array(parts.flatMap(part => (typeof part === "string" ? [...utf8.encode(part)] : part)));
  const bytesOf = (chunks: Chunk[]) =>
    Buffer.concat(chunks.map(chunk => (typeof chunk === "string" ? utf8.encode(chunk) : chunk)));
  const decoded = (chunks: Chunk[]) => new TextDecoder().decode(bytesOf(chunks));
  const tick = () => new Promise<void>(resolve => setImmediate(resolve));
  // A promise as a value that toEqual can compare: what it fulfilled with, or the name of its error.
  const settled = (promise: Promise<unknown>) =>
    promise.then(
      value => ({ value }),
      error => ({ error: error.name }),
    );
  const parsed = (text: string) => {
    try {
      return { value: JSON.parse(text) };
    } catch {
      return { error: "SyntaxError" };
    }
  };

  const json = '{"ok":"🌎"}';

  describe.each([
    ["a string", (body: string) => body],
    ["a String object", (body: string) => new String(body)],
  ] as [string, (body: string) => any][])("%s", (_, carry) => {
    const read = async (body: string) => {
      const request = () => new Request(url, { method: "POST", body: carry(body) });
      return {
        "Response.text()": await settled(new Response(carry(body)).text()),
        "Response.json()": await settled(new Response(carry(body)).json()),
        "Response.textStream()": (await Array.fromAsync(new Response(carry(body)).textStream())).join(""),
        "Request.text()": await settled(request().text()),
        "Request.json()": await settled(request().json()),
        "Request.textStream()": (await Array.fromAsync(request().textStream())).join(""),
      };
    };
    const expected = (text: string) => ({
      "Response.text()": { value: text },
      "Response.json()": parsed(text),
      "Response.textStream()": text,
      "Request.text()": { value: text },
      "Request.json()": parsed(text),
      "Request.textStream()": text,
    });

    test.each([
      ["a mark, then JSON", "\uFEFF" + json, json],
      ["a mark, then Latin-1 text", '\uFEFF"h\u00e9llo"', '"h\u00e9llo"'],
      ["two marks", "\uFEFF\uFEFF" + json, "\uFEFF" + json],
      ["a mark in the middle", '{"a":"x\uFEFFy"}', '{"a":"x\uFEFFy"}'],
      ["only a mark", "\uFEFF", ""],
      ["no mark", json, json],
    ])("%s", async (_, body, text) => {
      expect(decoded([body])).toBe(text);
      expect(await read(body)).toEqual(expected(text));
    });

    // Not the UTF-8 decode, which gives U+FFFD: a lone surrogate of a string body stays, with or without a mark.
    test.each([
      ["a lone surrogate", '"a\uD800b"', '"a\uD800b"'],
      ["a mark, then a lone surrogate", '\uFEFF"a\uD800b"', '"a\uD800b"'],
    ])("exception: %s stays", async (_, body, text) => {
      expect(await read(body)).toEqual(expected(text));
    });
  });

  test("the text of a marked string body does not depend on what ran before text()", async () => {
    const body = "\uFEFF" + json;
    const original = new Response(body);
    const clone = original.clone();
    const streamed = new Response(body);
    expect(streamed.body).toBeInstanceOf(ReadableStream);
    const request = new Request(url, { method: "POST", body });

    expect({
      "text()": await new Response(body).text(),
      "text() after clone()": await original.text(),
      "text() of the clone": await clone.text(),
      "text() after .body": await streamed.text(),
      "text() of new Request(request)": await new Request(request).text(),
    }).toEqual({
      "text()": json,
      "text() after clone()": json,
      "text() of the clone": json,
      "text() after .body": json,
      "text() of new Request(request)": json,
    });
  });

  test("bytes(), arrayBuffer() and blob() of a marked string body keep the mark", async () => {
    const body = "\uFEFF" + json;
    const want = [...utf8.encode(body)];
    expect(want.slice(0, 3)).toEqual(MARK);

    expect({
      "bytes()": [...(await new Response(body).bytes())],
      "arrayBuffer()": [...new Uint8Array(await new Response(body).arrayBuffer())],
      "blob()": [...(await (await new Response(body).blob()).bytes())],
    }).toEqual({ "bytes()": want, "arrayBuffer()": want, "blob()": want });
  });

  // [name, the chunks, the text of those chunks]
  const documents: [string, () => Chunk[], string][] = [
    ["a mark, then JSON", () => [bytes(MARK, json)], json],
    ["a mark cut after its first byte", () => [bytes([0xef]), bytes([0xbb, 0xbf], json)], json],
    ["a mark with one byte per chunk", () => [bytes([0xef]), bytes([0xbb]), bytes([0xbf]), bytes(json)], json],
    ["two marks", () => [bytes(MARK, MARK, json)], "\uFEFF" + json],
    ["a mark in the middle", () => [bytes('{"a":"x'), bytes(MARK, 'y"}')], '{"a":"x\uFEFFy"}'],
    ["only a mark", () => [bytes(MARK)], ""],
    ["no mark", () => [bytes(json)], json],
    ["a mark, then a byte that is not UTF-8", () => [bytes(MARK, [0xff], '"a"')], '\uFFFD"a"'],
    ["a mark, then a cut sequence", () => [bytes(MARK, '"a"', [0xe4, 0xb8])], '"a"\uFFFD'],
    ["a marked string", () => ["\uFEFF" + json], json],
    ["a marked string, then bytes", () => ["\uFEFF{", bytes('"ok":"🌎"}')], json],
    ["bytes, then a marked string", () => [bytes('{"a":"x'), '\uFEFFy"}'], '{"a":"x\uFEFFy"}'],
    ["a string of one mark, then a marked string", () => ["\uFEFF", "\uFEFF" + json], "\uFEFF" + json],
    ["a string of two marks", () => ["\uFEFF\uFEFF" + json], "\uFEFF" + json],
    ["a sequence cut by a string", () => [bytes([0xe4, 0xb8]), "x", bytes([0xad])], "\uFFFDx\uFFFD"],
  ];

  const carriers: [string, (chunks: Chunk[]) => any][] = [
    [
      "an async generator",
      chunks =>
        (async function* () {
          yield* chunks;
        })(),
    ],
    [
      "an async generator function",
      chunks =>
        async function* () {
          yield* chunks;
        },
    ],
    [
      "an object with Symbol.asyncIterator",
      chunks => ({
        async *[Symbol.asyncIterator]() {
          yield* chunks;
        },
      }),
    ],
    ["a node:stream Readable", chunks => Readable.from(chunks)],
    [
      "a direct ReadableStream",
      chunks =>
        new ReadableStream({
          type: "direct",
          pull(controller) {
            for (const chunk of chunks) controller.write(chunk);
            controller.close();
          },
        }),
    ],
    [
      "a direct ReadableStream that writes once per tick",
      chunks =>
        new ReadableStream({
          type: "direct",
          async pull(controller) {
            for (const chunk of chunks) {
              controller.write(chunk);
              await tick();
            }
            controller.close();
          },
        }),
    ],
    [
      "a default ReadableStream",
      chunks =>
        new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
          },
        }),
    ],
  ];

  const everyBody = () => true;
  const webStream = (body: unknown) => body instanceof ReadableStream;
  // node:stream/consumers follows Node, which appends a string chunk as it is: only byte chunks are compared.
  const webStreamOfBytes = (body: unknown, chunks: Chunk[]) =>
    webStream(body) && chunks.every(chunk => typeof chunk !== "string");
  // [name, what it gives, the bodies it takes, the read]
  const readers: [
    string,
    "text" | "json" | "bytes",
    (body: unknown, chunks: Chunk[]) => boolean,
    (body: any) => Promise<unknown>,
  ][] = [
    ["new Response(body).text()", "text", everyBody, body => new Response(body).text()],
    ["new Response(body).json()", "json", everyBody, body => new Response(body).json()],
    ["new Response(body).bytes()", "bytes", everyBody, async body => [...(await new Response(body).bytes())]],
    ["new Request(url, { body }).text()", "text", everyBody, body => new Request(url, { method: "POST", body }).text()],
    ["new Request(url, { body }).json()", "json", everyBody, body => new Request(url, { method: "POST", body }).json()],
    ["stream.text()", "text", webStream, stream => stream.text()],
    ["stream.json()", "json", webStream, stream => stream.json()],
    ["Bun.readableStreamToText(stream)", "text", webStream, stream => Bun.readableStreamToText(stream)],
    ["Bun.readableStreamToJSON(stream)", "json", webStream, stream => Bun.readableStreamToJSON(stream)],
    ["consumers.text(stream)", "text", webStreamOfBytes, stream => consumers.text(stream)],
    ["consumers.json(stream)", "json", webStreamOfBytes, stream => consumers.json(stream)],
  ];

  describe.each(carriers)("%s", (_, carry) => {
    test.each(documents)("%s", async (_, chunks, text) => {
      expect(decoded(chunks())).toBe(text);

      const got: Record<string, unknown> = {};
      const want: Record<string, unknown> = {};
      for (const [name, gives, takes, read] of readers) {
        if (!takes(carry(chunks()), chunks())) continue;
        got[name] = await settled(read(carry(chunks())));
        want[name] =
          gives === "text" ? { value: text } : gives === "json" ? parsed(text) : { value: [...bytesOf(chunks())] };
      }
      expect(got).toEqual(want);
    });

    // Not the UTF-8 decode, which gives U+FFFD: a lone surrogate of a string chunk stays, with or without a mark.
    test.each([
      ["a lone surrogate", () => ['"a\uD800b"'], '"a\uD800b"'],
      ["a mark, then a lone surrogate", () => ['\uFEFF"a\uD800b"'], '"a\uD800b"'],
      ["a string of one mark, then a lone surrogate", () => ["\uFEFF", '"a\uD800b"'], '"a\uD800b"'],
    ] as [string, () => Chunk[], string][])("exception: %s in a string chunk stays", async (_, chunks, text) => {
      expect({
        "Response.text()": await new Response(carry(chunks())).text(),
        "Response.json()": await new Response(carry(chunks())).json(),
      }).toEqual({ "Response.text()": text, "Response.json()": JSON.parse(text) });
    });
  });
});

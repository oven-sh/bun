import { describe, expect, it, test } from "bun:test";
import { Readable } from "node:stream";

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
    });

    it("in text()", async () => {
      const blob = new Blob(["\uFEFFHello, World!"], { type: "text/plain" });
      expect(await blob.text()).toBe("Hello, World!");
    });

    it("in json()", async () => {
      const blob = new Blob(['\uFEFF{"hello":"World"}'], { type: "application/json" });
      expect(await blob.json()).toEqual({ "hello": "World" } as any);
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

// The URL Standard's application/x-www-form-urlencoded parser and the
// multipart/form-data parser both decode with "UTF-8 decode without BOM",
// which treats a leading U+FEFF as data (unlike text()/json()).
describe("UTF-8 BOM should be preserved in formData()", () => {
  const urlencoded = { "content-type": "application/x-www-form-urlencoded" };

  it("matches URLSearchParams on the same bytes", async () => {
    const expected = [...new URLSearchParams("\uFEFFa=1")];
    expect(expected).toEqual([["\uFEFFa", "1"]]);

    const fromString = await new Response("\uFEFFa=1", { headers: urlencoded }).formData();
    expect([...fromString]).toEqual(expected);

    const fromBytes = await new Response(new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x3d, 0x31]), {
      headers: urlencoded,
    }).formData();
    expect([...fromBytes]).toEqual(expected);

    const fromRequest = await new Request("http://h/", {
      method: "POST",
      body: "\uFEFFa=1",
      headers: urlencoded,
    }).formData();
    expect([...fromRequest]).toEqual(expected);
  });

  it("BOM-only body yields a single entry", async () => {
    const formData = await new Response("\uFEFF", { headers: urlencoded }).formData();
    expect([...formData]).toEqual([["\uFEFF", ""]]);
  });

  it("in Blob", async () => {
    const blob = new Blob(["\uFEFFhello=world"], { type: "application/x-www-form-urlencoded" });
    const formData = await blob.formData();
    expect([...formData.entries()]).toEqual([["\uFEFFhello", "world"]]);
    expect(formData.get("\uFEFFhello")).toBe("world");
    expect(formData.get("hello")).toBe(null);
  });

  it("in Blob with emoji", async () => {
    const blob = new Blob(["\uFEFFhello=world 🌎"], { type: "application/x-www-form-urlencoded" });
    const formData = await blob.formData();
    expect([...formData.entries()]).toEqual([["\uFEFFhello", "world 🌎"]]);
  });

  it("in Response", async () => {
    const response = new Response(Buffer.from("\uFEFFhello=world"), { headers: urlencoded });
    const formData = await response.formData();
    expect([...formData]).toEqual([["\uFEFFhello", "world"]]);
    expect(formData.get("\uFEFFhello")).toBe("world");
    expect(formData.get("hello")).toBe(null);
  });

  it("in Request", async () => {
    const request = new Request("https://example.com", {
      body: Buffer.from("\uFEFFhello=world"),
      headers: urlencoded,
    });
    const formData = await request.formData();
    expect([...formData]).toEqual([["\uFEFFhello", "world"]]);
    expect(formData.get("\uFEFFhello")).toBe("world");
    expect(formData.get("hello")).toBe(null);
  });

  it("in Bun.readableStreamToFormData()", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from("\uFEFFhello=world"));
        controller.close();
      },
    });
    const formData = await Bun.readableStreamToFormData(stream);
    expect([...formData.entries()]).toEqual([["\uFEFFhello", "world"]]);
    expect(formData.get("\uFEFFhello")).toBe("world");
    expect(formData.get("hello")).toBe(null);
  });

  it("in multipart/form-data part values", async () => {
    const boundary = "----x";
    const body = [`------x`, `Content-Disposition: form-data; name="field"`, ``, `\uFEFFvalue`, `------x--`, ``].join(
      "\r\n",
    );
    const response = new Response(body, {
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    const formData = await response.formData();
    expect([...formData]).toEqual([["field", "\uFEFFvalue"]]);
  });

  it("in multipart/form-data round-tripped through FormData", async () => {
    const sent = new FormData();
    sent.append("leading", "\uFEFFbom");
    sent.append("only", "\uFEFF");
    sent.append("trailing", "x\uFEFF");
    sent.append("file", new Blob([new Uint8Array([0xef, 0xbb, 0xbf, 0x41])]), "f.txt");
    const received = await new Request("http://h/", { method: "POST", body: sent }).formData();

    const strings = [...received].filter(([, v]) => typeof v === "string");
    expect(strings).toEqual([
      ["leading", "\uFEFFbom"],
      ["only", "\uFEFF"],
      ["trailing", "x\uFEFF"],
    ]);
    const file = received.get("file") as Blob;
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([0xef, 0xbb, 0xbf, 0x41]);
  });
});

// text() is one UTF-8 decode of the body's bytes, so it drops exactly one leading EF BB BF. json() parses that text.
describe("text() and json() drop one leading UTF-8 BOM", () => {
  type Chunk = string | Uint8Array;
  const json = '{"ok":"🌎"}';
  const BOM = [0xef, 0xbb, 0xbf];
  const bytes = (...parts: (string | number[])[]) =>
    new Uint8Array(parts.flatMap(part => (typeof part === "string" ? [...Buffer.from(part)] : part)));
  const decoded = (chunks: Chunk[]) => new TextDecoder().decode(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))));
  const request = (body: Bun.BodyInit) => new Request("http://localhost/", { method: "POST", body });

  test.each([
    ["a BOM, then JSON", "\uFEFF" + json, json],
    ["a BOM, then Latin-1 text", '\uFEFF"h\u00e9llo"', '"h\u00e9llo"'],
    ["two BOMs", '\uFEFF\uFEFF"a"', '\uFEFF"a"'],
    ["a BOM in the middle", '"x\uFEFFy"', '"x\uFEFFy"'],
    ["only a BOM", "\uFEFF", ""],
  ])("string body: %s", async (_, body, text) => {
    expect(decoded([body])).toBe(text);
    expect({
      response: await new Response(body).text(),
      request: await request(body).text(),
      textStream: (await Array.fromAsync(new Response(body).textStream())).join(""),
    }).toEqual({ response: text, request: text, textStream: text });
  });

  test("string body: json() parses the text after the BOM", async () => {
    expect(await new Response("\uFEFF" + json).json()).toEqual({ ok: "🌎" });
    expect(await request("\uFEFF" + json).json()).toEqual({ ok: "🌎" });
  });

  test("string body: bytes() keeps the BOM", async () => {
    expect([...(await new Response("\uFEFFa").bytes())]).toEqual([...BOM, 0x61]);
  });

  const carriers: [string, (chunks: Chunk[]) => any][] = [
    [
      "an async generator",
      chunks =>
        (async function* () {
          yield* chunks;
        })(),
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
  const documents: [string, () => Chunk[], string][] = [
    ["a BOM, then JSON", () => [bytes(BOM, json)], json],
    ["a BOM split across chunks", () => [bytes([0xef]), bytes([0xbb, 0xbf], json)], json],
    ["two BOMs", () => [bytes(BOM, BOM, '"a"')], '\uFEFF"a"'],
    ["a BOM in the middle", () => [bytes('"x'), bytes(BOM, 'y"')], '"x\uFEFFy"'],
    ["a string chunk with a BOM", () => ["\uFEFF" + json], json],
    ["a string chunk with a BOM, then bytes", () => ["\uFEFF{", bytes('"ok":"🌎"}')], json],
  ];
  describe.each(carriers)("%s", (_, carry) => {
    test.each(documents)("%s", async (_, chunks, text) => {
      expect(decoded(chunks())).toBe(text);
      expect({
        response: await new Response(carry(chunks())).text(),
        request: await request(carry(chunks())).text(),
      }).toEqual({ response: text, request: text });
      if (text === json) expect(await new Response(carry(chunks())).json()).toEqual({ ok: "🌎" });
    });
  });
});

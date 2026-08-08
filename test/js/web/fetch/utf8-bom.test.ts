import { describe, expect, it, test } from "bun:test";

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

  describe.each([
    ["Response", (body: string, type: string) => new Response(body, { headers: { "content-type": type } })],
    [
      "Request",
      (body: string, type: string) =>
        new Request("https://example.com", { method: "POST", body, headers: { "content-type": type } }),
    ],
  ] as const)("%s (string body)", (_, make) => {
    it("in text()", async () => {
      expect(await make("\uFEFFHello, World!", "text/plain").text()).toBe("Hello, World!");
    });

    it("in text() with emoji", async () => {
      expect(await make("\uFEFFHello, World! 🌎", "text/plain").text()).toBe("Hello, World! 🌎");
    });

    it("in text() with only a BOM", async () => {
      expect(await make("\uFEFF", "text/plain").text()).toBe("");
    });

    it("in text() only strips one leading BOM", async () => {
      expect(await make("\uFEFF\uFEFFHello", "text/plain").text()).toBe("\uFEFFHello");
    });

    it("in text() leaves an interior BOM", async () => {
      expect(await make("Hello\uFEFFWorld", "text/plain").text()).toBe("Hello\uFEFFWorld");
    });

    it("in json()", async () => {
      expect(await make('\uFEFF{"hello":"World"}', "application/json").json()).toEqual({ "hello": "World" } as any);
    });

    it("in json() with emoji", async () => {
      expect(await make('\uFEFF{"hello":"World 🌎"}', "application/json").json()).toEqual({
        "hello": "World 🌎",
      } as any);
    });

    it("replaces lone surrogates with U+FFFD in text()", async () => {
      expect(await make("a\uD800b", "text/plain").text()).toBe("a\uFFFDb");
      expect(await make("a\uDC00b", "text/plain").text()).toBe("a\uFFFDb");
    });

    it("replaces lone surrogates with U+FFFD in json()", async () => {
      expect(await make('{"a":"\uD800"}', "application/json").json()).toEqual({ a: "\uFFFD" } as any);
    });

    // Fetch body mixin: text() is "UTF-8 decode" of the body's bytes, and a
    // string body's bytes are its UTF-8 encoding, so text() must equal
    // TextDecoder().decode(arrayBuffer()) for every string body.
    it.each([
      "hello",
      "Hello, World! 🌎",
      "\uFEFF",
      "\uFEFFHello",
      "\uFEFF\uFEFF",
      "a\uFEFFb",
      "\uD800",
      "a\uD800b",
      "\uDC00abc",
      "\uD83C\uDF0E",
      "日本語",
      "\uFEFF\uD800🌎",
    ])("text() matches TextDecoder().decode(arrayBuffer()) for %j", async body => {
      const text = await make(body, "text/plain").text();
      const bytes = await make(body, "text/plain").arrayBuffer();
      expect(text).toBe(new TextDecoder().decode(bytes));
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

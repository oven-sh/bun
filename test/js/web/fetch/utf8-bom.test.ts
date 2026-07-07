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
    expect([...formData]).toEqual([["\uFEFFhello", "world"]]);
    expect(formData.get("\uFEFFhello")).toBe("world");
    expect(formData.get("hello")).toBe(null);
  });

  it("in Blob with emoji", async () => {
    const blob = new Blob(["\uFEFFhello=world 🌎"], { type: "application/x-www-form-urlencoded" });
    const formData = await blob.formData();
    expect([...formData]).toEqual([["\uFEFFhello", "world 🌎"]]);
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
    expect([...formData]).toEqual([["\uFEFFhello", "world"]]);
    expect(formData.get("\uFEFFhello")).toBe("world");
    expect(formData.get("hello")).toBe(null);
  });

  it("in multipart/form-data part values", async () => {
    const boundary = "----x";
    const body = [
      `------x`,
      `Content-Disposition: form-data; name="field"`,
      ``,
      `\uFEFFvalue`,
      `------x--`,
      ``,
    ].join("\r\n");
    const response = new Response(body, {
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    const formData = await response.formData();
    expect([...formData]).toEqual([["field", "\uFEFFvalue"]]);
  });
});

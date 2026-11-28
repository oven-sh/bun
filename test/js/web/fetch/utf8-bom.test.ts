import { describe, expect, it, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";

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

      it("is kept in formData()", async () => {
        const blob = new Blob(["\uFEFFhello=world 🌎"], { type: "application/x-www-form-urlencoded" });
        const formData = await blob.formData();
        expect([...formData.entries()]).toEqual([["\uFEFFhello", "world 🌎"]]);
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

    it("is kept in formData()", async () => {
      const blob = new Blob(["\uFEFFhello=world"], { type: "application/x-www-form-urlencoded" });
      const formData = await blob.formData();
      expect([...formData.entries()]).toEqual([["\uFEFFhello", "world"]]);
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

    it("is kept in formData()", async () => {
      const response = new Response(Buffer.from("\uFEFFhello=world"), {
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      const formData = await response.formData();
      expect([...formData.entries()]).toEqual([["\uFEFFhello", "world"]]);
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

    it("is kept in formData()", async () => {
      const request = new Request("https://example.com", {
        body: Buffer.from("\uFEFFhello=world"),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      const formData = await request.formData();
      expect([...formData.entries()]).toEqual([["\uFEFFhello", "world"]]);
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

    it("is kept in Bun.readableStreamToFormData()", async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from("\uFEFFhello=world"));
          controller.close();
        },
      });
      const formData = await Bun.readableStreamToFormData(stream);
      expect([...formData.entries()]).toEqual([["\uFEFFhello", "world"]]);
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

// The URL Standard and Fetch decode form names and values with "UTF-8 decode without BOM", so U+FEFF is data.
type Entries = [name: string, value: string][];

describe("formData() keeps a BOM at any position of a url-encoded body", () => {
  const headers = { "content-type": "application/x-www-form-urlencoded" };

  test.each<[string, string, Entries]>([
    ["only a BOM", "\uFEFF", [["\uFEFF", ""]]],
    ["two BOMs", "\uFEFF\uFEFFa=1", [["\uFEFF\uFEFFa", "1"]]],
    [
      "a BOM in a value and in a later name",
      "\uFEFFa=\uFEFF1&\uFEFFb=2",
      [
        ["\uFEFFa", "\uFEFF1"],
        ["\uFEFFb", "2"],
      ],
    ],
    [
      "a BOM, then &",
      "\uFEFF&a=1",
      [
        ["\uFEFF", ""],
        ["a", "1"],
      ],
    ],
    ["a BOM, then =", "\uFEFF=v", [["\uFEFF", "v"]]],
  ])("%s", async (_, body, entries) => {
    expect([...new URLSearchParams(body)]).toEqual(entries);
    expect([...(await new Response(body, { headers }).formData())]).toEqual(entries);
  });

  test("text() of the same bytes drops it", async () => {
    const response = new Response(Buffer.from("\uFEFFhello=world"), { headers });
    expect({
      text: await response.clone().text(),
      formData: [...(await response.formData())],
    }).toEqual({
      text: "hello=world",
      formData: [["\uFEFFhello", "world"]],
    });
  });
});

const forms: { encoding: string; type: string; boundary?: string; body: string; entries: Entries }[] = [
  {
    encoding: "url-encoded",
    type: "application/x-www-form-urlencoded",
    body: "\uFEFFhello=world",
    entries: [["\uFEFFhello", "world"]],
  },
];

describe.each(forms)("every way to parse a $encoding form keeps a leading BOM", ({ type, boundary, body, entries }) => {
  const bytes = () => new Uint8Array(Buffer.from(body));
  const streamOf = (...chunks: Uint8Array[]) =>
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });

  test("Blob.formData()", async () => {
    const formData = await new Blob([bytes()], { type }).formData();
    expect([...formData.entries()]).toEqual(entries);
  });

  test("Bun.file().formData()", async () => {
    using dir = tempDir("formdata-bom", { form: body });
    const formData = await Bun.file(join(String(dir), "form"), { type }).formData();
    expect([...formData.entries()]).toEqual(entries);
  });

  test("FormData.from() with a string", () => {
    // @ts-expect-error
    expect([...FormData.from(body, boundary)]).toEqual(entries);
  });

  test("FormData.from() with bytes", () => {
    // @ts-expect-error
    expect([...FormData.from(bytes(), boundary)]).toEqual(entries);
  });

  test("Bun.readableStreamToFormData()", async () => {
    const formData = await Bun.readableStreamToFormData(streamOf(bytes()), boundary);
    expect([...formData.entries()]).toEqual(entries);
  });

  test("a stream body whose chunks split the BOM", async () => {
    const all = bytes();
    const bom = all.indexOf(0xef);
    const stream = streamOf(all.subarray(0, bom + 1), all.subarray(bom + 1, bom + 3), all.subarray(bom + 3));
    expect([...(await new Response(stream, { headers: { "content-type": type } }).formData())]).toEqual(entries);
  });

  test("a Bun.serve() request", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: async request => Response.json([...(await request.formData())]),
    });
    const response = await fetch(server.url, { method: "POST", headers: { "content-type": type }, body: bytes() });
    expect(await response.json()).toEqual(entries);
  });

  test("a fetch() response whose body is still arriving", async () => {
    const all = bytes();
    const rest = Promise.withResolvers<void>();
    await using server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(all.subarray(0, 1));
              await rest.promise;
              controller.enqueue(all.subarray(1));
              controller.close();
            },
          }),
          { headers: { "content-type": type } },
        ),
    });
    const response = await fetch(server.url);
    const formData = response.formData();
    rest.resolve();
    expect([...(await formData)]).toEqual(entries);
  });
});

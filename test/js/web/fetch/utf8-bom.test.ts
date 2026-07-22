import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

// File API spec: Blob.text() is "UTF-8 decode" — it strips only the UTF-8 BOM
// (EF BB BF). A leading FF FE is two invalid UTF-8 bytes, not a signal to switch
// encodings. Bun.file()/S3 keep a documented UTF-16LE convenience; standard
// Blob/Response must not.
describe("UTF-16LE BOM is not sniffed by Blob/Response .text()", () => {
  // FF FE 68 69: as UTF-16LE this is U+6968 "楨"; as UTF-8 it is two invalid
  // bytes then "hi".
  const FF_FE_hi = Uint8Array.of(0xff, 0xfe, 0x68, 0x69);
  const utf8 = "\uFFFD\uFFFDhi";

  test("Blob.text()", async () => {
    expect(await new Blob([FF_FE_hi]).text()).toBe(utf8);
  });

  test("File.text()", async () => {
    expect(await new File([FF_FE_hi], "f").text()).toBe(utf8);
  });

  test("Response(blob).text() matches Response(bytes).text()", async () => {
    expect(await new Response(new Blob([FF_FE_hi])).text()).toBe(utf8);
    expect(await new Response(FF_FE_hi).text()).toBe(utf8);
  });

  test("Request(blob).text()", async () => {
    const req = new Request("http://x", { method: "POST", body: new Blob([FF_FE_hi]) });
    expect(await req.text()).toBe(utf8);
  });

  test("fetch().text() and fetch().blob().text() agree", async () => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response(FF_FE_hi) });
    const url = `http://127.0.0.1:${server.port}/`;
    const [direct, viaBlob] = await Promise.all([
      fetch(url).then(r => r.text()),
      fetch(url)
        .then(r => r.blob())
        .then(b => b.text()),
    ]);
    expect({ direct, viaBlob }).toEqual({ direct: utf8, viaBlob: utf8 });
  });

  test("Blob.json() does not sniff FF FE either", async () => {
    // FF FE then `1` `\0` — would parse as JSON `1` under UTF-16LE, must throw
    // as invalid UTF-8 JSON.
    const blob = new Blob([Uint8Array.of(0xff, 0xfe, 0x31, 0x00)]);
    expect(async () => await blob.json()).toThrow();
  });

  test("UTF-32LE-looking prefix is not misread as UTF-16LE", async () => {
    const u32 = Uint8Array.of(0xff, 0xfe, 0x00, 0x00, 0x41, 0x00, 0x00, 0x00);
    expect(await new Blob([u32]).text()).toBe("\uFFFD\uFFFD\0\0A\0\0\0");
  });

  test("UTF-16BE BOM is not sniffed either (control)", async () => {
    const be = Uint8Array.of(0xfe, 0xff, 0x00, 0x41);
    expect(await new Blob([be]).text()).toBe("\uFFFD\uFFFD\0A");
  });

  // Bun.file() intentionally keeps the UTF-16LE sniff (#8219, docs/runtime/s3.mdx).
  test("Bun.file().text() still honours a UTF-16LE BOM", async () => {
    using dir = tempDir("blob-utf16le-bom", {});
    const p = join(String(dir), "f.txt");
    writeFileSync(p, Buffer.of(0xff, 0xfe, 0x68, 0x00, 0x69, 0x00));
    expect(await Bun.file(p).text()).toBe("hi");
  });

  // Node.js parity in a fresh process: every reader agrees.
  test("subprocess: Blob/Response readers all UTF-8-decode FF FE", async () => {
    const src = `
      const u = Uint8Array.of(0xff, 0xfe, 0x68, 0x69);
      const a = await new Blob([u]).text();
      const b = await new Response(u).text();
      const c = await new Response(new Blob([u])).text();
      console.log(JSON.stringify([a, b, c]));
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([utf8, utf8, utf8]);
    expect(exitCode).toBe(0);
  });
});

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

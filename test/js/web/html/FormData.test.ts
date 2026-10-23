import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { closeSync, openAsBlob, openSync } from "node:fs";
import { join } from "path";

describe("FormData", () => {
  it("should be able to append a string", () => {
    const formData = new FormData();
    formData.append("foo", "bar");
    expect(formData.get("foo")).toBe("bar");
    expect(formData.getAll("foo")[0]).toBe("bar");
  });

  it("should be able to append a Blob", async () => {
    const formData = new FormData();
    formData.append("foo", new Blob(["bar"]), "mynameis.txt");
    expect(await ((await formData.get("foo")) as Blob)!.text()).toBe("bar");
    expect(formData.getAll("foo")[0] instanceof Blob).toBe(true);
    expect(formData.getAll("foo")[0] instanceof File).toBe(true);
    expect((formData.getAll("foo")[0] as File).name).toBe("mynameis.txt");
  });

  it("should be able to set a Blob", async () => {
    const formData = new FormData();
    formData.set("foo", new Blob(["bar"]));
    expect(await ((await formData.get("foo")) as Blob).text()).toBe("bar");
    expect(formData.getAll("foo")[0] instanceof Blob).toBe(true);
  });

  it("should be able to set a string", async () => {
    const formData = new FormData();
    formData.set("foo", "bar");
    expect(formData.get("foo")).toBe("bar");
    expect(formData.getAll("foo")[0]).toBe("bar");
  });

  it("should get filename from file", async () => {
    const blob = new Blob(["bar"]);
    const formData = new FormData();
    formData.append("foo", blob);
    // @ts-expect-error
    expect(formData.get("foo").name).toBeUndefined();
    formData.append("foo2", new File([blob], "foo.txt"));
    // @ts-expect-error
    expect(formData.get("foo2").name).toBe("foo.txt");
  });

  it("should use the correct filenames", async () => {
    const blob = new Blob(["bar"]) as any;
    const form = new FormData();
    form.append("foo", blob);
    expect(blob.name).toBeUndefined();

    let b1 = form.get("foo") as any;
    expect(blob.name).toBeUndefined();
    expect(b1.name).toBeUndefined();

    form.set("foo", b1, "foo.txt");
    expect(blob.name).toBeUndefined();
    expect(b1.name).toBeUndefined();

    b1 = form.get("foo") as Blob;
    expect(blob.name).toBeUndefined();
    expect(b1.name).toBe("foo.txt");
  });

  const multipartFormDataFixturesRawBody = [
    {
      name: "simple",
      body: '--foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbar\r\n--foo--\r\n',
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
      expected: {
        foo: "bar",
      },
    },
    {
      name: "simple with trailing CRLF",
      body: '--foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbar\r\n--foo--\r\n\r\n',
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
      expected: {
        foo: "bar",
      },
    },
    {
      name: "simple with trailing CRLF and extra CRLF",
      body: '--foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbar\r\n--foo--\r\n\r\n\r\n',
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
      expected: {
        foo: "bar",
      },
    },
    {
      name: "advanced",
      body: '--foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbar\r\n--foo\r\nContent-Disposition: form-data; name="baz"\r\n\r\nqux\r\n--foo--\r\n',
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
      expected: {
        foo: "bar",
        baz: "qux",
      },
    },
    {
      name: "advanced with multiple values",
      body: '--foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbar\r\n--foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbaz\r\n--foo--\r\n',
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
      expected: {
        foo: ["bar", "baz"],
      },
    },
    {
      name: "advanced with multiple values and trailing CRLF",
      body: '--foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbar\r\n--foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbaz\r\n--foo--\r\n\r\n',
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
      expected: {
        foo: ["bar", "baz"],
      },
    },
    {
      name: "extremely advanced",
      body: '--foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbar\r\n--foo\r\nContent-Disposition: form-data; name="baz"\r\n\r\nqux\r\n--foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbaz\r\n--foo--\r\n',
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
      expected: {
        foo: ["bar", "baz"],
        baz: "qux",
      },
    },
    {
      name: "with name and filename",
      body: '--foo\r\nContent-Disposition: form-data; name="foo"; filename="bar"\r\n\r\nbaz\r\n--foo--\r\n',
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
      expected: {
        foo: new Blob(["baz"]),
      },
    },
    {
      name: "with name and filename and trailing CRLF",
      body: '--foo\r\nContent-Disposition: form-data; name="foo"; filename="bar"\r\n\r\nbaz\r\n--foo--\r\n\r\n',
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
      expected: {
        foo: new Blob(["baz"]),
      },
    },
  ];

  for (const { name, body, headers, expected: expected_ } of multipartFormDataFixturesRawBody) {
    const Class = [Response, Request] as const;
    for (const C of Class) {
      it(`should parse multipart/form-data (${name}) with ${C.name}`, async () => {
        const response =
          C === Response ? new Response(body, { headers }) : new Request({ headers, body, url: "http://hello.com" });
        const formData = await response.formData();
        expect(formData instanceof FormData).toBe(true);
        const entry: { [k: string]: any } = {};
        const expected: { [k: string]: any } = Object.assign({}, expected_);

        for (const key of formData.keys()) {
          const values = formData.getAll(key);
          if (values.length > 1) {
            entry[key] = values;
          } else {
            entry[key] = values[0];
            if (entry[key] instanceof Blob) {
              expect(expected[key] instanceof Blob).toBe(true);

              entry[key] = await entry[key].text();
              expected[key] = await expected[key].text();
            } else {
              expect(typeof entry[key]).toBe(typeof expected[key]);
              expect(expected[key] instanceof Blob).toBe(false);
            }
          }
        }

        expect(entry).toEqual(expected);
      });

      it(`should roundtrip multipart/form-data (${name}) with ${C.name}`, async () => {
        const response =
          C === Response ? new Response(body, { headers }) : new Request({ headers, body, url: "http://hello.com" });
        const formData = await response.formData();
        expect(formData instanceof FormData).toBe(true);

        const request = await new Response(formData as FormData).formData();
        expect(request instanceof FormData).toBe(true);

        const aKeys = Array.from(formData.keys());
        const bKeys = Array.from(request.keys());
        expect(aKeys).toEqual(bKeys);

        for (const key of aKeys) {
          const aValues = formData.getAll(key);
          const bValues = request.getAll(key);
          for (let i = 0; i < aValues.length; i++) {
            const a = aValues[i];
            const b = bValues[i];
            if (a instanceof Blob) {
              expect(b instanceof Blob).toBe(true);
              expect(await a.text()).toBe(await (b as Blob).text());
            } else {
              expect(a).toBe(b);
            }
          }
        }

        // Test that it also works with Blob.
        const c = await new Blob([body], { type: headers["Content-Type"] }).formData();
        expect(c instanceof FormData).toBe(true);
        const cKeys = Array.from(c.keys());
        expect(cKeys).toEqual(bKeys);
        for (const key of cKeys) {
          const cValues = c.getAll(key);
          const bValues = request.getAll(key);
          for (let i = 0; i < cValues.length; i++) {
            const c = cValues[i];
            const b = bValues[i];
            if (c instanceof Blob) {
              expect(b instanceof Blob).toBe(true);
              expect(await c.text()).toBe(await (b as Blob).text());
            } else {
              expect(c).toBe(b as string);
            }
          }
        }
      });
    }
  }

  it("should throw on missing final boundary", async () => {
    const response = new Response('-foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbar\r\n', {
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
    });
    try {
      await response.formData();
      throw "should have thrown";
    } catch (e: any) {
      expect(typeof e.message).toBe("string");
    }
  });

  // RFC 2045 §5.1 / RFC 7231 §3.1.1.1: media type/subtype and parameter
  // attribute names are case-insensitive; the boundary VALUE is byte-exact.
  describe("Content-Type case-insensitivity", () => {
    const body = '--X\r\nContent-Disposition: form-data; name="a"\r\n\r\nhello\r\n--X--\r\n';
    for (const C of [Response, Request] as const) {
      const make = (b: string, ct: string) =>
        C === Response
          ? new Response(b, { headers: { "Content-Type": ct } })
          : new Request("http://x/", { method: "POST", body: b, headers: { "Content-Type": ct } });

      describe.each([
        "multipart/form-data; boundary=X",
        "Multipart/Form-Data; boundary=X",
        "multipart/form-data; Boundary=X",
        "Multipart/Form-Data; Boundary=X",
        "MULTIPART/FORM-DATA; BOUNDARY=X",
      ])(`${C.name}: %s`, ct => {
        it("parses", async () => {
          const fd = await make(body, ct).formData();
          expect(fd.get("a")).toBe("hello");
          expect([...fd.keys()]).toEqual(["a"]);
        });
      });

      it(`${C.name}: boundary value is matched case-sensitively`, async () => {
        const bodyAbC = '--AbC\r\nContent-Disposition: form-data; name="a"\r\n\r\nhello\r\n--AbC--\r\n';
        const fd = await make(bodyAbC, "multipart/form-data; Boundary=AbC").formData();
        expect(fd.get("a")).toBe("hello");
        await expect(make(bodyAbC, "multipart/form-data; boundary=abc").formData()).rejects.toThrow();
      });

      it(`${C.name}: application/x-www-form-urlencoded matches case-insensitively`, async () => {
        for (const ct of ["application/x-www-form-urlencoded", "Application/X-WWW-Form-URLEncoded"]) {
          const fd = await make("a=hello&b=2", ct).formData();
          expect(fd.get("a")).toBe("hello");
          expect(fd.get("b")).toBe("2");
        }
      });

      it(`${C.name}: unrelated content-type still rejects`, async () => {
        await expect(make(body, "text/plain").formData()).rejects.toThrow();
      });
    }
  });

  // RFC 2183 §2: the disposition type is a case-insensitive token.
  // RFC 9112 §5.6.3: OWS = *( SP / HTAB ), so HTAB is valid after the colon.
  describe("Content-Disposition: form-data token + OWS", () => {
    const boundary = "BX7";
    const mk = (hdr: string) => `--${boundary}\r\n${hdr}\r\n\r\nv\r\n--${boundary}--\r\n`;
    const headers = { "Content-Type": `multipart/form-data; boundary=${boundary}` };

    for (const C of [Response, Request] as const) {
      const make = (body: string) =>
        C === Response ? new Response(body, { headers }) : new Request("http://x/", { method: "POST", body, headers });

      it.each([
        ["lowercase", `Content-Disposition: form-data; name="k"`],
        ["Form-Data", `Content-Disposition: Form-Data; name="k"`],
        ["FORM-DATA", `Content-Disposition: FORM-DATA; name="k"`],
        ["mixed case header + token", `CONTENT-DISPOSITION: Form-Data; NAME="k"`],
        ["HTAB after colon", `Content-Disposition:\tform-data; name="k"`],
        ["SP + HTAB after colon", `Content-Disposition: \t form-data; name="k"`],
        ["HTAB after semicolon", `Content-Disposition: form-data;\tname="k"`],
      ])(`${C.name}: %s`, async (_label, hdr) => {
        const fd = await make(mk(hdr)).formData();
        expect([...fd.entries()]).toEqual([["k", "v"]]);
      });

      it(`${C.name}: file part with Form-Data + HTAB OWS`, async () => {
        const body =
          `--${boundary}\r\n` +
          `Content-Disposition:\tForm-Data; name="f"; filename="a.txt"\r\n` +
          `Content-Type: text/plain\r\n\r\n` +
          `hello\r\n--${boundary}--\r\n`;
        const fd = await make(body).formData();
        const file = fd.get("f") as File;
        expect(file).toBeInstanceOf(File);
        expect(file.name).toBe("a.txt");
        expect(await file.text()).toBe("hello");
      });
    }
  });

  test("FormData.from (URLSearchParams)", () => {
    expect(
      // @ts-expect-error
      FormData.from(
        new URLSearchParams({
          a: "b",
          c: "d",
        }).toString(),
      ).toJSON(),
    ).toEqual({
      a: "b",
      c: "d",
    });
  });

  test("FormData.toJSON doesn't crash with numbers", () => {
    const fd = new FormData();
    // @ts-expect-error
    fd.append(1, 1);
    // @ts-expect-error
    expect(fd.toJSON()).toEqual({ "1": "1" });
  });

  test("FormData.from throws on very large input instead of crashing", () => {
    // This test verifies that FormData.from throws an exception instead of crashing
    // when given input larger than WebKit's String::MaxLength (INT32_MAX ~= 2GB).
    // We use a smaller test case with the synthetic limit to avoid actually allocating 2GB+.
    const { setSyntheticAllocationLimitForTesting } = require("bun:internal-for-testing");
    // Set a small limit so we can test the boundary without allocating gigabytes
    const originalLimit = setSyntheticAllocationLimitForTesting(1024 * 1024); // 1MB limit
    try {
      // Create a buffer larger than the limit
      const largeBuffer = new Uint8Array(2 * 1024 * 1024); // 2MB
      // @ts-expect-error - FormData.from is a Bun extension
      expect(() => FormData.from(largeBuffer)).toThrow("Cannot create a string longer than");
    } finally {
      setSyntheticAllocationLimitForTesting(originalLimit);
    }
  });

  it("rejects a URL-encoded name that is too long to decode", async () => {
    const { setSyntheticAllocationLimitForTesting } = require("bun:internal-for-testing");
    const body = Buffer.alloc(600_000, "é");
    const headers = { "content-type": "application/x-www-form-urlencoded" };
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(body);
        controller.close();
      },
    });
    // With a 1 MiB limit the decoder is capped at 524288 UTF-8 bytes.
    const originalLimit = setSyntheticAllocationLimitForTesting(1024 * 1024);
    try {
      // @ts-expect-error - FormData.from is a Bun extension
      expect(() => FormData.from(body)).toThrow("Out of memory");
      await expect(new Response(body, { headers }).formData()).rejects.toThrow("Out of memory");
      await expect(new Response(stream, { headers }).formData()).rejects.toThrow("Out of memory");
      await expect(new Blob([body], { type: headers["content-type"] }).formData()).rejects.toThrow("Out of memory");
    } finally {
      setSyntheticAllocationLimitForTesting(originalLimit);
    }
  });

  it("throws when the entry list can't grow", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          // With a 64 KiB limit the list is capped at 2730 entries.
          const form = FormData.from(Buffer.alloc(5460, "a&").toString());
          const part = '--b\\r\\nContent-Disposition: form-data; name="a"\\r\\n\\r\\n\\r\\n';
          const multipart = Buffer.from(part.repeat(2731) + "--b--\\r\\n");
          for (const grow of [
            () => form.append("a", ""),
            () => form.set("b", new Blob([])),
            () => FormData.from(multipart, "b"),
          ]) {
            try {
              grow();
              console.log("no error");
            } catch (e) {
              console.log(e.name, e.message);
            }
          }
        `,
      ],
      env: { ...bunEnv, BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT: String(64 * 1024) },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "RangeError Out of memory\n".repeat(3),
      stderr: "",
      exitCode: 0,
    });
  });

  it("should throw on bad boundary", async () => {
    const response = new Response('foo\r\nContent-Disposition: form-data; name="foo"\r\n\r\nbar\r\n', {
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
    });
    try {
      await response.formData();
      throw "should have thrown";
    } catch (e: any) {
      expect(typeof e.message).toBe("string");
    }
  });

  it("should throw on bad header", async () => {
    const response = new Response('foo\r\nContent-Disposition: form-data; name"foo"\r\n\r\nbar\r\n', {
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
    });
    try {
      await response.formData();
      throw "should have thrown";
    } catch (e: any) {
      expect(typeof e.message).toBe("string");
    }
  });

  it("file upload on HTTP server (receive)", async () => {
    using server = Bun.serve({
      port: 0,
      development: false,
      async fetch(req) {
        const formData = await req.formData();
        return new Response(formData.get("foo"));
      },
    });

    const reqBody = new Request(server.url as any, {
      body: '--foo\r\nContent-Disposition: form-data; name="foo"; filename="bar"\r\n\r\nbaz\r\n--foo--\r\n\r\n',
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
      method: "POST",
    });

    const res = await fetch(reqBody);
    const body = await res.text();
    expect(body).toBe("baz");
  });

  it("file send on HTTP server (receive)", async () => {
    using server = Bun.serve({
      port: 0,
      development: false,
      async fetch(req) {
        const formData = await req.formData();
        return new Response(formData as FormData);
      },
    });

    const reqBody = new Request(server.url as any, {
      body: '--foo\r\nContent-Disposition: form-data; name="foo"; filename="bar"\r\n\r\nbaz\r\n--foo--\r\n\r\n',
      headers: {
        "Content-Type": "multipart/form-data; boundary=foo",
      },
      method: "POST",
    });

    const res = await fetch(reqBody);
    const body = await res.formData();
    expect(await (body.get("foo") as Blob).text()).toBe("baz");
  });
  type FetchReqArgs = [request: Request, init?: RequestInit];
  type FetchURLArgs = [url: string | URL | Request, init?: RequestInit];
  for (let useRequestConstructor of [true, false]) {
    describe(useRequestConstructor ? "Request constructor" : "fetch()", () => {
      function send(args: FetchReqArgs | FetchURLArgs) {
        if (useRequestConstructor) {
          return fetch(new Request(...(args as FetchReqArgs)));
        } else {
          return fetch(...(args as FetchURLArgs));
        }
      }
      for (let headers of [
        {} as {},
        undefined,
        new Headers(),
        new Headers({ x: "y" }),
        new Headers([["x", "y"]]),
        { X: "Y" },
        { headers: { X: "Y" } },
      ]) {
        describe("headers: " + Bun.inspect(headers).replaceAll(/([\n ])/gim, ""), () => {
          it("send on HTTP server with FormData & Blob (roundtrip)", async () => {
            let contentType = "";
            using server = Bun.serve({
              port: 0,
              development: false,
              async fetch(req) {
                const formData = await req.formData();
                contentType = req.headers.get("Content-Type")!;
                return new Response(formData as FormData);
              },
            });

            const form = new FormData();
            form.append("foo", new Blob(["baz"], { type: "text/plain" }), "bar");
            form.append("bar", "baz");

            // @ts-ignore
            const reqBody: FetchURLArgs = [
              server.url,
              {
                body: form,
                headers,
                method: "POST",
              },
            ];
            const res = await send(reqBody);
            const body = await res.formData();
            expect(await (body.get("foo") as Blob).text()).toBe("baz");
            expect(body.get("bar")).toBe("baz");
          });

          it("send on HTTP server with FormData & Bun.file (roundtrip)", async () => {
            let contentType = "";
            using server = Bun.serve({
              port: 0,
              development: false,
              async fetch(req) {
                const formData = await req.formData();
                contentType = req.headers.get("Content-Type")!;
                return new Response(formData as FormData);
              },
            });

            const form = new FormData();
            const file = Bun.file(import.meta.dir + "/form-data-fixture.txt");
            const text = await file.text();
            form.append("foo", file);
            form.append("bar", "baz");

            const reqBody = [
              server.url,
              {
                body: form,

                headers,
                method: "POST",
              },
            ];
            const res = await send(reqBody as FetchURLArgs);
            const body = await res.formData();
            expect(await (body.get("foo") as Blob).text()).toBe(text);
            expect(contentType).toContain("multipart/form-data");
            expect(body.get("bar")).toBe("baz");
            expect(contentType).toContain("multipart/form-data");
          });

          it("send on HTTP server with FormData (roundtrip)", async () => {
            let contentType = "";
            using server = Bun.serve({
              port: 0,
              development: false,
              async fetch(req) {
                const formData = await req.formData();
                contentType = req.headers.get("Content-Type")!;
                return new Response(formData as FormData);
              },
            });

            const form = new FormData();
            form.append("foo", "boop");
            form.append("bar", "baz");

            // @ts-ignore
            const reqBody = [
              server.url,
              {
                body: form,

                headers,
                method: "POST",
              },
            ];
            const res = await send(reqBody as FetchURLArgs);
            const body = await res.formData();
            expect(contentType).toContain("multipart/form-data");
            expect(body.get("foo")).toBe("boop");
            expect(body.get("bar")).toBe("baz");
          });
        });
      }
    });
  }
  describe("Bun.file support", () => {
    describe("roundtrip", () => {
      const path = import.meta.dir + "/form-data-fixture.txt";
      for (const C of [Request, Response]) {
        it(`with ${C.name}`, async () => {
          await Bun.write(path, "foo!");
          const formData = new FormData();
          formData.append("foo", Bun.file(path));
          const response =
            C === Response ? new Response(formData) : new Request({ body: formData, url: "http://example.com" });
          expect(response.headers.get("content-type")?.startsWith("multipart/form-data;")).toBe(true);

          const formData2 = await response.formData();
          expect(formData2 instanceof FormData).toBe(true);
          expect(formData2.get("foo") instanceof Blob).toBe(true);
          expect(await (formData2.get("foo") as Blob).text()).toBe("foo!");
        });
      }
    });

    it("doesnt crash when file is missing", async () => {
      const formData = new FormData();
      formData.append("foo", Bun.file("missing"));
      expect(() => new Response(formData)).toThrow();
    });
  });

  it("Bun.inspect", () => {
    const formData = new FormData();
    formData.append("foo", "bar");
    formData.append("foo", new Blob(["bar"]));
    formData.append("bar", "baz");
    formData.append("boop", Bun.file("missing"));
    expect(Bun.inspect(formData).length > 0).toBe(true);
  });

  describe("non-standard extensions", () => {
    it("should support .length", () => {
      const formData = new FormData();
      formData.append("foo", "bar");
      formData.append("foo", new Blob(["bar"]));
      formData.append("bar", "baz");
      // @ts-ignore
      expect(formData.length).toBe(3);
      formData.delete("foo");
      // @ts-ignore
      expect(formData.length).toBe(1);
      formData.append("foo", "bar");
      // @ts-ignore
      expect(formData.length).toBe(2);
      formData.delete("foo");
      formData.delete("foo");
      // @ts-ignore
      expect(formData.length).toBe(1);
      formData.delete("bar");
      // @ts-ignore
      expect(formData.length).toBe(0);
    });
  });

  describe("URLEncoded", () => {
    test("should parse URL encoded", async () => {
      const response = new Response("foo=bar&baz=qux", {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
      const formData = await response.formData();
      expect(formData instanceof FormData).toBe(true);
      expect(formData.get("foo")).toBe("bar");
      expect(formData.get("baz")).toBe("qux");
    });

    test("should parse URLSearchParams", async () => {
      const searchParams = new URLSearchParams("foo=bar&baz=qux");
      const response = new Response(searchParams);
      expect(response.headers.get("Content-Type")).toBe("application/x-www-form-urlencoded;charset=UTF-8");

      expect(searchParams instanceof URLSearchParams).toBe(true);
      expect(searchParams.get("foo")).toBe("bar");

      const formData = await response.formData();
      expect(formData instanceof FormData).toBe(true);
      expect(formData.get("foo")).toBe("bar");
      expect(formData.get("baz")).toBe("qux");
    });

    test("should parse URL encoded with charset", async () => {
      const response = new Response("foo=bar&baz=qux", {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        },
      });
      const formData = await response.formData();
      expect(formData instanceof FormData).toBe(true);
      expect(formData.get("foo")).toBe("bar");
      expect(formData.get("baz")).toBe("qux");
    });

    test("should parse URL encoded with charset and space", async () => {
      const response = new Response("foo=bar&baz=qux+quux", {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        },
      });
      const formData = await response.formData();
      expect(formData instanceof FormData).toBe(true);
      expect(formData.get("foo")).toBe("bar");
      expect(formData.get("baz")).toBe("qux quux");
    });

    test("should parse URL encoded with charset and plus", async () => {
      const response = new Response("foo=bar&baz=qux+quux", {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        },
      });
      const formData = await response.formData();
      expect(formData instanceof FormData).toBe(true);
      expect(formData.get("foo")).toBe("bar");
      expect(formData.get("baz")).toBe("qux quux");
    });

    it("should handle multiple values", async () => {
      const response = new Response("foo=bar&foo=baz", {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
      const formData = await response.formData();
      expect(formData instanceof FormData).toBe(true);
      expect(formData.getAll("foo")).toEqual(["bar", "baz"]);
    });

    it("should handle slices", async () => {
      using server = Bun.serve({
        port: 0,
        async fetch(req) {
          const body = await req.formData();
          return new Response(body.get("file"), {
            headers: { "Content-Type": "text/plain" },
          });
        },
      });
      const fileSlice = Bun.file(join(import.meta.dir, "..", "fetch", "fixture.html")).slice(5, 10);
      const form = new FormData();
      form.append("file", fileSlice);
      const result = await fetch(server.url, {
        method: "POST",
        body: form,
      }).then(res => res.blob());
      expect(result.size).toBe(5);
      expect(fileSlice.size).toBe(result.size);
    });
  });

  // The minimum repro for this was to not call the .name and .type getter on the Blob
  // But the crux of the issue is that we called dupe() on the Blob, without also incrementing the reference count of the name string.
  // https://github.com/oven-sh/bun/issues/14918
  it("should increment reference count of the name string on Blob", async () => {
    const buffer = new File([Buffer.from(Buffer.alloc(48 * 1024, "abcdefh").toString("base64"), "base64")], "ok.jpg");
    function test() {
      let file = new File([buffer], "ok.jpg");
      file.name;
      file.type;

      let formData = new FormData();
      formData.append("foo", file);
      formData.get("foo");
      (formData.get("foo") as File).name;
      (formData.get("foo") as File).type;
      return formData;
    }
    // Release needs 100k iterations so the freed name string's memory is actually
    // reused; ASAN/debug detect the use-after-free deterministically, so far fewer
    // iterations (with the same 20 forced GC cycles) are enough there.
    const iterations = isASAN || isDebug ? 2000 : 100000;
    const gcEvery = iterations / 20;
    for (let i = 0; i < iterations; i++) {
      test();
      if (i % gcEvery === 0) {
        Bun.gc();
      }
    }
  }, 180000);
});

// The bytes of a Bun.file() body are on disk, and the bytes of an S3 file are
// in a bucket. formData() reads them first, as text() does, and parses what it
// read.
describe.concurrent("formData() of a body whose bytes are not in memory", () => {
  const urlencoded = { "Content-Type": "application/x-www-form-urlencoded" };
  const parsed = { ok: "true", name: "bun" };
  const owners: [string, (body: Bun.BodyInit, headers?: Bun.HeadersInit) => Request | Response][] = [
    ["Request", (body, headers) => new Request("http://example.com/", { method: "POST", body, headers })],
    ["Response", (body, headers) => new Response(body, { headers } as ResponseInit)],
  ];
  const entries = async (owner: Request | Response) => Object.fromEntries(await owner.formData());
  const reason = (promise: Promise<unknown>) =>
    promise.then(
      () => "resolved",
      e => ({ name: e.name, code: e.code, message: e.message, syscall: e.syscall, path: e.path }),
    );

  describe.each(owners)("%s over a Bun.file()", (_, make) => {
    test("multipart with a text entry and a file entry", async () => {
      // A Blob type is lower case. Only the header keeps this boundary as it is.
      const bytes = [
        "--AbC123",
        'Content-Disposition: form-data; name="ok"',
        "",
        "true",
        "--AbC123",
        'Content-Disposition: form-data; name="file"; filename="index.html"',
        "Content-Type: text/html;charset=utf-8",
        "",
        "<h1>Hello</h1>\n",
        "--AbC123--",
        "",
      ].join("\r\n");
      using dir = tempDir("formdata-file-multipart", { "form.bin": bytes });
      const owner = make(Bun.file(join(String(dir), "form.bin")), {
        "Content-Type": "multipart/form-data; boundary=AbC123",
      });
      const form = await owner.formData();
      const file = form.get("file") as File;
      expect({
        names: [...form.keys()],
        ok: form.get("ok"),
        file: { name: file.name, type: file.type, text: await file.text() },
      }).toEqual({
        names: ["ok", "file"],
        ok: "true",
        file: { name: "index.html", type: "text/html;charset=utf-8", text: "<h1>Hello</h1>\n" },
      });
    });

    test("the type of the Bun.file() decides when no header gives one", async () => {
      using dir = tempDir("formdata-file-typed", { "form.bin": "ok=true&name=bun" });
      const typed = Bun.file(join(String(dir), "form.bin"), { type: "application/x-www-form-urlencoded" });
      expect(await entries(make(typed))).toEqual(parsed);
    });

    test("fs.openAsBlob()", async () => {
      using dir = tempDir("formdata-file-open-as-blob", { "form.bin": "ok=true&name=bun" });
      const blob = await openAsBlob(join(String(dir), "form.bin"), { type: "application/x-www-form-urlencoded" });
      expect(await entries(make(blob))).toEqual(parsed);
    });

    test("a file descriptor, and a Blob made from the file", async () => {
      using dir = tempDir("formdata-file-kinds", { "form.bin": "ok=true&name=bun" });
      const path = join(String(dir), "form.bin");
      const fd = openSync(path, "r");
      try {
        expect({
          fd: await entries(make(Bun.file(fd), urlencoded)),
          blob: await entries(make(new Blob([Bun.file(path)]), urlencoded)),
        }).toEqual({ fd: parsed, blob: parsed });
      } finally {
        closeSync(fd);
      }
    });

    test("a slice gives only its own bytes", async () => {
      using dir = tempDir("formdata-file-slice", { "form.bin": "no=1&ok=true&name=bun&no=2" });
      const slice = Bun.file(join(String(dir), "form.bin")).slice(5, 21);
      expect(await entries(make(slice, urlencoded))).toEqual(parsed);
    });

    test("after the body getter turned the file into a stream", async () => {
      using dir = tempDir("formdata-file-body-getter", { "form.bin": "ok=true&name=bun" });
      const owner = make(Bun.file(join(String(dir), "form.bin")), urlencoded);
      expect(owner.body).toBeInstanceOf(ReadableStream);
      expect([await entries(owner), owner.bodyUsed]).toEqual([parsed, true]);
    });

    test("Bun.file().stream()", async () => {
      using dir = tempDir("formdata-file-stream", { "form.bin": "ok=true&name=bun" });
      const owner = make(Bun.file(join(String(dir), "form.bin")).stream(), urlencoded);
      expect([await entries(owner), owner.bodyUsed]).toEqual([parsed, true]);
    });

    test("both sides of a clone()", async () => {
      using dir = tempDir("formdata-file-clone", { "form.bin": "ok=true&name=bun" });
      const path = join(String(dir), "form.bin");
      const sides = async (original: Request | Response) => {
        const clone = original.clone() as Request | Response;
        return [await entries(original), await entries(clone)];
      };
      expect({
        file: await sides(make(Bun.file(path), urlencoded)),
        stream: await sides(make(Bun.file(path).stream(), urlencoded)),
      }).toEqual({ file: [parsed, parsed], stream: [parsed, parsed] });
    });

    test("the file as it is when formData() is called", async () => {
      using dir = tempDir("formdata-file-late", {});
      const path = join(String(dir), "form.bin");
      const owner = make(Bun.file(path), urlencoded);
      await Bun.write(path, "ok=true&name=bun");
      expect(await entries(owner)).toEqual(parsed);
    });

    test("the body is used while the read is pending", async () => {
      using dir = tempDir("formdata-file-pending", { "form.bin": "ok=true&name=bun" });
      const owner = make(Bun.file(join(String(dir), "form.bin")), urlencoded);
      const pending = owner.formData();
      const code = (promise: Promise<unknown>) =>
        promise.then(
          () => "resolved",
          e => e.code,
        );
      expect({
        bodyUsed: owner.bodyUsed,
        formData: await code(owner.formData()),
        text: await code(owner.text()),
        first: Object.fromEntries(await pending),
      }).toEqual({
        bodyUsed: true,
        formData: "ERR_BODY_ALREADY_USED",
        text: "ERR_BODY_ALREADY_USED",
        first: parsed,
      });
    });

    test("a file that cannot be read rejects as text() does", async () => {
      using dir = tempDir("formdata-file-unreadable", {});
      const missing = () => make(Bun.file(join(String(dir), "missing.bin")), urlencoded);
      const directory = () => make(Bun.file(String(dir)), urlencoded);
      const rejections = {
        missing: await reason(missing().formData()),
        directory: await reason(directory().formData()),
      };
      expect(rejections).toEqual({
        missing: await reason(missing().text()),
        directory: await reason(directory().text()),
      });
      expect(rejections.missing).toMatchObject({ code: "ENOENT", syscall: "open" });
      expect(rejections.directory).not.toBe("resolved");
    });

    test("a read failure has the async stack frames, as text() has", async () => {
      using dir = tempDir("formdata-file-stack", {});
      async function level2() {
        await make(Bun.file(join(String(dir), "missing.bin")), urlencoded).formData();
      }
      async function level1() {
        await level2();
      }
      const caught = await level1().then(
        () => null,
        e => e,
      );
      expect(caught?.code).toBe("ENOENT");
      expect(caught.stack).toContain("at async level2");
      expect(caught.stack).toContain("at async level1");
    });

    test("a pending read keeps the promise that script dropped", async () => {
      using dir = tempDir("formdata-file-gc", { "form.bin": "ok=true&name=bun" });
      const path = join(String(dir), "form.bin");
      const count = isDebug || isASAN ? 200 : 2000;
      const seen = new Set<string>();
      let settled = 0;
      const { promise: done, resolve } = Promise.withResolvers<void>();
      const settle = (value: string) => {
        seen.add(value);
        if (++settled === count) resolve();
      };
      for (let i = 0; i < count; i++) {
        // Script keeps no reference to this promise. Only the pending read does.
        make(Bun.file(path), urlencoded)
          .formData()
          .then(
            form => settle(JSON.stringify([...form])),
            e => settle(String(e)),
          );
        if (i % 50 === 49) Bun.gc(true);
      }
      Bun.gc(true);
      await done;
      expect([...seen]).toEqual(['[["ok","true"],["name","bun"]]']);
    });

    test("bytes that do not parse reject as the same bytes in memory do", async () => {
      // The last boundary is there, but the part has no end of headers.
      const bytes = ["--abc123", 'Content-Disposition: form-data; name="value"', "--abc123--", ""].join("\r\n");
      const headers = { "Content-Type": "multipart/form-data; boundary=abc123" };
      using dir = tempDir("formdata-file-invalid", { "form.bin": bytes });
      const rejection = await reason(make(Bun.file(join(String(dir), "form.bin")), headers).formData());
      expect(rejection).toEqual(await reason(make(bytes, headers).formData()));
      expect(rejection).toMatchObject({ name: "TypeError", code: "ERR_FORMDATA_PARSE_ERROR" });
    });
  });

  // `new Response(s3File)` is a redirect with no body. A Request takes an S3
  // file as its body, and so does the Response of a fetch() of its blob: URL.
  test("a body that is an S3 file", async () => {
    const object = "no=1&ok=true&name=bun&no=2";
    const downloads: string[] = [];
    await using bucket = Bun.serve({
      port: 0,
      fetch(request) {
        const { pathname } = new URL(request.url);
        const range = request.headers.get("range");
        downloads.push(range ? `${pathname} ${range}` : pathname);
        if (pathname === "/b/missing") {
          return new Response(
            `<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>`,
            { status: 404, headers: { "Content-Type": "application/xml" } },
          );
        }
        // A bucket that does not look at Range hides a read of the wrong bytes.
        const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range ?? "") ?? [];
        if (start === undefined) return new Response(object);
        return new Response(object.slice(Number(start), Number(end) + 1), {
          status: 206,
          headers: { "Content-Range": `bytes ${start}-${end}/${object.length}` },
        });
      },
    });
    const s3 = new Bun.S3Client({
      accessKeyId: "test",
      secretAccessKey: "test",
      endpoint: bucket.url.href,
      bucket: "b",
    });
    const request = (body: Blob) => new Request("http://example.com/", { method: "POST", body, headers: urlencoded });
    const listed = async (owner: Request | Response) => [...(await owner.formData())];
    const url = URL.createObjectURL(s3.file("form", { type: urlencoded["Content-Type"] }));
    try {
      expect({
        request: await listed(request(s3.file("form"))),
        slice: await listed(request(s3.file("form").slice(5, 21))),
        response: await listed(await fetch(url)),
        // A stream of an S3 file is not this body. It is read as a stream.
        stream: await listed(new Response(s3.file("form").stream(), { headers: urlencoded })),
      }).toEqual({
        request: [
          ["no", "1"],
          ["ok", "true"],
          ["name", "bun"],
          ["no", "2"],
        ],
        slice: [
          ["ok", "true"],
          ["name", "bun"],
        ],
        response: [
          ["no", "1"],
          ["ok", "true"],
          ["name", "bun"],
          ["no", "2"],
        ],
        stream: [
          ["no", "1"],
          ["ok", "true"],
          ["name", "bun"],
          ["no", "2"],
        ],
      });
    } finally {
      URL.revokeObjectURL(url);
    }
    // One download for each call, and a Range only for the slice.
    expect(downloads.splice(0)).toEqual(["/b/form", "/b/form bytes=5-20", "/b/form", "/b/form"]);

    // The failure of the request has the code, the message and the path that text() reports.
    const failure = (promise: Promise<unknown>) =>
      promise.then(
        () => "resolved",
        e => ({ code: e.code, message: e.message, path: e.path }),
      );
    const missing = await failure(request(s3.file("missing")).formData());
    expect(missing).toEqual(await failure(request(s3.file("missing")).text()));
    expect(missing).toMatchObject({ code: "NoSuchKey" });

    // A key that does not fit the signed URL cannot be signed: the read fails
    // before formData() returns. 600 bytes fit the path limit of every platform,
    // and each "+" is three bytes in the URL.
    const unsigned = () => request(s3.file(Buffer.alloc(600, "+").toString()));
    const rejection = await failure(unsigned().formData());
    expect(rejection).toEqual(await failure(unsigned().text()));
    expect(rejection).toMatchObject({ code: "ERR_S3_INVALID_PATH" });
    expect(downloads).toEqual(["/b/missing", "/b/missing"]);
  });

  test("the Response of a fetch() of a blob: URL of a Bun.file()", async () => {
    using dir = tempDir("formdata-file-blob-url", { "form.bin": "ok=true&name=bun" });
    const url = URL.createObjectURL(Bun.file(join(String(dir), "form.bin"), { type: urlencoded["Content-Type"] }));
    try {
      expect(await entries(await fetch(url))).toEqual(parsed);
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  // The limit on the length of a string is global to a process, so this case
  // has a process of its own.
  test("bytes over the string limit reject as the same bytes in memory do", async () => {
    using dir = tempDir("formdata-file-string-limit", {});
    const script = `
      const { setSyntheticAllocationLimitForTesting } = require("bun:internal-for-testing");
      const headers = ${JSON.stringify(urlencoded)};
      const path = ${JSON.stringify(join(String(dir), "form.bin"))};
      const bytes = Buffer.alloc(2 * 1024 * 1024, "a");
      await Bun.write(path, bytes);
      setSyntheticAllocationLimitForTesting(1024 * 1024);
      const code = promise => promise.then(() => "resolved", e => e.code);
      const request = body => new Request("http://example.com/", { method: "POST", body, headers });
      console.log(JSON.stringify({
        file: [await code(new Response(Bun.file(path), { headers }).formData()), await code(request(Bun.file(path)).formData())],
        memory: [await code(new Response(bytes, { headers }).formData()), await code(request(bytes).formData())],
      }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({
      stdout: JSON.stringify({
        file: ["ERR_STRING_TOO_LONG", "ERR_STRING_TOO_LONG"],
        memory: ["ERR_STRING_TOO_LONG", "ERR_STRING_TOO_LONG"],
      }),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // Bun.stdin is a file too. Its stream is lifted back into that file before the read.
  test("a stream of Bun.stdin that is a pipe", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const form = await new Response(Bun.stdin.stream(), { headers: ${JSON.stringify(urlencoded)} }).formData();
         console.log(JSON.stringify([...form]));`,
      ],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.write("ok=true&name=bun");
    await proc.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: '[["ok","true"],["name","bun"]]', stderr: "" });
    expect(exitCode).toBe(0);
  });

  // The read is on another thread when the Worker exits, so the teardown
  // hands it ECANCELED and the read has to free itself. As in
  // worker-late-completion.test.ts, BUN_DEBUG_TEST_WORKER_TEARDOWN_GATE holds
  // the read back until the teardown waits for it, and the runtime then names
  // it on stderr.
  test.skipIf(!isDebug && !isASAN)("a Worker that exits while the file is read", async () => {
    const worker = `
      new Response(Bun.file(process.execPath).slice(0, 65536), { headers: ${JSON.stringify(urlencoded)} }).formData().catch(() => {});
      setImmediate(() => setImmediate(() => process.exit(0)));
    `;
    const host = `
      const url = URL.createObjectURL(new Blob([${JSON.stringify(worker)}], { type: "text/javascript" }));
      new Worker(url).addEventListener("close", event => { process.exitCode = event.code; });
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", host],
      env: { ...bunEnv, BUN_DEBUG_TEST_WORKER_TEARDOWN_GATE: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const late = stderr
      .split("\n")
      .some(line => line.startsWith("[vm] late completion from ") && line.includes("read_file.rs"));
    expect({ late, exitCode, detail: late && exitCode === 0 ? "" : stdout + stderr }).toEqual({
      late: true,
      exitCode: 0,
      detail: "",
    });
  });
});

// https://github.com/oven-sh/bun/issues/14988
describe("Content-Type header propagation", () => {
  describe("https://github.com/oven-sh/bun/issues/21011", () => {
    function createRequest() {
      const formData = new FormData();
      formData.append("key", "value");

      return new Request("https://example.com/api/endpoint", {
        method: "POST",
        body: formData,
      });
    }

    test("without checking body", async () => {
      const request = createRequest();
      expect(request.headers.get("Content-Type")).toStartWith("multipart/form-data");
    });

    test("check body", async () => {
      const request = createRequest();
      if (!request.body) {
        expect.unreachable();
      }
      expect(request.headers.get("Content-Type")).toStartWith("multipart/form-data");
    });
  });

  // Shared test server that validates multipart/form-data content-type
  function createTestServer() {
    return Bun.serve({
      port: 0,
      async fetch(req) {
        if (!req.headers.get("content-type")?.includes("multipart/form-data")) {
          return new Response("Missing multipart/form-data content-type", { status: 400 });
        }
        const body = await req.formData();
        expect((body.get("foo") as File).size).toBe(3);
        return new Response("Success", { status: 200 });
      },
    });
  }

  // Custom Request subclass for testing inheritance
  class CustomRequest extends Request {
    constructor(input: string | URL | Request, init?: RequestInit) {
      super(input as any, init);
    }
  }

  const testCases = [
    {
      name: "new Request({body: FormData}) (subclass) -> fetch(request)",
      async testFn(server: ReturnType<typeof createTestServer>) {
        const fd = new FormData();
        fd.append("foo", new Blob(["bar"]));
        const request = new CustomRequest(server.url.toString(), {
          method: "POST",
          body: fd,
        });
        return fetch(request);
      },
    },
    {
      name: "FormData -> Request (subclass) -> ReadableStream -> fetch(request)",
      async testFn(server: ReturnType<typeof createTestServer>) {
        const fd = new FormData();
        fd.append("foo", new Blob(["bar"]));
        const request = new CustomRequest(server.url.toString(), {
          method: "POST",
          body: fd,
        });
        return fetch(request);
      },
    },
    {
      name: "FormData -> Request (subclass) -> fetch(url, {body: request.blob()})",
      async testFn(server: ReturnType<typeof createTestServer>) {
        const fd = new FormData();
        fd.append("foo", new Blob(["bar"]));
        const request = new CustomRequest(server.url.toString(), {
          method: "POST",
          body: fd,
        });
        return fetch(server.url.toString(), {
          method: "POST",
          body: await request.blob(),
        });
      },
    },
    {
      name: "FormData -> Request -> fetch(request)",
      async testFn(server: ReturnType<typeof createTestServer>) {
        const fd = new FormData();
        fd.append("foo", new Blob(["bar"]));
        const request = new Request(server.url.toString(), {
          method: "POST",
          body: fd,
        });
        return fetch(request);
      },
    },
  ];

  testCases.forEach(({ name, testFn }) => {
    it(name, async () => {
      using server = createTestServer();
      const res = await testFn(server);
      expect(res.status).toBe(200);
    });
  });
});

it("drops multipart part Content-Type values containing control characters", async () => {
  // A part header line is only terminated by an exact \r\n, so a bare LF can
  // survive inside a part's Content-Type value. That value becomes the
  // resulting File's `type` and is later written verbatim into outgoing
  // request headers, so it must never contain control bytes.
  const body =
    "--formboundary\r\n" +
    "Content-Type: image/png\nX-Injected-Header: injected-value\r\n" +
    'Content-Disposition: form-data; name="evil"; filename="evil.bin"\r\n' +
    "\r\n" +
    "hello\r\n" +
    "--formboundary\r\n" +
    "Content-Type: text/plain\r\n" +
    'Content-Disposition: form-data; name="good"; filename="good.txt"\r\n' +
    "\r\n" +
    "world\r\n" +
    "--formboundary\r\n" +
    "Content-Type: text/plain;\tcharset=utf-8\r\n" +
    'Content-Disposition: form-data; name="tabbed"; filename="tabbed.txt"\r\n' +
    "\r\n" +
    "tabbed\r\n" +
    "--formboundary--\r\n";

  const response = new Response(body, {
    headers: { "Content-Type": "multipart/form-data; boundary=formboundary" },
  });
  const formData = await response.formData();

  const evil = formData.get("evil") as File;
  expect(evil instanceof Blob).toBe(true);
  // The part body itself is preserved; only the malformed Content-Type is discarded.
  expect(await evil.text()).toBe("hello");
  expect(evil.type).not.toContain("\n");
  expect(evil.type).not.toContain("\r");
  expect(evil.type.toLowerCase()).not.toContain("x-injected-header");

  // A well-formed part Content-Type is still honored.
  const good = formData.get("good") as File;
  expect(good instanceof Blob).toBe(true);
  expect(await good.text()).toBe("world");
  expect(good.type).toBe("text/plain");

  // An interior HTAB is valid optional whitespace, not an injection vector.
  const tabbed = formData.get("tabbed") as File;
  expect(tabbed instanceof Blob).toBe(true);
  expect(await tabbed.text()).toBe("tabbed");
  expect(tabbed.type).toBe("text/plain;\tcharset=utf-8");
});

test("FormData.toJSON merges duplicate numeric field names into an array", async () => {
  // Field names that parse as array indices ("0", "1", ...) are stored as indexed
  // properties on the serialized object; appending the same numeric name more than
  // once must merge into an array (like any other duplicate key) instead of
  // terminating the process during serialization.
  const script = `
    const fd = new FormData();
    fd.append("0", "a");
    fd.append("0", "b");
    fd.append("0", "c");
    fd.append("tag", "x");
    fd.append("tag", "y");
    console.log(JSON.stringify(fd.toJSON()));

    // Same shape arriving from an untrusted multipart request body.
    const body =
      '--foo\\r\\nContent-Disposition: form-data; name="0"\\r\\n\\r\\nfirst\\r\\n--foo\\r\\nContent-Disposition: form-data; name="0"\\r\\n\\r\\nsecond\\r\\n--foo--\\r\\n';
    const parsed = await new Response(body, {
      headers: { "Content-Type": "multipart/form-data; boundary=foo" },
    }).formData();
    console.log(JSON.stringify(parsed.toJSON()));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim().split("\n")).toEqual(['{"0":["a","b","c"],"tag":["x","y"]}', '{"0":["first","second"]}']);
  expect(exitCode).toBe(0);
});

describe("USVString conversion of lone surrogates", () => {
  const loneHigh = "a\uD800b";
  const loneLow = "a\uDC00b";
  const replaced = "a\uFFFDb";

  it("get/getAll/has find an entry appended under a lone surrogate name", () => {
    const formData = new FormData();
    formData.append(loneHigh, "1");
    formData.append(loneHigh, "2");

    expect([...formData.keys()]).toEqual([replaced, replaced]);
    expect(formData.has(loneHigh)).toBe(true);
    expect(formData.get(loneHigh)).toBe("1");
    expect(formData.getAll(loneHigh)).toEqual(["1", "2"]);

    // the converted spelling names the same entry
    expect(formData.get(replaced)).toBe("1");
    expect(formData.getAll(replaced)).toEqual(["1", "2"]);
  });

  it("lone high and lone low surrogates both convert to U+FFFD", () => {
    const formData = new FormData();
    formData.append(loneLow, "low");
    expect(formData.get(loneLow)).toBe("low");
    expect(formData.get(loneHigh)).toBe("low");
  });

  it("finds a Blob entry appended under a lone surrogate name", async () => {
    const formData = new FormData();
    formData.append(loneHigh, new Blob(["bar"]), "mynameis.txt");

    const entry = formData.get(loneHigh) as File;
    expect(entry).toBeInstanceOf(Blob);
    expect(entry.name).toBe("mynameis.txt");
    expect(await entry.text()).toBe("bar");
    expect(formData.getAll(loneHigh)).toHaveLength(1);
  });

  it("leaves valid surrogate pairs alone", () => {
    const formData = new FormData();
    formData.append("\u{1F600}", "emoji");
    expect(formData.get("\u{1F600}")).toBe("emoji");
    expect(formData.getAll("\u{1F600}")).toEqual(["emoji"]);
    expect(formData.get("\uFFFD")).toBeNull();
  });
});

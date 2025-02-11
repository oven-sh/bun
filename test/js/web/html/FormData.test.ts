import { describe, expect, it, test } from "bun:test";
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

        const request = await new Response(formData).formData();
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
              expect(c).toBe(b);
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

    const reqBody = new Request(server.url, {
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
        return new Response(formData);
      },
    });

    const reqBody = new Request(server.url, {
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
  type FetchURLArgs = [url: string | URL | Request, init?: FetchRequestInit];
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
                return new Response(formData);
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
                return new Response(formData);
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
                return new Response(formData);
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
      formData.get("foo")!.name;
      formData.get("foo")!.type;
      return formData;
    }
    for (let i = 0; i < 100000; i++) {
      test();
      if (i % 5000 === 0) {
        Bun.gc();
      }
    }
  });
});

import { S3Client } from "bun";
import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isPosix, isWindows, tempDir } from "harness";
import { closeSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
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

  describe("a file or S3 part is read when the body is read", () => {
    // The parts of a multipart body, by name.
    async function partsOf(body: Response | Request) {
      const parts: Record<string, string> = {};
      for (const [name, value] of await body.formData()) {
        parts[name] = typeof value === "string" ? value : await value.text();
      }
      return parts;
    }

    function formOf(parts: Record<string, Blob>) {
      const form = new FormData();
      form.append("before", "a string");
      for (const [name, part] of Object.entries(parts)) form.append(name, part, name);
      form.append("after", new Blob(["in memory"]), "after");
      return form;
    }

    test.skipIf(isWindows)("a FIFO part with no writer does not block the constructor", async () => {
      using dir = tempDir("formdata-fifo", {});
      const fifo = join(String(dir), "fifo");
      expect(Bun.spawnSync({ cmd: ["mkfifo", fifo] }).exitCode).toBe(0);

      await using reader = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const form = new FormData();
            form.append("fifo", Bun.file(process.argv[1]), "fifo");
            const response = new Response(form);
            console.log("constructed");
            const parsed = await response.formData();
            console.log(await parsed.get("fifo").text());
          `,
          fifo,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });

      // The writer starts only after the constructor returned.
      const stdout = reader.stdout.getReader();
      const decoder = new TextDecoder();
      let output = "";
      while (!output.includes("constructed\n")) {
        const { value, done } = await stdout.read();
        if (done) break;
        output += decoder.decode(value, { stream: true });
      }
      expect(output).toBe("constructed\n");

      await using writer = Bun.spawn({
        cmd: [bunExe(), "-e", `require("fs").writeFileSync(process.argv[1], "from the writer")`, fifo],
        env: bunEnv,
        stderr: "inherit",
      });
      while (true) {
        const { value, done } = await stdout.read();
        if (done) break;
        output += decoder.decode(value, { stream: true });
      }

      expect({
        output,
        reader: [await reader.exited, reader.signalCode],
        writer: [await writer.exited, writer.signalCode],
      }).toEqual({
        output: "constructed\nfrom the writer\n",
        reader: [0, null],
        writer: [0, null],
      });
    });

    test("a Bun.stdin part that is a pipe arrives whole", async () => {
      const input = Buffer.alloc(300_000, "0123456789abcdef");
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const form = new FormData();
            form.append("stdin", Bun.stdin, "stdin");
            const parsed = await new Response(form).formData();
            const bytes = await parsed.get("stdin").bytes();
            console.log(bytes.length, String(Bun.hash(bytes)));
          `,
        ],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      proc.stdin.write(input);
      await proc.stdin.end();
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: `${input.length} ${Bun.hash(input)}\n`,
        stderr: "",
        exitCode: 0,
      });
    });

    test("an S3 part is downloaded", async () => {
      const object = "0123456789";
      const requests: [string, string, string | null][] = [];
      using server = Bun.serve({
        port: 0,
        fetch(request) {
          const range = request.headers.get("range");
          requests.push([request.method, new URL(request.url).pathname, range]);
          const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? "");
          if (!match) return new Response(object);
          return new Response(object.slice(Number(match[1]), Number(match[2]) + 1), { status: 206 });
        },
      });
      const s3 = new S3Client({
        endpoint: server.url.href,
        accessKeyId: "test",
        secretAccessKey: "test",
        bucket: "bucket",
      });

      const response = new Response(formOf({ whole: s3.file("key"), slice: s3.file("key").slice(2, 5) }));
      // Body extraction sends no request.
      expect(requests).toEqual([]);

      expect(await partsOf(response)).toEqual({
        before: "a string",
        whole: "0123456789",
        slice: "234",
        after: "in memory",
      });
      expect(requests).toEqual([
        ["GET", "/bucket/key", null],
        ["GET", "/bucket/key", "bytes=2-4"],
      ]);
    });

    test("an S3 part that fails rejects the read of the body", async () => {
      using server = Bun.serve({
        port: 0,
        fetch: () =>
          new Response(
            `<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>`,
            { status: 404, headers: { "content-type": "application/xml" } },
          ),
      });
      const s3 = new S3Client({
        endpoint: server.url.href,
        accessKeyId: "test",
        secretAccessKey: "test",
        bucket: "bucket",
      });
      const response = new Response(formOf({ missing: s3.file("key") }));
      expect(
        await response.text().then(
          () => "resolved",
          error => error.code,
        ),
      ).toBe("NoSuchKey");
    });

    test("a part has the bytes that the file has when the body is read", async () => {
      using dir = tempDir("formdata-lazy", { "file.txt": "at construction" });
      const path = join(String(dir), "file.txt");
      const response = new Response(formOf({ file: Bun.file(path) }));
      writeFileSync(path, "at the read");
      expect(await partsOf(response)).toEqual({
        before: "a string",
        file: "at the read",
        after: "in memory",
      });
    });

    test.skipIf(!isLinux)("a procfs part is not empty", async () => {
      const response = new Response(formOf({ cmdline: Bun.file("/proc/self/cmdline") }));
      expect((await partsOf(response)).cmdline).toBe(readFileSync("/proc/self/cmdline", "utf8"));
    });

    test.skipIf(!isPosix)("a device part gives what a read of the device gives", async () => {
      const response = new Response(formOf({ null: Bun.file("/dev/null"), zero: Bun.file("/dev/zero").slice(0, 4) }));
      expect(await partsOf(response)).toEqual({
        before: "a string",
        null: "",
        zero: "\0\0\0\0",
        after: "in memory",
      });
    });

    describe("a file descriptor part", () => {
      function cursorAt7(path: string) {
        const fd = openSync(path, "r");
        readSync(fd, Buffer.alloc(7), 0, 7, null);
        return fd;
      }

      test("reads from the cursor of the descriptor", async () => {
        using dir = tempDir("formdata-fd", { "file.txt": "0123456789" });
        const fd = cursorAt7(join(String(dir), "file.txt"));
        try {
          const parts = await partsOf(new Response(formOf({ first: Bun.file(fd), second: Bun.file(fd) })));
          expect([parts.first, parts.second]).toEqual(["789", ""]);
        } finally {
          closeSync(fd);
        }
      });

      // On Windows, blob.text() reads a descriptor from position 0.
      test.skipIf(isWindows)("has the bytes that blob.text() gives", async () => {
        using dir = tempDir("formdata-fd", { "file.txt": "0123456789" });
        const path = join(String(dir), "file.txt");
        let fd = cursorAt7(path);
        const fromBlob = await Bun.file(fd).text();
        closeSync(fd);
        fd = cursorAt7(path);
        try {
          expect((await partsOf(new Response(formOf({ file: Bun.file(fd) })))).file).toBe(fromBlob);
        } finally {
          closeSync(fd);
        }
      });

      test("reads the file that was open at construction", async () => {
        using dir = tempDir("formdata-fd", { "file.txt": "the file", "other.txt": "another file" });
        const fd = openSync(join(String(dir), "file.txt"), "r");
        const response = new Response(formOf({ file: Bun.file(fd) }));
        closeSync(fd);
        // The number of the closed descriptor goes to the next open.
        const other = openSync(join(String(dir), "other.txt"), "r");
        try {
          expect(other).toBe(fd);
          expect((await partsOf(response)).file).toBe("the file");
        } finally {
          closeSync(other);
        }
      });
    });

    describe("a consumer gets the same body as before", () => {
      const content = "0123456789";
      function fixture() {
        const dir = tempDir("formdata-consumers", { "file.txt": content });
        const path = join(String(dir), "file.txt");
        return {
          path,
          form: () => formOf({ file: Bun.file(path), slice: Bun.file(path).slice(2, 5) }),
          [Symbol.dispose]: () => dir[Symbol.dispose](),
        };
      }
      const expected = { before: "a string", file: content, slice: "234", after: "in memory" };
      // A body is what a multipart parser makes of the text and its Content-Type.
      const parse = (text: string | Uint8Array, contentType: string | null) =>
        partsOf(new Response(text, { headers: { "content-type": contentType! } }));

      test.each(["text", "bytes", "arrayBuffer", "blob", "body"] as const)("%s", async method => {
        using files = fixture();
        for (const body of [
          new Response(files.form()),
          new Request("http://example.com", { method: "POST", body: files.form() }),
        ]) {
          const contentType = body.headers.get("content-type");
          expect(contentType).toStartWith("multipart/form-data; boundary=");
          let bytes: Uint8Array;
          if (method === "body") {
            bytes = await new Response(body.body).bytes();
          } else if (method === "blob") {
            const blob = await body.blob();
            expect(blob.type).toBe(contentType!);
            bytes = await blob.bytes();
          } else {
            bytes = new Uint8Array(await new Response(await body[method]()).arrayBuffer());
          }
          expect(await parse(bytes, contentType)).toEqual(expected);
          expect(body.bodyUsed).toBe(true);
        }
      });

      test("clone() of a body that nothing has read", async () => {
        using files = fixture();
        const response = new Response(files.form());
        const clone = response.clone();
        expect(clone.headers.get("content-type")).toBe(response.headers.get("content-type"));
        expect([await partsOf(response), await partsOf(clone)]).toEqual([expected, expected]);
      });

      test("Bun.serve sends a Content-Length", async () => {
        using files = fixture();
        using server = Bun.serve({
          port: 0,
          routes: { "/static": new Response(files.form()) },
          fetch: () => new Response(files.form()),
        });
        for (const path of ["/", "/static"]) {
          const response = await fetch(new URL(path, server.url));
          const text = await response.text();
          expect({
            status: response.status,
            transferEncoding: response.headers.get("transfer-encoding"),
            length: Number(response.headers.get("content-length")) === text.length,
            parts: await parse(text, response.headers.get("content-type")),
          }).toEqual({ status: 200, transferEncoding: null, length: true, parts: expected });

          // HEAD has the framing of GET.
          const head = await fetch(new URL(path, server.url), { method: "HEAD" });
          expect({
            status: head.status,
            transferEncoding: head.headers.get("transfer-encoding"),
            length: head.headers.get("content-length"),
            text: await head.text(),
          }).toEqual({
            status: 200,
            transferEncoding: null,
            length: response.headers.get("content-length"),
            text: "",
          });
        }
      });

      test("fetch sends a Content-Length, also after a 307", async () => {
        using files = fixture();
        const received: unknown[] = [];
        using server = Bun.serve({
          port: 0,
          async fetch(request) {
            const { pathname } = new URL(request.url);
            const text = await request.text();
            received.push({
              pathname,
              length: Number(request.headers.get("content-length")) === text.length,
              transferEncoding: request.headers.get("transfer-encoding"),
              parts: await parse(text, request.headers.get("content-type")),
            });
            if (pathname.startsWith("/redirect")) {
              return new Response(null, {
                status: 307,
                headers: { location: pathname.replace("/redirect", "/final") },
              });
            }
            return new Response("ok");
          },
        });
        const hop = (pathname: string) => ({ pathname, length: true, transferEncoding: null, parts: expected });

        const fromInit = await fetch(new URL("/redirect/init", server.url), { method: "POST", body: files.form() });
        const fromRequest = await fetch(
          new Request(new URL("/redirect/request", server.url), { method: "POST", body: files.form() }),
        );
        expect([await fromInit.text(), await fromRequest.text()]).toEqual(["ok", "ok"]);
        expect(received).toEqual([
          hop("/redirect/init"),
          hop("/final/init"),
          hop("/redirect/request"),
          hop("/final/request"),
        ]);
      });

      test.skipIf(isWindows)("Bun.spawnSync stdin and a shell redirect", async () => {
        using files = fixture();

        const toSpawn = new Response(files.form());
        const spawnType = toSpawn.headers.get("content-type");
        const spawned = Bun.spawnSync({ cmd: ["cat"], stdin: toSpawn });
        expect(await parse(spawned.stdout, spawnType)).toEqual(expected);

        const toShell = new Response(files.form());
        const shellType = toShell.headers.get("content-type");
        expect(await parse(await Bun.$`cat < ${toShell}`.text(), shellType)).toEqual(expected);
      });

      test("Bun.write", async () => {
        using files = fixture();
        using dir = tempDir("formdata-write", {});
        const destination = join(String(dir), "body");
        const response = new Response(files.form());
        const contentType = response.headers.get("content-type");
        const written = await Bun.write(destination, response);
        const bytes = readFileSync(destination);
        expect(written).toBe(bytes.length);
        expect(await parse(bytes, contentType)).toEqual(expected);
      });
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
        expect(body.get("foo")!.size).toBe(3);
        return new Response("Success", { status: 200 });
      },
    });
  }

  // Custom Request subclass for testing inheritance
  class CustomRequest extends Request {
    constructor(input: string | URL | Request, init?: RequestInit) {
      super(input, init);
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

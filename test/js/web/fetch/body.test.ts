import { file, readableStreamToBlob, spawn, version } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, exampleSite, tempDir } from "harness";
import { join } from "node:path";

const exampleServer = exampleSite("http");

const bodyTypes = [
  {
    body: Request,
    fn: (body?: BodyInit | null, headers?: HeadersInit) =>
      new Request("http://example.com/", {
        method: "POST",
        body,
        headers,
      }),
  },
  {
    body: Response,
    fn: (body?: BodyInit | null, headers?: HeadersInit) => new Response(body, { headers }),
  },
];

const bufferTypes = [
  ArrayBuffer,
  SharedArrayBuffer,
  Buffer,
  Uint8Array,
  Uint8ClampedArray,
  Uint16Array,
  Uint32Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Float16Array,
  Float32Array,
  Float64Array,
];

const utf8 = [
  {
    string: "",
    buffer: new Uint8Array(0),
  },
  {
    string: "Hello world",
    buffer: new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64]),
  },
  {
    string: "🫠",
    buffer: new Uint8Array([0xf0, 0x9f, 0xab, 0xa0]),
  },
  {
    string: "⁉️",
    buffer: new Uint8Array([0xe2, 0x81, 0x89, 0xef, 0xb8, 0x8f]),
  },
];

for (const { body, fn } of bodyTypes) {
  describe(body.name, () => {
    describe("constructor", () => {
      test("undefined", () => {
        expect(() => fn()).not.toThrow();
        expect(fn().body).toBeNull();
      });
      test("null", () => {
        expect(() => fn(null)).not.toThrow();
        expect(fn(null).body).toBeNull();
      });
      describe("string", () => {
        for (const { string } of utf8) {
          test(`"${string}"`, async () => {
            expect(() => fn(string)).not.toThrow();
            expect(await fn(string).text()).toBe(string);
          });
        }
      });
      for (const bufferType of bufferTypes) {
        const buffers = [
          {
            label: "empty buffer",
            buffer: () => new bufferType(0),
          },
          {
            label: "small buffer",
            buffer: () => crypto.getRandomValues(new bufferType(1_000)),
          },
          {
            label: "large buffer",
            buffer: () => crypto.getRandomValues(new bufferType(1_000_000)),
          },
        ];
        describe(bufferType.name, () => {
          for (const { label, buffer } of buffers) {
            test(label, async () => {
              const actual = buffer();
              expect(() => fn(actual)).not.toThrow();
              expect(await fn(actual).arrayBuffer()).toStrictEqual(arrayBuffer(actual));
            });
          }
        });
      }
      describe("Blob", () => {
        const blobs = [
          {
            label: "empty blob",
            blob: () => new Blob(),
          },
          {
            label: "blob with 1 part",
            blob: () => new Blob(["hello"]),
          },
          {
            label: "blob with multiple parts",
            blob: () => new Blob(["hello", "world", new Blob(["!"])]),
          },
          {
            label: "blob with content-type",
            blob: () =>
              new Blob(["{}"], {
                type: "application/json",
              }),
          },
        ];
        for (const { label, blob } of blobs) {
          test(label, async () => {
            const actual = blob();
            expect(() => fn(actual)).not.toThrow();
            expect(await fn(actual).blob()).toStrictEqual(actual);
          });
        }
      });
      describe("FormData", () => {
        const forms = [
          {
            label: "empty form",
            formData: (form: FormData) => {},
          },
          {
            label: "form with text entry",
            formData: (form: FormData) => {
              form.set("value", "true");
            },
          },
          {
            label: "form with file entry",
            formData: (form: FormData) => {
              form.set("first", new Blob([]), "first.txt");
              form.set(
                "second",
                new Blob(["[]"], {
                  type: "application/json",
                }),
                "second.json",
              );
            },
          },
          {
            label: "form with Bun.file()",
            formData: (form: FormData) => {
              const url = new URL("resources/index.html", import.meta.url);
              form.set("index", file(url), "index.html");
            },
          },
        ];
        for (const { label, formData } of forms) {
          test(label, async () => {
            const actual = new FormData();
            formData(actual);
            expect(() => fn(actual)).not.toThrow();
            expect(await fn(actual).formData()).toStrictEqual(actual);
          });
        }
      });
      describe("ReadableStream", () => {
        const streams = [
          {
            label: "direct stream",
            stream: () =>
              new ReadableStream({
                type: "direct",
                async pull(controller) {
                  await controller.write("bye\n");
                  await controller.end();
                },
              }),
            content: "bye\n",
            skip: true, // hangs
          },
          {
            label: "Bun.file() stream",
            stream: () => {
              const url = new URL("resources/index.html", import.meta.url);
              const { readable } = file(url);
              return readable;
            },
            content: /Example Domain/,
            skip: true, // fails, text is empty
          },
          {
            label: "Bun.spawn() stream",
            stream: async () => {
              const { stdout } = await spawn({
                cmd: [process.argv0, "--version"],
              });
              expect(stdout).not.toBeUndefined();
              return stdout as ReadableStream;
            },
            content: new RegExp(version),
          },
          {
            label: "fetch() stream",
            stream: async () => {
              const { body } = await fetch(exampleServer.url);
              expect(body).not.toBeNull();
              return body as ReadableStream;
            },
            content: /Example Domain/,
          },
        ];
        for (const { label, stream, content, skip } of streams) {
          const it = skip ? test.skip : test;
          it(label, async () => {
            expect(async () => fn(await stream())).not.toThrow();
            const text = await fn(await stream()).text();
            if (typeof content === "string") {
              expect(text).toBe(content);
            } else {
              expect(content.test(text)).toBe(true);
            }
          });
        }
      });
      test(body.name, async () => {
        for (const { string, buffer } of utf8) {
          expect(() => {
            fn(buffer);
          }).not.toThrow();
          expect(await fn(buffer).text()).toBe(string);
        }
      });
    });
    for (const { string, buffer } of utf8) {
      describe("arrayBuffer()", () => {
        test("undefined", async () => {
          expect(await fn().arrayBuffer()).toStrictEqual(new ArrayBuffer(0));
        });
        test("null", async () => {
          expect(await fn(null).arrayBuffer()).toStrictEqual(new ArrayBuffer(0));
        });
        test(`"${string}"`, async () => {
          expect(await fn(string).arrayBuffer()).toStrictEqual(buffer.buffer);
        });
      });
      describe("bytes()", () => {
        test("undefined", async () => {
          expect(await fn().bytes()).toStrictEqual(new Uint8Array(0));
        });
        test("null", async () => {
          expect(await fn(null).bytes()).toStrictEqual(new Uint8Array(0));
        });
        test(`"${string}"`, async () => {
          expect(await fn(string).bytes()).toStrictEqual(new Uint8Array(buffer));
        });
      });
      describe("text()", () => {
        test("undefined", async () => {
          expect(await fn().text()).toBe("");
        });
        test("null", async () => {
          expect(await fn(null).text()).toBe("");
        });
        test(`"${string}"`, async () => {
          expect(await fn(buffer).text()).toBe(string);
        });
      });
    }
    describe("json()", () => {
      const validTests: [string, unknown][] = [
        ["true", true],
        ["1234", 1234],
        ['"hello"', "hello"],
        ["null", null],
        ['["abc",123]', ["abc", 123]],
        ["{}", {}],
        ["[[[[[[]]]]]]", [[[[[[]]]]]]],
        ['{"a":1}', { a: 1 }],
        ['{"emoji":"😀"}', { emoji: "😀" }],
        ["{}\n", {}],
        ["\n[]\n", []],
        ["\ttrue\n", true],
        ['\r\n{"hello":1}\r\n', { hello: 1 }],
      ];
      for (const [actual, expected] of validTests) {
        test(actual.trim(), async () => {
          expect(await fn(actual).json()).toStrictEqual(expected);
        });
      }
      const invalidTests: string[] = [
        "",
        " ",
        "undefined",
        "Infinity",
        "NaN",
        "10n",
        "{",
        "[",
        "{{}}",
        "()",
        "[[]",
        "{a:1}",
        '{1:"a"}',
        '{"a":1,}',
        "[1,2,]",
        "'hello'",
        '"hello',
        "😀",
      ];
      for (const actual of invalidTests) {
        test(actual || "<empty>", async () => {
          expect(async () => await fn(actual).json()).toThrow(SyntaxError);
        });
      }
    });
    describe("formData()", () => {
      test("undefined", () => {
        expect(async () => await fn().formData()).toThrow(TypeError);
      });
      test("null", () => {
        expect(async () => await fn(null).formData()).toThrow(TypeError);
      });
      const validTests = [
        {
          label: "multipart with no entries",
          headers: {
            "Content-Type": "multipart/form-data; boundary=def456",
          },
          body: ["--def456--"],
          formData: (form: FormData) => {},
        },
        {
          label: "multipart with text entry",
          headers: {
            "Content-Type": "multipart/form-data; boundary=abc123",
          },
          body: ["--abc123", 'Content-Disposition: form-data; name="metadata"', "", '{"ok":true}\n', "--abc123--", ""],
          formData: (form: FormData) => {
            form.set("metadata", '{"ok":true}\n');
          },
        },
        {
          label: "multipart with file entry",
          headers: {
            "Content-Type": "multipart/form-data; boundary=--456789",
          },
          body: [
            "----456789",
            'Content-Disposition: form-data; name="file"; filename="index.html"',
            "Content-Type: text/html;charset=utf-8",
            "",
            "<html><body><h1>Hello</h1></body></html>\n",
            "----456789--",
            "",
          ],
          formData: (form: FormData) => {
            const file = new Blob(["<html><body><h1>Hello</h1></body></html>\n"], {
              type: "text/html;charset=utf-8",
            });
            form.set("file", file, "index.html");
          },
        },
        {
          label: "multipart with file that has utf-8 filename (rfc5987)",
          headers: {
            "Content-Type": "multipart/form-data; boundary=--abcdefg",
          },
          body: [
            "----abcdefg",
            "Content-Disposition: form-data; name=\"emoji\"; filename*UTF-8''%F0%9F%9A%80.js",
            "Content-Type: application/javascript;charset=utf-8",
            "",
            'console.log("🚀");\n',
            "----abcdefg--",
            "",
          ],
          formData: (form: FormData) => {
            const file = new Blob(['console.log("🚀");\n'], {
              type: "application/javascript;charset=utf-8",
            });
            form.set("emoji", file, "🚀.js");
          },
        },
        {
          label: "multipart with unquoted name",
          headers: {
            "Content-Type": "multipart/form-data; boundary=--123456",
          },
          body: [
            "----123456",
            "Content-Disposition: form-data; name=value",
            "Content-Type: text/plain",
            "",
            "goodbye",
            "----123456--",
            "",
          ],
          formData: (form: FormData) => {
            form.set("value", "goodbye");
          },
        },
        {
          label: "url encoded with no entries",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: [],
          formData: (form: FormData) => {},
        },
        {
          label: "url encoded",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: ["ok=true&name=bun"],
          formData: (form: FormData) => {
            form.set("ok", "true");
            form.set("name", "bun");
          },
        },
        {
          label: "url encoded with utf-8 entry",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
          },
          body: ["emoji=%F0%9F%8F%B3%EF%B8%8F%E2%80%8D%F0%9F%8C%88"],
          formData: (form: FormData) => {
            form.set("emoji", "🏳️‍🌈");
          },
        },
      ];
      for (const { label, body, headers, formData } of validTests) {
        test(label, async () => {
          const expected = new FormData();
          formData(expected);
          expect(await fn(body.join("\r\n"), headers).formData()).toStrictEqual(expected);
        });
      }
      const invalidTests = [
        {
          label: "empty body",
          headers: {
            "Content-Type": "application/octet-stream",
          },
          body: [],
        },
        {
          label: "text body",
          headers: {
            "Content-Type": "text/plain",
          },
          body: ["how are you?"],
        },
        {
          label: "multipart with no boundary",
          headers: {
            "Content-Type": "multipart/form-data",
          },
          body: ["--abc123", 'Content-Disposition: form-data; name="value"', "", "hello", "--abc123--", ""],
        },
        {
          label: "multipart with malformed boundary",
          headers: {
            "Content-Type": "multipart/form-data; boundary=abc123",
          },
          body: ["--", 'Content-Disposition: form-data; name="value"', "", '{"ok":true}\n', "----", ""],
        },
      ];
      for (const { label, body, headers } of invalidTests) {
        test(label, () => {
          expect(async () => await fn(body.join("\r\n"), headers).formData()).toThrow(TypeError);
        });
      }
    });
    describe("body", () => {
      test("undefined", () => {
        expect(fn().body).toBeNull();
      });
      test("null", () => {
        expect(fn(null).body).toBeNull();
      });
      const tests = [
        {
          label: "string",
          body: () => "bun",
        },
        {
          label: "Buffer",
          body: () => Buffer.from("bun", "utf-8"),
        },
        {
          label: "Uint8Array",
          body: () => new Uint8Array([0x62, 0x75, 0x6e]),
        },
        {
          label: "Blob",
          body: () => new Blob(["bun"]),
        },
        {
          label: "ReadableStream",
          body: () =>
            new ReadableStream({
              start(controller) {
                controller.enqueue("b");
                controller.enqueue("u");
                controller.enqueue("n");
                controller.close();
              },
            }),
        },
      ];
      for (const { label, body } of tests) {
        test(label, async () => {
          const actual = fn(body()).body;
          expect(actual).not.toBeNull();
          expect(actual instanceof ReadableStream).toBe(true);
          const stream = actual as ReadableStream;
          expect(stream.locked).toBe(false);
          expect(await stream.text()).toBe("bun");
        });
      }
    });
    describe("bodyUsed", () => {
      const tests: Record<string, { label?: string; body?: BodyInit | null; bodyUsed: boolean }[]> = {
        "text": [
          {
            body: undefined,
            bodyUsed: false,
          },
          {
            body: null,
            bodyUsed: false,
          },
          {
            body: "",
            bodyUsed: true,
          },
          {
            body: "bun",
            bodyUsed: true,
          },
        ],
        "json": [
          {
            body: "{}",
            bodyUsed: true,
          },
        ],
        "arrayBuffer": [
          {
            body: undefined,
            bodyUsed: false,
          },
          {
            body: null,
            bodyUsed: false,
          },
          {
            label: "Uint8Array",
            body: new Uint8Array([0x62, 0x75, 0x6e]),
            bodyUsed: true,
          },
        ],
        "blob": [
          {
            body: undefined,
            bodyUsed: false,
          },
          {
            body: null,
            bodyUsed: false,
          },
          {
            label: "Blob",
            body: new Blob(["bun"]),
            bodyUsed: true,
          },
        ],
        "formData": [
          {
            label: "FormData",
            body: new FormData(),
            bodyUsed: true,
          },
        ],
        "clone": [
          {
            body: null,
            bodyUsed: false,
          },
          {
            body: null,
            bodyUsed: false,
          },
          {
            body: "bun",
            bodyUsed: false,
          },
        ],
      };
      for (const [property, entries] of Object.entries(tests)) {
        describe(`${property}()`, () => {
          for (const { label, body, bodyUsed } of entries) {
            test(label || `${body}`, () => {
              const result = fn(body);
              expect(result).toHaveProperty("bodyUsed", false);
              // @ts-expect-error
              expect(() => result[property]()).not.toThrow();
              expect(result).toHaveProperty("bodyUsed", bodyUsed);
            });
          }
        });
      }
    });

    describe("new Response()", () => {
      ["text", "arrayBuffer", "bytes", "blob"].map(method => {
        test(method, async () => {
          const result = new Response();
          expect(result).toHaveProperty("bodyUsed", false);

          // @ts-expect-error
          await result[method]();
          expect(result).toHaveProperty("bodyUsed", false);
        });
      });
    });

    describe('new Request(url, {method: "POST" })', () => {
      ["text", "arrayBuffer", "bytes", "blob"].map(method => {
        test(method, async () => {
          const result = new Request("https://example.com", { method: "POST" });
          expect(result).toHaveProperty("bodyUsed", false);

          // @ts-expect-error
          await result[method]();
          expect(result).toHaveProperty("bodyUsed", false);
        });
      });
    });

    describe("new Request(url)", () => {
      ["text", "arrayBuffer", "bytes", "blob"].map(method => {
        test(method, async () => {
          const result = new Request("https://example.com");
          expect(result).toHaveProperty("bodyUsed", false);

          // @ts-expect-error
          await result[method]();
          expect(result).toHaveProperty("bodyUsed", false);
        });
      });
    });
  });
}

function arrayBuffer(buffer: BufferSource) {
  if (buffer instanceof ArrayBuffer) {
    return buffer;
  }
  if (buffer instanceof SharedArrayBuffer) {
    return new Uint8Array(new Uint8Array(buffer)).buffer;
  }
  return buffer.buffer;
}

// Consuming a string body via .text()/.json()/.arrayBuffer()/.bytes() used to
// permanently leak the whole body string (the adopted WTF::StringImpl +1 ref
// was never released), so RSS grew *linearly and never plateaued* across
// round-trips. The fix mirrors the Zig `defer str.deref()`. This asserts the
// leak is bounded: after a warmup, a second equal block of round-trips must
// not keep growing RSS (a linear leak adds ~block-size every block; a bounded
// impl plateaus). Absolute RSS is intentionally not asserted — only growth.
describe.concurrent("string body consumption does not leak", () => {
  // NOTE: `.text()` is intentionally excluded. It produces a large JS string
  // as its result, and discarded large JS strings are currently not reclaimed
  // by GC in this build independently of bodies — `Buffer.alloc(2e6).toString()`
  // in a loop leaks identically with no Blob/Response involved. That is a
  // separate bug from the missing body-string `deref`; mixing it in here would
  // test the wrong thing. These four consume into a parsed value / byte buffer
  // and measure the body-string lifetime cleanly.
  const cases: Array<[string, "Response" | "Request", string]> = [
    ["Response.json", "Response", "json"],
    ["Response.arrayBuffer", "Response", "arrayBuffer"],
    ["Response.bytes", "Response", "bytes"],
    ["Request.json", "Request", "json"],
  ];

  for (const [name, ctor, method] of cases) {
    test(name, async () => {
      // We need the *body string* to be large (that's the leaked ref) but the
      // consumer to be cheap, so the JSON arm uses whitespace padding + a tiny
      // value — valid JSON, ~SZ-byte body, near-free parse. `Buffer.alloc` is
      // avoided for body construction per the note above (separate reclaim
      // issue would pollute this measurement); `.repeat()` is also measurably
      // faster than `Buffer.alloc(..).toString()` on this path in debug.
      const makeBody = method === "json" ? `() => " ".repeat(SZ) + "0"` : `() => "z".repeat(SZ)`;
      const make =
        ctor === "Request"
          ? `b => new Request("http://example.com/", { method: "POST", body: b })`
          : `b => new Response(b)`;
      const src = `
        const SZ = 2_000_000, WARM = 50, BLOCK = 40;
        const rss = () => (process.memoryUsage().rss / 1048576) | 0;
        const body = ${makeBody};
        const make = ${make};
        const run = async n => { for (let i = 0; i < n; i++) await make(body())[${JSON.stringify(method)}](); };
        await run(WARM); Bun.gc(true); const a = rss();
        await run(BLOCK); Bun.gc(true); const b = rss();
        await run(BLOCK); Bun.gc(true); const c = rss();
        console.log("BLOCK1:" + (b - a) + " BLOCK2:" + (c - b));
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", src],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const m = stdout.match(/BLOCK1:(-?\d+) BLOCK2:(-?\d+)/);
      expect(m).not.toBeNull();
      const block2 = Number(m![2]);
      // Bounded: BLOCK2 ≈ 0 (plateaued). Leaking: BLOCK2 ≈ 40 × ~3 MB ≈ 100+ MB
      // and keeps growing every block. 50 MB cleanly separates the two.
      expect(block2).toBeLessThan(50);
      expect(exitCode).toBe(0);
    });
  }
});

// https://github.com/oven-sh/bun/issues/6860
describe("constructing a body from an unusable ReadableStream", () => {
  const bytes = () =>
    new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("x"));
        c.close();
      },
    });
  test("a disturbed stream throws a TypeError", async () => {
    const rs = bytes();
    await new Response(rs).text();
    expect(() => new Response(rs)).toThrow(TypeError);
    expect(() => new Request("http://example.com/", { method: "POST", body: rs, duplex: "half" })).toThrow(TypeError);
  });
  test("a locked stream throws a TypeError", () => {
    const rs = bytes();
    rs.getReader();
    expect(() => new Response(rs)).toThrow(TypeError);
    expect(() => new Request("http://example.com/", { method: "POST", body: rs, duplex: "half" })).toThrow(TypeError);
  });
});

// https://fetch.spec.whatwg.org/#dom-body-blob: `blob()` resolves to a plain
// `Blob` (never a `File`) whose `type` is "extract a MIME type" of the header
// list, serialized per mimesniff and normalized like any Blob `type`.
for (const { body: bodyType, fn } of bodyTypes) {
  describe(`${bodyType.name}.prototype.blob()`, () => {
    // Every (header, type) pair below was verified against Node.js v26.
    const headerToBlobType: [header: string, type: string][] = [
      ["text/plain", "text/plain"],
      ["TEXT/PLAIN", "text/plain"],
      ["  text/html  ", "text/html"],
      ["text/plain; charset=utf-8", "text/plain;charset=utf-8"],
      ["text/plain ; charset =utf-8", "text/plain"],
      ["TEXT/Plain ; Charset=UTF-8", "text/plain;charset=utf-8"],
      ["My/Type; A=B", "my/type;a=b"],
      ["Image/JPEG ; a= b ", 'image/jpeg;a=" b"'],
      ["text/html\t;\tcharset=utf-8", "text/html;charset=utf-8"],
      ['text/plain;foo="bar"', "text/plain;foo=bar"],
      ['text/plain;foo="ba r"', 'text/plain;foo="ba r"'],
      ['text/plain;foo="ba\\"r"', 'text/plain;foo="ba\\"r"'],
      ['text/plain;foo="unterminated', "text/plain;foo=unterminated"],
      ['text/plain;foo="a"junk;b=c', "text/plain;foo=a;b=c"],
      ["text/plain;foo=bar;foo=baz", "text/plain;foo=bar"],
      ["text/plain;FOO=bar;foo=baz", "text/plain;foo=bar"],
      ["text/plain;=x", "text/plain"],
      ["text/plain;a=", "text/plain"],
      ["text/plain;a", "text/plain"],
      ["text/plain;;a=b", "text/plain;a=b"],
      ["text/plain; a = b", "text/plain"],
      ["text/plain;a=b c", 'text/plain;a="b c"'],
      ['text/plain;x=""', 'text/plain;x=""'],
      ['text/plain;x="a,b"', 'text/plain;x="a,b"'],
      ["text/plain;x=a,b", "text/plain;x=a"],
      ["text/plain;a b=c", "text/plain"],
      ['text/plain;a=b"c', 'text/plain;a="b\\"c"'],
      ["text/plain;a@=c", "text/plain"],
      ["", ""],
      ["invalid", ""],
      ["/", ""],
      ["/plain", ""],
      ["text/", ""],
      ["text /plain", ""],
      ["text/ plain", ""],
      ["te xt/plain", ""],
      ["text//plain", ""],
      ["*/*", ""],
      ["*/plain", "*/plain"],
      ["text/*", "text/*"],
      ["*/*;q=1", ""],
      ["text/html, text/plain", "text/plain"],
      ["text/plain, text/html", "text/html"],
      ["text/html, */*", "text/html"],
      ["*/*, text/html", "text/html"],
      ["bogus, text/html", "text/html"],
      ["text/html, bogus", "text/html"],
      ["text/html,", "text/html"],
      [",text/html", "text/html"],
      [",", ""],
      ["text/html;charset=x, text/html", "text/html;charset=x"],
      ["text/html;charset=x, text/html;a=b", "text/html;a=b;charset=x"],
      ["text/html;charset=x, text/plain", "text/plain"],
      ["text/html;charset=x, text/html;charset=y", "text/html;charset=y"],
      // The carried charset is only updated when the essence changes (fetch
      // "extract a MIME type" step 6.4.2), so the last value inherits x, not y.
      ["text/html;charset=x, text/html;charset=y, text/html", "text/html;charset=x"],
      ['text/a;x="y,z", text/b', "text/b"],
      ['text/a;x="y,z', 'text/a;x="y,z"'],
      ["text/a;x=y,z/w", "z/w"],
      ["APPLICATION/Json", "application/json"],
      ["application/json; Charset=UTF-8", "application/json;charset=utf-8"],
      ["multipart/form-data; boundary=----x", "multipart/form-data;boundary=----x"],
      ['multipart/form-data; boundary="--aaa"', "multipart/form-data;boundary=--aaa"],
      // A tab inside a quoted parameter value survives the MIME serialization
      // but is outside U+0020-U+007E, so the Blob constructor drops the type.
      ['text/plain;a="\t"', ""],
      ['text/plain;a="x\ty"', ""],
      // Undici's HTTP-token regex is missing U+0060 (`), which the MIME
      // Sniffing standard includes; Bun follows the spec, so Node disagrees on
      // these two (it drops the parameter / quotes the value).
      ["a/b;!#$%&'*+-.^_`|~=ok", "a/b;!#$%&'*+-.^_`|~=ok"],
      ["a/b;k=!#$%&'*+-.^_`|~", "a/b;k=!#$%&'*+-.^_`|~"],
    ];
    test.each(headerToBlobType)("Content-Type %j gives type %j", async (header, expected) => {
      const blob = await fn(new Uint8Array([0x78]), { "content-type": header }).blob();
      expect(blob.type).toBe(expected);
    });

    test("returns a plain Blob, never the body's File", async () => {
      const source = new File(["hello"], "source.bin", { type: "My/Type; A=B" });
      const blob = await fn(source).blob();
      expect({
        type: blob.type,
        isFile: blob instanceof File,
        name: blob.name,
        text: await blob.text(),
      }).toEqual({ type: "my/type;a=b", isFile: false, name: undefined, text: "hello" });
      // The caller's File keeps its identity.
      expect({ type: source.type, isFile: source instanceof File, name: source.name }).toEqual({
        type: "my/type; a=b",
        isFile: true,
        name: "source.bin",
      });
    });

    test("an explicit Content-Type header wins over the body Blob's type", async () => {
      const blob = await fn(new Blob(["x"], { type: "a/a" }), { "content-type": "b/b" }).blob();
      expect(blob.type).toBe("b/b");
      // It wins even when it extracts to nothing: the body Blob's type must
      // not leak through, whether Bun stores it interned (text/plain) or not.
      expect((await fn(new Blob(["x"], { type: "text/plain" }), { "content-type": "*/*" }).blob()).type).toBe("");
      expect((await fn(new Blob(["x"], { type: "a/a" }), { "content-type": "*/*" }).blob()).type).toBe("");
    });

    test("does not mutate the body source Blob's type", async () => {
      const source = new Blob(["x"]);
      const blob = await fn(source, { "content-type": "application/x-override" }).blob();
      expect({ blobType: blob.type, sourceType: source.type }).toEqual({
        blobType: "application/x-override",
        sourceType: "",
      });
    });

    test("a string body implies text/plain;charset=UTF-8", async () => {
      expect((await fn("hello").blob()).type).toBe("text/plain;charset=utf-8");
    });

    test("a BufferSource body with no Content-Type gives an empty type", async () => {
      expect((await fn(new Uint8Array([1])).blob()).type).toBe("");
    });

    test("a ReadableStream body derives its type from the Content-Type header", async () => {
      const stream = () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("hi"));
            controller.close();
          },
        });
      const withHeader = await fn(stream(), { "content-type": "TEXT/Plain ; Charset=UTF-8" }).blob();
      expect({ type: withHeader.type, text: await withHeader.text() }).toEqual({
        type: "text/plain;charset=utf-8",
        text: "hi",
      });
      // A bare well-known essence must come through exactly as in the header:
      // the Blob constructor's interned MIME table would canonicalize
      // "application/json" to "application/json;charset=utf-8".
      expect((await fn(stream(), { "content-type": "application/json" }).blob()).type).toBe("application/json");
      const withoutHeader = await fn(stream()).blob();
      expect({ type: withoutHeader.type, text: await withoutHeader.text() }).toEqual({ type: "", text: "hi" });
    });

    test("a Bun.file body keeps its extension-derived type", async () => {
      using dir = tempDir("body-blob-type", { "a.json": "{}" });
      const source = file(join(String(dir), "a.json"));
      expect((await fn(source).blob()).type).toBe(source.type);
    });

    // Reading `.body` materializes the body as a ReadableStream, but the type
    // comes from the header list, which is fixed at construction.
    test("accessing .body first does not change the type", async () => {
      const typed = fn(new Blob(["x"], { type: "a/a" }));
      typed.body;
      const emptyTyped = fn(new Blob([], { type: "a/a" }));
      emptyTyped.body;
      const untyped = fn(new Blob(["x"]));
      untyped.body;
      const string = fn("hello");
      string.body;
      string.body;
      const header = fn(new Blob(["x"], { type: "a/a" }), { "content-type": "B/B ; c=d" });
      header.body;
      const params = fn(new URLSearchParams("a=b"));
      params.body;
      const headersThenBody = fn(new Blob(["x"], { type: "a/a" }));
      headersThenBody.headers;
      headersThenBody.body;
      expect({
        typed: (await typed.blob()).type,
        emptyTyped: (await emptyTyped.blob()).type,
        untyped: (await untyped.blob()).type,
        string: (await string.blob()).type,
        header: (await header.blob()).type,
        params: (await params.blob()).type,
        headersThenBody: (await headersThenBody.blob()).type,
      }).toEqual({
        typed: "a/a",
        emptyTyped: "a/a",
        untyped: "",
        string: "text/plain;charset=utf-8",
        header: "b/b;c=d",
        params: "application/x-www-form-urlencoded;charset=utf-8",
        headersThenBody: "a/a",
      });
    });

    test("accessing .body first keeps a FormData body's multipart type", async () => {
      const form = new FormData();
      form.set("a", "b");
      const request = fn(form);
      request.body;
      const { type } = await request.blob();
      expect(type).toStartWith("multipart/form-data;boundary=");
      expect(type).not.toInclude(" ");
    });

    test("clone() after accessing .body keeps the type", async () => {
      const blobBody = fn(new Blob(["x"], { type: "a/a" }));
      blobBody.body;
      const blobClone = blobBody.clone();
      const stringBody = fn("hello");
      stringBody.body;
      const stringClone = stringBody.clone();
      expect({
        blob: [(await blobBody.blob()).type, (await blobClone.blob()).type],
        string: [(await stringBody.blob()).type, (await stringClone.blob()).type],
      }).toEqual({
        blob: ["a/a", "a/a"],
        string: ["text/plain;charset=utf-8", "text/plain;charset=utf-8"],
      });
    });

    // A non-ASCII string body materializes as internal bytes before cloning;
    // both sides must still report the string default.
    test("clone() of a string body keeps its implied type", async () => {
      const ascii = fn("hello");
      const asciiClone = ascii.clone();
      const nonAscii = fn("héllo");
      const nonAsciiClone = nonAscii.clone();
      expect({
        ascii: [(await ascii.blob()).type, (await asciiClone.blob()).type],
        nonAscii: [(await nonAscii.blob()).type, (await nonAsciiClone.blob()).type],
      }).toEqual({
        ascii: ["text/plain;charset=utf-8", "text/plain;charset=utf-8"],
        nonAscii: ["text/plain;charset=utf-8", "text/plain;charset=utf-8"],
      });
    });

    test("a body built from another body's stream", async () => {
      const typedStream = () => fn(new Blob(["x"], { type: "a/a" })).body!;
      expect({
        // Bun adopts an undisturbed blob-backed stream as the blob itself,
        // type included; per "extract a body" a stream has none (Node: "").
        adopted: (await fn(typedStream()).blob()).type,
        withHeader: (await fn(typedStream(), { "content-type": "x/y" }).blob()).type,
        fromString: (await fn(fn("hello").body!).blob()).type,
      }).toEqual({
        adopted: "a/a",
        withHeader: "x/y",
        fromString: "",
      });
    });
  });
}

describe("blob() type over the network", () => {
  test("fetch() normalizes the response Content-Type", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: () => new Response("x", { headers: { "content-type": "TEXT/Plain ; Charset=UTF-8" } }),
    });
    const blob = await fetch(server.url).then(r => r.blob());
    expect({ type: blob.type, isFile: blob instanceof File }).toEqual({
      type: "text/plain;charset=utf-8",
      isFile: false,
    });
  });

  test("Bun.serve request blob() normalizes the request Content-Type", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<{ type: string; isFile: boolean }>();
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        try {
          const blob = await req.blob();
          resolve({ type: blob.type, isFile: blob instanceof File });
        } catch (e) {
          reject(e);
        }
        return new Response("ok");
      },
    });
    const res = await fetch(server.url, {
      method: "POST",
      body: new Uint8Array(3).fill(0x41),
      headers: { "content-type": "Image/JPEG ; A=B" },
    });
    await res.text();
    expect(await promise).toEqual({ type: "image/jpeg;a=b", isFile: false });
  });

  test("a data: URL with no mediatype keeps Bun's text/plain default", async () => {
    // The data URL processor defaults an empty mediatype to text/plain; the
    // response has no Content-Type header, so blob() reads the body's type.
    const blob = await fetch("data:,Hello%2C%20World!").then(r => r.blob());
    expect({ type: blob.type, text: await blob.text() }).toEqual({
      type: "text/plain;charset=utf-8",
      text: "Hello, World!",
    });
  });
});

describe("Bun.readableStreamToBlob", () => {
  const stream = () =>
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hi"));
        controller.close();
      },
    });
  test("without a contentType", async () => {
    const blob = await Bun.readableStreamToBlob(stream());
    expect({ type: blob.type, text: await blob.text() }).toEqual({ type: "", text: "hi" });
  });
  test("with a contentType", async () => {
    const blob = await Bun.readableStreamToBlob(stream(), "x/y");
    expect({ type: blob.type, text: await blob.text() }).toEqual({ type: "x/y", text: "hi" });
  });
  test("a contentType the Blob constructor would canonicalize is stored verbatim", async () => {
    const blob = await Bun.readableStreamToBlob(stream(), "application/json");
    expect({ type: blob.type, text: await blob.text() }).toEqual({ type: "application/json", text: "hi" });
  });
  test("the contentType is validated and lowercased like a Blob type", async () => {
    expect((await Bun.readableStreamToBlob(stream(), "TEXT/Plain")).type).toBe("text/plain");
    // Characters outside U+0020-U+007E drop the type, as in the Blob
    // constructor; it must never reach an outgoing Content-Type header.
    expect((await Bun.readableStreamToBlob(stream(), "a/b\rx: y")).type).toBe("");
  });
  test("a blob-backed stream's own type never shadows the contentType", async () => {
    // The buffered fast path resolves with a blob that already carries the
    // source Blob's type; the contentType argument still decides the result.
    const typed = () => new Blob(["hi"], { type: "a/a" }).stream();
    expect((await Bun.readableStreamToBlob(typed())).type).toBe("a/a");
    expect((await Bun.readableStreamToBlob(typed(), "B/B")).type).toBe("b/b");
    expect((await Bun.readableStreamToBlob(typed(), "a/b\rx: y")).type).toBe("");
  });
  test("a non-string contentType throws before the stream is touched", () => {
    const untouched = stream();
    // @ts-expect-error intentionally the wrong type
    expect(() => Bun.readableStreamToBlob(untouched, 123)).toThrowWithCode(TypeError, "ERR_INVALID_ARG_TYPE");
    expect(untouched.locked).toBe(false);
  });
});

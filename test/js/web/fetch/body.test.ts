import { file, spawn, version } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, exampleSite } from "harness";

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

// getRandomValues takes integer-typed views only, so fill through a Uint8Array
// view to cover the ArrayBuffer/SharedArrayBuffer/Float* cases too.
function randomFilled(bufferType: (typeof bufferTypes)[number], length: number) {
  const buffer = new (bufferType as any)(length);
  const bytes =
    buffer instanceof ArrayBuffer || buffer instanceof SharedArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  crypto.getRandomValues(bytes);
  return buffer;
}

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
            buffer: () => randomFilled(bufferType, 1_000),
          },
          {
            label: "large buffer",
            buffer: () => randomFilled(bufferType, 1_000_000),
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

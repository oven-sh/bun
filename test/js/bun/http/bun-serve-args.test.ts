import { serve } from "bun";
import { describe, expect, test } from "bun:test";
import { isWindows, tmpdirSync } from "../../../harness";

const defaultHostname = "localhost";

describe("Bun.serve basic options", () => {
  test("minimal valid config", () => {
    using server = serve({
      port: 0,
      fetch() {
        return new Response("ok");
      },
    });
    expect(server.port).toBeGreaterThan(0); // Default port
    expect(server.hostname).toBe(defaultHostname);
    server.stop();
  });

  test("port as string", () => {
    using server = serve({
      port: "0",
      fetch() {
        return new Response("ok");
      },
    });
    expect(server.port).toBeGreaterThan(0);
    server.stop();
  });
});

describe("unix socket", () => {
  const permutations = [
    {
      unix: Math.random().toString(32).slice(2, 15) + ".sock",
      hostname: "",
    },
    {
      unix: Math.random().toString(32).slice(2, 15) + ".sock",
      hostname: undefined,
    },
    {
      unix: Math.random().toString(32).slice(2, 15) + ".sock",
      hostname: null,
    },
    {
      unix: Buffer.from(Math.random().toString(32).slice(2, 15) + ".sock"),
      hostname: null,
    },
    {
      unix: Buffer.from(Math.random().toString(32).slice(2, 15) + ".sock"),
      hostname: Buffer.from(""),
    },
  ] as const;

  for (const { unix, hostname } of permutations) {
    test(`unix: ${unix} and hostname: ${hostname}`, () => {
      using server = serve({
        // @ts-expect-error - Testing invalid combination
        unix,
        // @ts-expect-error - Testing invalid combination
        hostname,
        port: 0,
        fetch() {
          return new Response("ok");
        },
      });
      // @ts-expect-error - Testing invalid property
      expect(server.address + "").toBe(unix + "");
      expect(server.port).toBeUndefined();
      expect(server.hostname).toBeUndefined();
      server.stop();
    });
  }
});

describe("hostname and port works", () => {
  const permutations = [
    {
      port: 0,
      hostname: defaultHostname,
      unix: undefined,
    },
    {
      port: 0,
      hostname: undefined,
      unix: undefined,
    },
    {
      port: 0,
      hostname: null,
      unix: null,
    },
    {
      port: 0,
      hostname: Buffer.from(defaultHostname),
      unix: undefined,
    },
  ] as const;

  for (const { port, hostname, unix } of permutations) {
    test(`port: ${port} and hostname: ${hostname} and unix: ${unix}`, () => {
      using server = serve({
        port,
        // @ts-expect-error - Testing invalid combination
        hostname,
        // @ts-expect-error - Testing invalid combination
        unix,
        fetch() {
          return new Response("ok");
        },
      });
      expect(server.port).toBeGreaterThan(0);
      expect(server.hostname).toBe((hostname || defaultHostname) + "");
      server.stop();
    });
  }
});

describe("unix option validation", () => {
  test("empty string throws instead of silently binding TCP", () => {
    expect(() =>
      serve({
        // @ts-expect-error
        unix: "",
        fetch: () => new Response("ok"),
      }),
    ).toThrow(/non-empty string/);
  });

  test("empty Buffer throws", () => {
    expect(() =>
      serve({
        // @ts-expect-error
        unix: Buffer.from(""),
        fetch: () => new Response("ok"),
      }),
    ).toThrow(/non-empty string/);
  });

  test.each([[42], [{}], [true], [["sock"]], [() => {}], [{ toString: () => "coerced.sock" }]])(
    "non-string %p throws TypeError",
    value => {
      expect(() =>
        serve({
          // @ts-expect-error
          unix: value,
          fetch: () => new Response("ok"),
        }),
      ).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    },
  );

  test.each([undefined, null])("%p is treated as absent (TCP)", value => {
    using server = serve({
      port: 0,
      // @ts-expect-error
      unix: value,
      fetch: () => new Response("ok"),
    });
    expect(server.port).toBeGreaterThan(0);
    expect(server.url.protocol).toBe("http:");
  });

  test.skipIf(isWindows)("server.url never throws for unix paths with special characters", () => {
    const dir = tmpdirSync();
    for (const name of ["my app.sock", "a#b.sock", "a?b.sock", "a@b.sock"]) {
      const p = dir + "/" + name;
      using server = serve({ unix: p, fetch: () => new Response("ok") });
      const url = server.url;
      expect(url).toBeInstanceOf(URL);
      expect(url.protocol).toBe("unix:");
      expect(decodeURIComponent(url.pathname)).toBe(p);
    }
  });

  test.skipIf(isWindows)("server.url never throws for a relative unix path with a space", () => {
    const cwd = process.cwd();
    const dir = tmpdirSync();
    process.chdir(dir);
    try {
      using server = serve({ unix: "my app.sock", fetch: () => new Response("ok") });
      const url = server.url;
      expect(url).toBeInstanceOf(URL);
      expect(url.protocol).toBe("unix:");
      expect(decodeURIComponent(url.hostname)).toBe("my app.sock");
    } finally {
      process.chdir(cwd);
    }
  });
});

describe("Bun.serve error handling", () => {
  test("missing fetch handler throws", () => {
    // @ts-expect-error - Testing runtime behavior
    expect(() => serve({})).toThrow();
  });

  test("custom error handler", () => {
    using server = serve({
      port: 0,
      error(error) {
        return new Response(`Error: ${error.message}`, { status: 500 });
      },
      fetch() {
        throw new Error("test error");
      },
    });
    server.stop();
  });
});

describe("Bun.serve websocket options", () => {
  test("basic websocket config", () => {
    using server = serve({
      port: 0,
      websocket: {
        message(ws, message) {
          ws.send(message);
        },
      },
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("Not a websocket");
      },
    });
    server.stop();
  });

  test("websocket with all handlers", () => {
    using server = serve({
      port: 0,
      websocket: {
        open(ws) {},
        message(ws, message) {},
        drain(ws) {},
        close(ws, code, reason) {},
        ping(ws, data) {},
        pong(ws, data) {},
      },
      fetch() {
        return new Response("ok");
      },
    });
    server.stop();
  });

  test("websocket with custom limits", () => {
    using server = serve({
      port: 0,
      websocket: {
        message(ws, message) {},
        maxPayloadLength: 1024 * 1024, // 1MB
        backpressureLimit: 1024 * 512, // 512KB
        closeOnBackpressureLimit: true,
        idleTimeout: 60, // 1 minute
      },
      fetch() {
        return new Response("ok");
      },
    });
    server.stop();
  });

  test("websocket with compression options", () => {
    using server = serve({
      port: 0,
      websocket: {
        message(ws, message) {},
        perMessageDeflate: {
          compress: true,
          decompress: "shared",
        },
      },
      fetch() {
        return new Response("ok");
      },
    });
    server.stop();
  });
});

describe("Bun.serve development options", () => {
  test("development mode", () => {
    using server = serve({
      development: true,
      port: 0,
      fetch() {
        return new Response("ok");
      },
    });
    expect(server.development).toBe(true);
    server.stop();
  });

  test("custom server id", () => {
    using server = serve({
      id: "test-server",
      port: 0,
      fetch() {
        return new Response("ok");
      },
    });
    expect(server.id).toBe("test-server");
    server.stop();
  });

  // The `inspector` option was removed from Bun.serve(). It used to register a
  // `/bun:inspect` WebSocket route and throw when combined with
  // `development: false`. It is now ignored like any other unknown option.
  test("inspector option is ignored", () => {
    using server = serve({
      port: 0,
      development: false,
      // @ts-expect-error removed option
      inspector: true,
      fetch() {
        return new Response("ok");
      },
    });
    expect(server.port).toBeGreaterThan(0);
    expect(server.development).toBe(false);
    server.stop();
  });
});

describe("Bun.serve static routes", () => {
  test("static route handling", () => {
    using server = serve({
      port: 0,
      static: {
        "/": new Response("Home"),
        "/about": new Response("About"),
      },
      fetch() {
        return new Response("Not found");
      },
    });
    server.stop();
  });
});

describe("Bun.serve unix socket", () => {
  test("unix socket config", () => {
    const tmpdir = tmpdirSync();
    using server = serve({
      unix: tmpdir + "/test.sock",
      fetch() {
        return new Response("ok");
      },
    });
    server.stop();
  });

  test("unix socket with websocket", () => {
    const tmpdir = tmpdirSync();
    using server = serve({
      unix: tmpdir + "/test.sock",
      websocket: {
        message(ws, message) {},
      },
      fetch() {
        return new Response("ok");
      },
    });
    server.stop();
  });
});

describe("Bun.serve hostname and port validation", () => {
  test("hostname with port 0 gets random port", () => {
    using server = serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return new Response("ok");
      },
    });
    expect(server.port).toBeGreaterThan(0);
    expect(server.hostname).toBe("127.0.0.1");
    server.stop();
  });

  test("port with no hostname gets default hostname", () => {
    using server = serve({
      port: 0,
      fetch() {
        return new Response("ok");
      },
    });
    expect(server.port).toBeGreaterThan(0);
    expect(server.hostname).toBe(defaultHostname); // Default hostname
    server.stop();
  });

  test("hostname with unix should throw", () => {
    expect(() =>
      serve({
        // @ts-expect-error - Testing invalid combination
        hostname: defaultHostname,
        unix: "test.sock",
        fetch() {
          return new Response("ok");
        },
      }),
    ).toThrow();
  });

  test("unix with no hostname/port is valid", () => {
    const tmpdir = tmpdirSync();
    using server = serve({
      unix: tmpdir + "/test.sock",
      fetch() {
        return new Response("ok");
      },
    });
    server.stop();
  });

  describe("various valid hostnames", () => {
    const validHostnames = [defaultHostname, "127.0.0.1", "0.0.0.0"];

    for (const hostname of validHostnames) {
      test(hostname, () => {
        using server = serve({
          hostname,
          port: 0,
          fetch() {
            return new Response("ok");
          },
        });
        expect(server.hostname).toBe(hostname);
        server.stop();
      });
    }
  });

  describe("various port types", () => {
    const validPorts = [
      [0, expect.any(Number)], // random port
      ["0", expect.any(Number)], // random port as string
    ] as const;

    for (const [input, expected] of validPorts) {
      test(JSON.stringify(input), () => {
        using server = serve({
          port: input,
          fetch() {
            return new Response("ok");
          },
        });

        if (typeof expected === "object") {
          expect(server.port).toBeGreaterThan(0);
        } else {
          expect(server.port).toBe(expected);
        }
        server.stop();
      });
    }
  });

  describe("invalid port values throw RangeError", () => {
    const invalidPorts: { port: unknown; received: string }[] = [
      { port: 65536, received: "65536" },
      { port: 70000, received: "70000" },
      { port: 2 ** 32 + 8080, received: "4294975376" },
      { port: -1, received: "-1" },
      { port: 1.5, received: "1.5" },
      { port: "abc", received: "NaN" },
      { port: NaN, received: "NaN" },
      { port: Infinity, received: "Infinity" },
      { port: -Infinity, received: "-Infinity" },
      { port: "65536", received: "65536" },
      { port: Number.MAX_SAFE_INTEGER, received: String(Number.MAX_SAFE_INTEGER) },
    ];

    for (const { port, received } of invalidPorts) {
      test(`port: ${typeof port === "string" ? JSON.stringify(port) : port}`, () => {
        let thrown: unknown;
        try {
          const server = serve({
            // @ts-expect-error - Testing invalid port values
            port,
            fetch() {
              return new Response("ok");
            },
          });
          server.stop(true);
        } catch (e) {
          thrown = e;
        }
        expect(thrown).toBeInstanceOf(RangeError);
        expect((thrown as RangeError).message).toContain("options.port");
        expect((thrown as RangeError).message).toContain(received);
      });
    }

    test("server.reload() rejects an out-of-range port", () => {
      using server = serve({
        port: 0,
        fetch() {
          return new Response("ok");
        },
      });
      let thrown: unknown;
      try {
        server.reload({
          // @ts-expect-error - Testing invalid port values
          port: 65536,
          fetch() {
            return new Response("ok");
          },
        });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(RangeError);
      expect((thrown as RangeError).message).toContain("options.port");
      expect((thrown as RangeError).message).toContain("65536");
    });
  });
});

describe("Bun.serve hostname coercion", () => {
  // Windows can't bind to hostname "0" (POSIX resolves it to 0.0.0.0).
  test.skipIf(isWindows)("number hostnames coerce to string", () => {
    using server = serve({
      // @ts-expect-error - Testing runtime coercion
      hostname: 0, // Should coerce to "0"
      port: 0,
      fetch() {
        return new Response("ok");
      },
    });
    expect(server.hostname).toBe("0");
    server.stop();
  });

  test("object with toString() coerces to string", () => {
    const customHostname = {
      toString() {
        return defaultHostname;
      },
    };

    using server = serve({
      // @ts-expect-error - Testing runtime coercion
      hostname: customHostname,
      port: 0,
      fetch() {
        return new Response("ok");
      },
    });
    expect(server.hostname).toBe(defaultHostname);
    server.stop();
  });

  test("invalid toString() results should throw", () => {
    // The `null`/`undefined` toString() results coerce to the legal hostname strings
    // "null"/"undefined". Pair those with `unix` so serve() still coerces the hostname but
    // throws from the hostname+unix validation instead of a blocking DNS lookup of that name.
    const invalidHostnames: Array<{ hostname: unknown; unix?: string }> = [
      {
        hostname: {
          toString() {
            return {};
          },
        },
      },
      {
        hostname: {
          toString() {
            return [];
          },
        },
      },
      {
        hostname: {
          toString() {
            return null;
          },
        },
        unix: "bun-serve-args-invalid-hostname.sock",
      },
      {
        hostname: {
          toString() {
            return undefined;
          },
        },
        unix: "bun-serve-args-invalid-hostname.sock",
      },
      {
        hostname: {
          toString() {
            throw new Error("invalid toString");
          },
        },
      },
      {
        hostname: {
          toString() {
            return Symbol("test");
          },
        },
      },
    ];

    for (const { hostname, unix } of invalidHostnames) {
      expect(() =>
        serve({
          // @ts-expect-error - Testing runtime coercion
          hostname,
          ...(unix ? { unix } : {}),
          port: 0,
          fetch() {
            return new Response("ok");
          },
        }),
      ).toThrow();
    }
  });

  test("symbol hostnames should throw", () => {
    expect(() =>
      serve({
        // @ts-expect-error - Testing runtime behavior
        hostname: Symbol("test"),
        port: 0,
        fetch() {
          return new Response("ok");
        },
      }),
    ).toThrow();
  });

  test("coerced hostnames must still be valid", () => {
    const invalidCoercions = [
      {
        toString() {
          return "http://example.com";
        },
      },
      {
        toString() {
          return "example.com:3000";
        },
      },
      {
        toString() {
          return "-invalid.com";
        },
      },
    ];

    for (const hostname of invalidCoercions) {
      expect(() =>
        serve({
          // @ts-expect-error - Testing runtime coercion
          hostname,
          port: 0,
          fetch() {
            return new Response("ok");
          },
        }),
      ).toThrow();
    }
  });

  describe("falsy values should use default or throw", () => {
    test("undefined should use default", () => {
      using server = serve({
        hostname: undefined,
        port: 0,
        fetch() {
          return new Response("ok");
        },
      });
      expect(server.hostname).toBe(defaultHostname);
      server.stop();
    });

    test("null should NOT throw", () => {
      expect(() => {
        using server = serve({
          // @ts-expect-error - Testing runtime behavior
          hostname: null,
          port: 0,
          fetch() {
            return new Response("ok");
          },
        });
        expect(server.hostname).toBe(defaultHostname);
      }).not.toThrow();
    });

    test("empty string should be ignored", () => {
      expect(() => {
        using server = serve({
          hostname: "",
          port: 0,
          fetch() {
            return new Response("ok");
          },
        });
        expect(server.hostname).toBe(defaultHostname);
      }).not.toThrow();
    });
  });
});

describe("Bun.serve unix socket validation", () => {
  test("unix socket with hostname should throw", () => {
    expect(() =>
      serve({
        unix: "/tmp/test.sock",
        // @ts-expect-error - Testing invalid combination
        hostname: defaultHostname, // Cannot combine with unix
        fetch() {
          return new Response("ok");
        },
      }),
    ).toThrow();
  });

  describe("invalid unix socket paths should throw", () => {
    const invalidPaths = [
      {
        toString() {
          throw new Error("invalid toString");
        },
        toJSON() {
          return "invalid toJSON";
        },
      },
      {
        toString() {
          return Symbol("test");
        },
        toJSON() {
          return "Symbol(test)";
        },
      },
    ];

    for (const unix of invalidPaths) {
      test(JSON.stringify(unix), () => {
        expect(() =>
          serve({
            // @ts-expect-error - Testing invalid unix socket path
            unix,
            fetch() {
              return new Response("ok");
            },
          }),
        ).toThrow();
      });
    }
  });

  test("unix socket path coercion is rejected", () => {
    expect(() =>
      serve({
        // @ts-expect-error - Testing runtime coercion
        unix: Math.ceil(Math.random() * 100000000),
        fetch() {
          return new Response("ok");
        },
      }),
    ).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));

    const pathObj = {
      toString() {
        return Math.random().toString(32).slice(2, 15) + ".sock";
      },
    };
    expect(() =>
      serve({
        // @ts-expect-error - Testing runtime coercion
        unix: pathObj,
        fetch() {
          return new Response("ok");
        },
      }),
    ).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
  });

  test("invalid unix socket path coercion should throw", () => {
    const invalidCoercions = [
      {
        toString() {
          throw new Error("invalid toString");
        },
      },
    ];

    for (const unix of invalidCoercions) {
      expect(() => {
        using server = serve({
          port: 0,
          // @ts-expect-error - Testing runtime coercion
          unix,
          fetch() {
            return new Response("ok");
          },
        });
        server.stop();
      }).toThrow();
    }
  });
});

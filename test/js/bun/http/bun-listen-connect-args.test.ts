import { describe, expect, test } from "bun:test";
import { cwdScope, isWindows, rmScope, tempDirWithFiles } from "harness";

describe("getsockname", () => {
  test("called without arguments does not crash", () => {
    using server = Bun.listen({
      hostname: "localhost",
      port: 0,
      socket: {
        data() {},
      },
    });
    const result = server.getsockname();
    expect(result).toEqual(expect.objectContaining({
      family: expect.any(String),
      address: expect.any(String),
      port: expect.any(Number),
    }));
    server.stop(true);
  });

  test("called with an object argument populates it", () => {
    using server = Bun.listen({
      hostname: "localhost",
      port: 0,
      socket: {
        data() {},
      },
    });
    const out: Record<string, unknown> = {};
    server.getsockname(out);
    expect(out.family).toBeString();
    expect(out.address).toBeString();
    expect(out.port).toBeNumber();
    server.stop(true);
  });
});

describe.if(!isWindows)("unix socket", () => {
  test("valid", () => {
    using server = Bun.listen({
      unix: Math.random().toString(32).slice(2, 15) + ".sock",
      socket: {
        open() {},
        close() {},
        data() {},
        drain() {},
      },
    });
    server.stop();
  });

  describe("allows", () => {
    const permutations = [
      {
        unix: Math.random().toString(32).slice(2, 15) + ".sock",
        port: 0,
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
        unix: Math.random().toString(32).slice(2, 15) + ".sock",
        hostname: false,
      },
    ];

    for (const args of permutations) {
      test(`${JSON.stringify(args)}`, async () => {
        const tempdir = tempDirWithFiles("test-socket", {
          "foo.txt": "bar",
        });
        using cwd = cwdScope(tempdir);
        using rm = rmScope(tempdir);
        for (let i = 0; i < 100; i++) {
          using server = Bun.listen({
            ...args,
            unix: args.unix.startsWith("unix://") ? "unix://" + i + args.unix.slice(7) : i + args.unix,
            socket: {
              open() {},
              close() {},
              data() {},
              drain() {},
            },
          });
          server.stop();
        }
      });
    }
  });
});

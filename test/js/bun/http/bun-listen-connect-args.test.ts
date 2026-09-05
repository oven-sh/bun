import { describe, test } from "bun:test";
import { cwdScope, isWindows, tempDir, tmpdirSync } from "harness";
import { basename, dirname, join } from "node:path";

describe.if(!isWindows)("unix socket", () => {
  test("valid", () => {
    using server = Bun.listen({
      unix: join(tmpdirSync(), Math.random().toString(32).slice(2, 15) + ".sock"),
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
        unix: join(tmpdirSync(), Math.random().toString(32).slice(2, 15) + ".sock"),
        port: 0,
        hostname: "",
      },
      {
        unix: join(tmpdirSync(), Math.random().toString(32).slice(2, 15) + ".sock"),
        hostname: undefined,
      },
      {
        unix: join(tmpdirSync(), Math.random().toString(32).slice(2, 15) + ".sock"),
        hostname: null,
      },
      {
        unix: join(tmpdirSync(), Math.random().toString(32).slice(2, 15) + ".sock"),
        hostname: false,
      },
    ];

    for (const args of permutations) {
      test(`${JSON.stringify(args)}`, async () => {
        await using tempdir = tempDir("test-socket", {
          "foo.txt": "bar",
        });
        using cwd = cwdScope(String(tempdir));
        for (let i = 0; i < 100; i++) {
          using server = Bun.listen({
            ...args,
            // i prefixes the socket NAME (the old relative form relied on
            // i + "name.sock"); with an absolute path the prefix must go on
            // the basename.
            unix: args.unix.startsWith("unix://")
              ? "unix://" + i + args.unix.slice(7)
              : join(dirname(args.unix), i + basename(args.unix)),
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

import { afterAll, describe, expect, test } from "bun:test";
import { isLinux, isPosix, tempDir } from "harness";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";

// A unix socket path with an interior NUL byte used to be passed through to
// the kernel, which reads sun_path as a NUL-terminated string: the
// connect/listen silently happened on the truncated prefix path (a different
// socket) while the API reported the full path. Every surface must reject the
// path instead. Abstract socket names (leading NUL, Linux) are
// length-delimited and may legitimately contain NUL bytes.

const dir = tempDir("unix-nul", {});
const D = String(dir);

// A decoy server at the truncated prefix: before the fix, every client
// surface asked for `D/a\0...` and reached this socket instead.
let decoyConnections = 0;
const decoy = isPosix
  ? Bun.listen({
      unix: D + "/a",
      socket: {
        open(socket) {
          decoyConnections++;
          socket.end();
        },
        data() {},
      },
    })
  : null;

afterAll(() => {
  decoy?.stop(true);
  dir[Symbol.dispose]();
});

const nulPath = D + "/a\0b";

describe("unix socket paths with interior NUL bytes are rejected", () => {
  test("Bun.connect", async () => {
    let err: any;
    try {
      await Bun.connect({ unix: nulPath, socket: { data() {}, open() {} } });
    } catch (e) {
      err = e;
    }
    expect(err?.message).toContain('"unix" must not contain null bytes');
  });

  test("Bun.listen", () => {
    let listener: any;
    try {
      expect(() => {
        listener = Bun.listen({ unix: D + "/q\0c", socket: { data() {} } });
      }).toThrow('"unix" must not contain null bytes');
    } finally {
      listener?.stop(true);
    }
    expect(fs.readdirSync(D)).not.toContain("q");
  });

  test("Bun.serve", () => {
    let server: any;
    try {
      expect(() => {
        server = Bun.serve({ unix: D + "/s\0d", fetch: () => new Response("x") });
      }).toThrow('"unix" must not contain null bytes');
    } finally {
      server?.stop(true);
    }
    expect(fs.readdirSync(D)).not.toContain("s");
  });

  test("fetch", async () => {
    let err: any;
    try {
      await fetch("http://localhost/", { unix: nulPath });
    } catch (e) {
      err = e;
    }
    expect(err?.message).toContain('"unix" must not contain null bytes');
  });

  test("net.connect", async () => {
    const socket = net.connect({ path: nulPath });
    const result: any = await new Promise(resolve => {
      socket.on("error", e => resolve(e));
      socket.on("connect", () => resolve("connected"));
    });
    socket.destroy();
    expect(result).not.toBe("connected");
    expect(result.code).toBe("EINVAL");
    expect(result.syscall).toBe("connect");
    expect(result.message).toStartWith("connect EINVAL");
  });

  test("net.Server.listen", async () => {
    const server = net.createServer(() => {});
    try {
      const result: any = await new Promise(resolve => {
        server.on("error", e => resolve(e));
        server.listen(D + "/z\0w", () => resolve("listening"));
      });
      expect(result).not.toBe("listening");
      expect(result.code).toBe("EINVAL");
      expect(result.message).toBe(`listen EINVAL: invalid argument ${D + "/z\0w"}`);
    } finally {
      server.close();
    }
    expect(fs.readdirSync(D)).not.toContain("z");
  });

  test("http.request socketPath", async () => {
    const result: any = await new Promise(resolve => {
      const req = http.request({ socketPath: nulPath, path: "/" }, () => resolve("response"));
      req.on("error", e => resolve(e));
      req.end();
    });
    expect(result).not.toBe("response");
    expect(result.code).toBe("EINVAL");
  });

  test("trailing NUL is rejected too", () => {
    expect(() => Bun.listen({ unix: D + "/t\0", socket: { data() {} } })).toThrow('"unix" must not contain null bytes');
    expect(fs.readdirSync(D)).not.toContain("t");
  });

  test.skipIf(!isPosix)("the truncated-prefix socket was never contacted", () => {
    expect(decoyConnections).toBe(0);
  });
});

describe.skipIf(!isLinux)("abstract socket names keep working", () => {
  test("Bun.listen/Bun.connect roundtrip, including interior NUL in the name", async () => {
    for (const name of [`\0bun-nul-test-${process.pid}`, `\0bun-nul-test-${process.pid}\0x`]) {
      const { promise, resolve } = Promise.withResolvers<string>();
      const listener = Bun.listen({
        unix: name,
        socket: {
          open(socket) {
            socket.end("hello");
          },
          data() {},
        },
      });
      try {
        await Bun.connect({
          unix: name,
          socket: {
            data(_socket, data) {
              resolve(String(data));
            },
            open() {},
          },
        });
        expect(await promise).toBe("hello");
      } finally {
        listener.stop(true);
      }
    }
  });

  test("node:net abstract listen/connect roundtrip", async () => {
    const name = `\0bun-nul-test-net-${process.pid}`;
    const server = net.createServer(socket => socket.end("hi"));
    try {
      await new Promise<void>((resolve, reject) => {
        server.on("error", reject);
        server.listen(name, () => resolve());
      });
      const received = await new Promise<string>((resolve, reject) => {
        const client = net.connect({ path: name });
        let buf = "";
        client.on("data", d => (buf += d));
        client.on("end", () => resolve(buf));
        client.on("error", reject);
      });
      expect(received).toBe("hi");
    } finally {
      server.close();
    }
  });
});

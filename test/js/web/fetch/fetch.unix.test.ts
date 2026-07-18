import { serve, ServeOptions, Server } from "bun";
import { afterAll, expect, it } from "bun:test";
import { once } from "events";
import { mkdirSync, rmSync } from "fs";
import { isWindows, tmpdirSync } from "harness";
import { request } from "http";
import { createServer } from "net";
import { join } from "path";
const tmp_dir = tmpdirSync();

it("throws ENAMETOOLONG when socket path exceeds platform-specific limit", () => {
  // this must be the filename specifically, because we add a workaround for the length limit on linux
  const path = "a".repeat(
    {
      darwin: 104,
      linux: 108,
      win32: 260,
      sunos: 104,
      aix: 104,
      freebsd: 104,
      openbsd: 104,
      netbsd: 104,
      plan9: 104,
      android: 104,
      haiku: 104,
      cygwin: 260,
    }[process.platform],
  );

  expect(() =>
    serve({
      unix: path,
      fetch(req) {
        return new Response("hello");
      },
    }),
  ).toThrow("too long");
});

it("throws an error when the directory is not found", () => {
  // this must be the filename specifically, because we add a workaround for the length limit on linux
  const unix = isWindows
    ? join("C:\\notfound", Math.random().toString(36).slice(2))
    : join("/notfound", Math.random().toString(36).slice(2));

  expect(() =>
    serve({
      unix,
      fetch(req) {
        return new Response("hello");
      },
    }),
  ).toThrow("no such file or directory");
});

if (process.platform === "linux") {
  it("works with abstract namespace", async () => {
    const unix = "\0" + Math.random().toString(36).slice(2).repeat(100).slice(0, 105);
    const server = Bun.serve({
      unix,
      fetch(req) {
        return new Response(req.body);
      },
    });

    expect(server.url.toString()).toBe(`abstract://${unix.slice(1)}/`);

    // POST with body
    for (let i = 0; i < 20; i++) {
      const response = await fetch("http://localhost/hello", { method: "POST", body: String(i), unix });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(String(i));
    }

    server.stop(true);
  });

  it("can workaround socket path length limit via /proc/self/fd/NN/ trick", async () => {
    const unix = join(tmpdirSync(), "fetch-unix.sock");
    const server = Bun.serve({
      unix,
      fetch(req) {
        return new Response(req.body);
      },
    });

    // POST with body
    for (let i = 0; i < 20; i++) {
      const response = await fetch("http://localhost/hello", { method: "POST", body: String(i), unix });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(String(i));
    }

    server.stop(true);
    try {
      rmSync(unix, {});
    } catch (e) {}
  });
}

if (process.platform === "linux" || process.platform === "darwin") {
  it("can workaround socket path length limit when only the directory is long", async () => {
    const base = tmpdirSync();
    let dir = base;
    while (dir.length + "/fetch-unix.sock".length < 130) {
      dir = join(dir, Buffer.alloc(40, "a").toString());
    }
    mkdirSync(dir, { recursive: true });
    const unix = join(dir, "fetch-unix.sock");
    expect(unix.length).toBeGreaterThanOrEqual(108);

    using server = Bun.serve({
      unix,
      fetch(req) {
        return new Response(req.body);
      },
    });

    for (let i = 0; i < 5; i++) {
      const response = await fetch("http://localhost/hello", { method: "POST", body: String(i), unix });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(String(i));
    }

    server.stop(true);
    try {
      rmSync(base, { recursive: true, force: true });
    } catch (e) {}
  });
}

let server_unix: Server,
  socketPath: string = "";

function startServerUnix({ fetch, ...options }: ServeOptions): string {
  if (socketPath) {
    server_unix.reload({ ...options, fetch });
    return socketPath;
  }
  const unix = `.${Math.random().toString(36).slice(2)}-socket`.slice(0, 103);
  server_unix = serve({
    ...options,
    fetch,
    unix,
  });
  return (socketPath = unix);
}

let server: Server;

function startServer({ fetch, ...options }: ServeOptions) {
  if (server) {
    server.reload({ ...options, fetch });
    return;
  }
  server = serve({
    ...options,
    fetch,
    port: 0,
  });
}

afterAll(() => {
  server_unix?.stop?.(true);
  server?.stop?.(true);
});

afterAll(() => {
  rmSync(tmp_dir, { force: true, recursive: true });
});

it("provide body", async () => {
  const path = startServerUnix({
    fetch(req) {
      return new Response(req.body);
    },
  });
  // POST with body
  for (let i = 0; i < 20; i++) {
    const response = await fetch("http://localhost/hello", { method: "POST", body: String(i), unix: path });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(String(i));
  }
});

it("works with node:http", async () => {
  const path = startServerUnix({
    fetch(req) {
      return new Response(req.body);
    },
  });

  const promises = [];
  for (let i = 0; i < 20; i++) {
    const { promise, resolve } = Promise.withResolvers<string>();
    const req = request(
      {
        path: "/hello",
        method: "POST",
        socketPath: path,
      },
      res => {
        let data = "";
        res.on("data", chunk => {
          data += chunk;
        });
        res.on("end", () => {
          resolve(data);
        });
      },
    );

    req.write(String(i));
    req.end();
    promises.push(promise.then(data => expect(data).toBe(String(i))));
  }

  await Promise.all(promises);
});

it.skipIf(isWindows)("reuses the connection (keep-alive)", async () => {
  function makeServer() {
    let connections = 0;
    const heads: string[] = [];
    const srv = createServer(sock => {
      connections++;
      let buf = "";
      sock.on("error", () => {});
      sock.on("data", d => {
        buf += d.toString("latin1");
        let i: number;
        while ((i = buf.indexOf("\r\n\r\n")) >= 0) {
          heads.push(buf.slice(0, i));
          buf = buf.slice(i + 4);
          sock.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
        }
      });
    });
    return { srv, connections: () => connections, heads };
  }

  const tcp = makeServer();
  tcp.srv.listen(0, "127.0.0.1");
  await once(tcp.srv, "listening");
  try {
    const tcpPort = (tcp.srv.address() as import("net").AddressInfo).port;
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`http://127.0.0.1:${tcpPort}/x`);
      expect(await res.text()).toBe("ok");
    }

    const sock = makeServer();
    const sockPath = join(tmpdirSync(), "ka.sock");
    sock.srv.listen(sockPath);
    await once(sock.srv, "listening");
    try {
      for (let i = 0; i < 3; i++) {
        const res = await fetch("http://localhost/x", { unix: sockPath });
        expect(await res.text()).toBe("ok");
      }

      const connHdr = /^connection: (.*)$/im.exec(sock.heads[0] ?? "")?.[1] ?? "(none)";
      expect({
        tcp_conns: tcp.connections(),
        unix_conns: sock.connections(),
        unix_request_connection_header: connHdr,
      }).toEqual({
        tcp_conns: 1,
        unix_conns: 1,
        unix_request_connection_header: "keep-alive",
      });
    } finally {
      sock.srv.close();
    }
  } finally {
    tcp.srv.close();
  }
});

it.skipIf(isWindows)("keep-alive pool is keyed by socket path", async () => {
  function makeServer() {
    let connections = 0;
    const srv = createServer(sock => {
      connections++;
      let buf = "";
      sock.on("error", () => {});
      sock.on("data", d => {
        buf += d.toString("latin1");
        let i: number;
        while ((i = buf.indexOf("\r\n\r\n")) >= 0) {
          buf = buf.slice(i + 4);
          sock.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
        }
      });
    });
    return { srv, connections: () => connections };
  }

  const dir = tmpdirSync();
  const a = makeServer();
  const b = makeServer();
  const aPath = join(dir, "a.sock");
  const bPath = join(dir, "b.sock");
  a.srv.listen(aPath);
  b.srv.listen(bPath);
  await Promise.all([once(a.srv, "listening"), once(b.srv, "listening")]);
  try {
    // Same URL, two socket paths — must not cross-reuse.
    for (let i = 0; i < 3; i++) {
      expect(await (await fetch("http://localhost/x", { unix: aPath })).text()).toBe("ok");
      expect(await (await fetch("http://localhost/x", { unix: bPath })).text()).toBe("ok");
    }
    // A TCP request to the same URL hostname must not reuse a pooled unix socket.
    await expect(fetch("http://localhost:1/x", { signal: AbortSignal.timeout(1000) })).rejects.toThrow();

    expect({ a: a.connections(), b: b.connections() }).toEqual({ a: 1, b: 1 });
  } finally {
    a.srv.close();
    b.srv.close();
  }
});

it("handle redirect to non-unix", async () => {
  startServer({
    async fetch(req) {
      if (req.url.endsWith("/world")) {
        return new Response("world");
      }
      return new Response(null, { status: 404 });
    },
  });
  const path = startServerUnix({
    fetch(req) {
      if (req.url.endsWith("/hello")) {
        return new Response(null, {
          status: 302,
          headers: { Location: `${server.url.origin}/world` },
        });
      }
      return new Response(null, { status: 404 });
    },
  });

  // POST with body
  for (let i = 0; i < 20; i++) {
    const response = await fetch("http://localhost/hello", { unix: path });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("world");
  }
});

import { serve, ServeOptions, Server } from "bun";
import { afterAll, expect, it } from "bun:test";
import { once } from "events";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tls, tmpdirSync } from "harness";
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
  function makeServer(name: string) {
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
          sock.write(`HTTP/1.1 200 OK\r\nContent-Length: ${name.length}\r\n\r\n${name}`);
        }
      });
    });
    return { srv, connections: () => connections };
  }

  const dir = tmpdirSync();
  const a = makeServer("a");
  const b = makeServer("b");
  const tcp = makeServer("tcp");
  const aPath = join(dir, "a.sock");
  const bPath = join(dir, "b.sock");
  a.srv.listen(aPath);
  b.srv.listen(bPath);
  tcp.srv.listen(0, "127.0.0.1");
  await Promise.all([once(a.srv, "listening"), once(b.srv, "listening"), once(tcp.srv, "listening")]);
  try {
    // The same URL reaches three servers: two socket paths and TCP. A pooled
    // connection must only ever be reused for the endpoint it is connected to.
    const url = `http://127.0.0.1:${(tcp.srv.address() as import("net").AddressInfo).port}/x`;
    const bodies: string[] = [];
    for (let i = 0; i < 3; i++) {
      bodies.push(await (await fetch(url, { unix: aPath })).text());
      bodies.push(await (await fetch(url, { unix: bPath })).text());
      bodies.push(await (await fetch(url)).text());
    }
    expect(bodies).toEqual(["a", "b", "tcp", "a", "b", "tcp", "a", "b", "tcp"]);
    expect({ a: a.connections(), b: b.connections(), tcp: tcp.connections() }).toEqual({ a: 1, b: 1, tcp: 1 });
  } finally {
    a.srv.close();
    b.srv.close();
    tcp.srv.close();
  }
});

it.skipIf(isWindows)("TLS over a unix socket is only reused for the hostname the handshake verified", async () => {
  const dir = tmpdirSync();
  const caPath = join(dir, "ca.pem");
  writeFileSync(caPath, tls.cert);
  // The harness cert is valid for "localhost". A pooled connection verified
  // for it must not serve a request to a different hostname over the same
  // socket path: that request has to handshake again and fail verification.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import { createServer } from "node:tls";
      const unix = ${JSON.stringify(join(dir, "tls.sock"))};
      const sockets = new Set();
      let handshakes = 0;
      const srv = createServer(${JSON.stringify(tls)}, sock => {
        handshakes++;
        let buf = "";
        sock.on("error", () => {});
        sock.on("data", d => {
          buf += d.toString("latin1");
          let i;
          while ((i = buf.indexOf("\\r\\n\\r\\n")) >= 0) {
            buf = buf.slice(i + 4);
            sock.write("HTTP/1.1 200 OK\\r\\nContent-Length: 2\\r\\n\\r\\nok");
          }
        });
      });
      // "connection" fires for the raw socket, before the handshake; the
      // rejected hostname below never completes one.
      srv.on("connection", sock => sockets.add(sock));
      srv.listen(unix);
      await new Promise(r => srv.once("listening", r));
      const out = {};
      out.first = await (await fetch("https://localhost/x", { unix })).text();
      out.second = await (await fetch("https://localhost/x", { unix })).text();
      out.afterLocalhost = { connections: sockets.size, handshakes };
      try {
        out.other = await (await fetch("https://foo.localhost/x", { unix })).text();
      } catch (e) {
        out.other = e.code;
      }
      out.afterOther = { connections: sockets.size, handshakes };
      console.log(JSON.stringify(out));
      for (const sock of sockets) sock.destroy();
      srv.close();
      `,
    ],
    env: { ...bunEnv, NODE_EXTRA_CA_CERTS: caPath },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    first: "ok",
    second: "ok",
    afterLocalhost: { connections: 1, handshakes: 1 },
    other: "ERR_TLS_CERT_ALTNAME_INVALID",
    afterOther: { connections: 2, handshakes: 1 },
  });
  expect(exitCode).toBe(0);
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

// Following a redirect hands a reusable connection to the keep-alive pool,
// keyed by the request URL's host and port. A unix-socket connection is not
// reusable that way: the request URL below names the TCP server, so pooling
// the unix connection would serve the TCP hop (and any later fetch of that
// host:port) from the unix server.
it("does not pool the unix-socket connection whose redirect is being followed", async () => {
  startServer({
    fetch(req) {
      return new Response(`tcp ${new URL(req.url).pathname}`);
    },
  });
  const path = startServerUnix({
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/hello") {
        return new Response(null, { status: 302, headers: { Location: "/world" } });
      }
      return new Response(`unix ${pathname}`);
    },
  });

  const results: string[] = [];
  for (let i = 0; i < 5; i++) {
    const response = await fetch(`http://127.0.0.1:${server.port}/hello`, { unix: path });
    results.push(`${response.status} ${response.redirected} ${await response.text()}`);
  }
  expect(results).toEqual(Array(5).fill("200 true tcp /world"));
});

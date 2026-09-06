import { serve, ServeOptions, Server } from "bun";
import { afterAll, expect, it } from "bun:test";
import { once } from "events";
import { mkdirSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, tls, tmpdirSync } from "harness";
import { request } from "http";
import { createServer } from "net";
import { join } from "path";
import { createServer as createTlsServer } from "tls";
const tmp_dir = tmpdirSync();

const unixSocketTest = Bun.env.BUN_OHOS === "1" ? it.skip : it;

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

unixSocketTest("provide body", async () => {
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

unixSocketTest("works with node:http", async () => {
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
    using dir = tempDir("fetch-unix-ka", {});
    const sockPath = join(String(dir), "ka.sock");
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

  using dir = tempDir("fetch-unix-pool-key", {});
  const a = makeServer("a");
  const b = makeServer("b");
  const tcp = makeServer("tcp");
  const aPath = join(String(dir), "a.sock");
  const bPath = join(String(dir), "b.sock");
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

it.skipIf(isWindows)("a relative socket path is resolved against the cwd at fetch() time", async () => {
  // Two servers listen on `x.sock` in different directories. The child starts
  // in `a`. The first fetch is still in flight when the cwd moves to `b`, so
  // its answer shows which cwd the connect used. The later fetches show the
  // pool key: keyed on the bare string, `x.sock` in `b` would reuse the
  // connection to `a`.
  using dir = tempDir("fetch-unix-relative", { a: {}, b: {} });
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const base = process.env.FETCH_UNIX_BASE;
      const servers = ["a", "b"].map(name =>
        Bun.serve({ unix: base + "/" + name + "/x.sock", fetch: () => new Response(name) }),
      );
      const get = unix => fetch("http://localhost/x", { unix }).then(res => res.text());
      const bodies = [];
      const inflight = get("x.sock");
      process.chdir(base + "/b");
      bodies.push(await inflight);
      bodies.push(await get("x.sock"));
      bodies.push(await get("./x.sock"));
      bodies.push(await get("../a/x.sock"));
      for (const name of ["a", "b"]) {
        process.chdir(base + "/" + name);
        bodies.push(await get("x.sock"));
      }
      console.log(JSON.stringify(bodies));
      for (const server of servers) server.stop(true);
      `,
    ],
    env: { ...bunEnv, FETCH_UNIX_BASE: String(dir) },
    cwd: join(String(dir), "a"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual(["a", "b", "b", "a", "a", "b"]);
  expect(exitCode).toBe(0);
});

it.skipIf(isWindows)("TLS over a unix socket is only reused for the hostname the handshake verified", async () => {
  using dir = tempDir("fetch-unix-tls", { "ca.pem": tls.cert });
  // The harness cert is valid for "localhost". A pooled connection verified
  // for it must not serve a request to a different hostname over the same
  // socket path: that request has to handshake again and fail verification.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import { createServer } from "node:tls";
      const unix = ${JSON.stringify(join(String(dir), "tls.sock"))};
      const sockets = new Set();
      const srv = createServer(${JSON.stringify(tls)}, sock => {
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
      // "connection" fires for the raw socket, before the handshake, so it
      // also counts the connection whose handshake the client rejects.
      srv.on("connection", sock => sockets.add(sock));
      srv.listen(unix);
      await new Promise(r => srv.once("listening", r));
      const out = {};
      out.first = await (await fetch("https://localhost/x", { unix })).text();
      out.second = await (await fetch("https://localhost/x", { unix })).text();
      out.connectionsAfterLocalhost = sockets.size;
      try {
        out.other = await (await fetch("https://foo.localhost/x", { unix })).text();
      } catch (e) {
        out.other = e.code;
      }
      out.connectionsAfterOther = sockets.size;
      console.log(JSON.stringify(out));
      for (const sock of sockets) sock.destroy();
      srv.close();
      `,
    ],
    env: { ...bunEnv, NODE_EXTRA_CA_CERTS: join(String(dir), "ca.pem") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    first: "ok",
    second: "ok",
    connectionsAfterLocalhost: 1,
    other: "ERR_TLS_CERT_ALTNAME_INVALID",
    connectionsAfterOther: 2,
  });
  expect(exitCode).toBe(0);
});

it.skipIf(isWindows)("TLS over a unix socket honors tls.ca", async () => {
  using dir = tempDir("fetch-unix-tls-ca", {});
  const unix = join(String(dir), "tls.sock");
  let connections = 0;
  const srv = createTlsServer(tls, sock => {
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
  srv.on("connection", () => connections++);
  srv.listen(unix);
  await once(srv, "listening");
  try {
    const bodies: string[] = [];
    for (let i = 0; i < 2; i++) {
      bodies.push(await (await fetch("https://localhost/x", { unix, tls: { ca: tls.cert } })).text());
    }
    expect({ bodies, connections }).toEqual({ bodies: ["ok", "ok"], connections: 1 });
  } finally {
    srv.close();
  }
});

it.skipIf(isWindows)("unix keep-alive entries are not evicted by TCP pool pressure", async () => {
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

  using dir = tempDir("fetch-unix-pool-pressure", {});
  const sockPath = join(String(dir), "p.sock");
  const unix = makeServer();
  unix.srv.listen(sockPath);
  // More distinct TCP origins than the TCP keep-alive pool holds, so the TCP
  // pool fills and evicts while the unix entry sits idle.
  const tcp = Array.from({ length: 70 }, () => makeServer());
  for (const t of tcp) t.srv.listen(0, "127.0.0.1");
  await Promise.all([once(unix.srv, "listening"), ...tcp.map(t => once(t.srv, "listening"))]);
  try {
    expect(await (await fetch("http://localhost/x", { unix: sockPath })).text()).toBe("ok");
    for (const t of tcp) {
      const port = (t.srv.address() as import("net").AddressInfo).port;
      expect(await (await fetch(`http://127.0.0.1:${port}/x`)).text()).toBe("ok");
    }
    expect(await (await fetch("http://localhost/x", { unix: sockPath })).text()).toBe("ok");
    expect(unix.connections()).toBe(1);
  } finally {
    unix.srv.close();
    for (const t of tcp) t.srv.close();
  }
});

unixSocketTest("handle redirect to non-unix", async () => {
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
unixSocketTest("does not pool the unix-socket connection whose redirect is being followed", async () => {
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

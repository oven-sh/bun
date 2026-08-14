import { serve, ServeOptions, Server } from "bun";
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { isWindows, tmpdirSync } from "harness";
import { request } from "http";
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
// either unix connection (the one that carried the 3xx or the one that served
// the hop) would make the plain fetch of that host:port talk to the unix server.
it("does not pool the unix-socket connections of a followed redirect", async () => {
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
    const redirected = await fetch(`http://127.0.0.1:${server.port}/hello`, { unix: path });
    const direct = await fetch(`http://127.0.0.1:${server.port}/world`);
    results.push(`${redirected.status} ${redirected.redirected} ${await redirected.text()} | ${await direct.text()}`);
  }
  expect(results).toEqual(Array(5).fill("200 true unix /world | tcp /world"));
});

// With `unix`, the URL's authority only fills in the Host header and is what a
// relative Location resolves against. A redirect that stays on that authority
// is still addressed to the unix server, so it is followed over the socket. To
// make a hop that leaves the socket visible (instead of failing to connect),
// every URL below names a live TCP listener.
describe("redirects over a unix socket", () => {
  let unixSeen: string[], tcpSeen: string[];
  let path: string, origin: string;

  beforeEach(() => {
    unixSeen = [];
    tcpSeen = [];
    startServer({
      fetch(req) {
        tcpSeen.push(`${req.method} ${new URL(req.url).pathname} authorization=${req.headers.get("authorization")}`);
        return new Response("tcp");
      },
    });
    origin = `http://127.0.0.1:${server.port}`;
    path = startServerUnix({
      async fetch(req) {
        const { pathname } = new URL(req.url);
        unixSeen.push(`${req.method} ${pathname} authorization=${req.headers.get("authorization")}`);
        switch (pathname) {
          case "/relative":
            return new Response(null, { status: 302, headers: { Location: "/done" } });
          case "/absolute":
            return new Response(null, { status: 302, headers: { Location: `${origin}/done` } });
          case "/chain":
            return new Response(null, { status: 302, headers: { Location: "/relative" } });
          case "/resend":
            return new Response(null, { status: 307, headers: { Location: "/echo" } });
          case "/leave":
            return new Response(null, { status: 302, headers: { Location: `${server.url.origin}/done` } });
          case "/echo":
            return new Response(`unix echo ${await req.text()}`);
        }
        return new Response(`unix ${pathname}`);
      },
    });
  });

  const headers = { Authorization: "Bearer daemon-token" };

  async function summarize(response: Response) {
    return {
      status: response.status,
      redirected: response.redirected,
      url: response.url,
      body: await response.text(),
      unixSeen,
      tcpSeen,
    };
  }

  it("follows a relative Location over the socket", async () => {
    const response = await fetch(`${origin}/relative`, { unix: path, headers });
    expect(await summarize(response)).toEqual({
      status: 200,
      redirected: true,
      url: `${origin}/done`,
      body: "unix /done",
      unixSeen: ["GET /relative authorization=Bearer daemon-token", "GET /done authorization=Bearer daemon-token"],
      tcpSeen: [],
    });
  });

  it("follows an absolute Location on the same authority over the socket", async () => {
    const response = await fetch(`${origin}/absolute`, { unix: path, headers });
    expect(await summarize(response)).toEqual({
      status: 200,
      redirected: true,
      url: `${origin}/done`,
      body: "unix /done",
      unixSeen: ["GET /absolute authorization=Bearer daemon-token", "GET /done authorization=Bearer daemon-token"],
      tcpSeen: [],
    });
  });

  it("stays on the socket across several hops", async () => {
    const response = await fetch(`${origin}/chain`, { unix: path, headers });
    expect(await summarize(response)).toEqual({
      status: 200,
      redirected: true,
      url: `${origin}/done`,
      body: "unix /done",
      unixSeen: [
        "GET /chain authorization=Bearer daemon-token",
        "GET /relative authorization=Bearer daemon-token",
        "GET /done authorization=Bearer daemon-token",
      ],
      tcpSeen: [],
    });
  });

  it("resends the body of a 307 over the socket", async () => {
    const response = await fetch(`${origin}/resend`, { unix: path, headers, method: "POST", body: "payload" });
    expect(await summarize(response)).toEqual({
      status: 200,
      redirected: true,
      url: `${origin}/echo`,
      body: "unix echo payload",
      unixSeen: ["POST /resend authorization=Bearer daemon-token", "POST /echo authorization=Bearer daemon-token"],
      tcpSeen: [],
    });
  });

  it("works with the usual placeholder host in the URL", async () => {
    const response = await fetch("http://localhost/relative", { unix: path, headers });
    expect(await summarize(response)).toEqual({
      status: 200,
      redirected: true,
      url: "http://localhost/done",
      body: "unix /done",
      unixSeen: ["GET /relative authorization=Bearer daemon-token", "GET /done authorization=Bearer daemon-token"],
      tcpSeen: [],
    });
  });

  // A Location on another authority names a different server (see "handle
  // redirect to non-unix" above): that hop leaves the socket and, like any
  // cross-origin redirect, goes out without the credentials.
  it("a Location on another authority leaves the socket without the credentials", async () => {
    expect(server.url.origin).not.toBe(origin);
    const response = await fetch(`${origin}/leave`, { unix: path, headers });
    expect(await summarize(response)).toEqual({
      status: 200,
      redirected: true,
      url: `${server.url.origin}/done`,
      body: "tcp",
      unixSeen: ["GET /leave authorization=Bearer daemon-token"],
      tcpSeen: ["GET /done authorization=null"],
    });
  });
});

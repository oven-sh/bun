import { serve, ServeOptions, Server } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tls as tlsCert, tmpdirSync } from "harness";
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

// `unix` names the transport, so http_proxy / https_proxy in the environment
// must not apply to the request (an explicit `proxy` alongside `unix` is
// rejected). If they did, the daemon would be sent the proxy flavour of the
// request: absolute-form for an http:// URL, a plaintext CONNECT for an
// https:// URL, either one carrying the proxy URL's credentials in
// Proxy-Authorization; and a redirect would be followed through the proxy.
describe("http_proxy / https_proxy in the environment are ignored when `unix` is given", () => {
  const plainSock = join(tmp_dir, "plain.sock");
  const tlsSock = join(tmp_dir, "tls.sock");
  // What the unix daemons received: request line, and whether a
  // Proxy-Authorization header came with it.
  const daemonLog: { line: string; proxyAuth: boolean }[] = [];
  // Request lines that reached the proxy named by the env.
  const proxyLog: string[] = [];
  let origin: Server;
  let proxy: ReturnType<typeof Bun.listen>;
  let plainDaemon: ReturnType<typeof Bun.listen>;
  let tlsDaemon: ReturnType<typeof Bun.listen>;

  // Raw HTTP/1.1 server that answers each connection's first request with
  // whatever `respond` returns for its header block.
  function recording(respond: (head: string[]) => string) {
    return {
      open(socket: Bun.Socket<{ buf: string }>) {
        socket.data = { buf: "" };
      },
      data(socket: Bun.Socket<{ buf: string }>, chunk: Uint8Array) {
        const buf = (socket.data.buf += new TextDecoder("latin1").decode(chunk));
        const end = buf.indexOf("\r\n\r\n");
        if (end < 0) return;
        socket.end(respond(buf.slice(0, end).split("\r\n")));
      },
      error() {},
    };
  }

  function daemon(head: string[]) {
    daemonLog.push({ line: head[0], proxyAuth: head.some(h => /^proxy-authorization:/i.test(h)) });
    // Matched in both origin-form and absolute-form so the redirect hop is
    // exercised either way.
    if (/^GET \S*\/redirect /.test(head[0])) {
      return `HTTP/1.1 302 Found\r\nLocation: ${origin.url.origin}/final\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`;
    }
    return "HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\ndaemon";
  }

  beforeAll(() => {
    origin = serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("origin") });
    proxy = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: recording(head => {
        proxyLog.push(head[0]);
        return "HTTP/1.1 200 OK\r\nContent-Length: 9\r\nConnection: close\r\n\r\nvia-proxy";
      }),
    });
    plainDaemon = Bun.listen({ unix: plainSock, socket: recording(daemon) });
    tlsDaemon = Bun.listen({ unix: tlsSock, tls: tlsCert, socket: recording(daemon) });
  });

  afterAll(() => {
    origin.stop(true);
    proxy.stop(true);
    plainDaemon.stop(true);
    tlsDaemon.stop(true);
  });

  async function fetchInChild(url: string, unix?: string) {
    daemonLog.length = 0;
    proxyLog.length = 0;
    const env = { ...bunEnv };
    for (const key of ["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY", "no_proxy", "NO_PROXY"])
      delete env[key];
    env.http_proxy = env.https_proxy = `http://user:pass@127.0.0.1:${proxy.port}`;
    env.URL_TO_FETCH = url;
    if (unix !== undefined) env.UNIX_SOCKET = unix;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { URL_TO_FETCH, UNIX_SOCKET } = process.env;
         const res = await fetch(URL_TO_FETCH, UNIX_SOCKET ? { unix: UNIX_SOCKET, tls: { rejectUnauthorized: false } } : {});
         console.log(res.status, await res.text());`,
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode,
      daemonLog: [...daemonLog],
      proxyLog: [...proxyLog],
    };
  }

  it("control: the same environment does route a TCP fetch through the proxy", async () => {
    expect(await fetchInChild(`${origin.url.origin}/final`)).toEqual({
      stdout: "200 via-proxy",
      stderr: "",
      exitCode: 0,
      daemonLog: [],
      proxyLog: [`GET http://127.0.0.1:${origin.port}/final HTTP/1.1`],
    });
  });

  it("http:// URL: the daemon gets an origin-form request without the proxy credentials", async () => {
    expect(await fetchInChild("http://daemon.invalid/v1/x", plainSock)).toEqual({
      stdout: "200 daemon",
      stderr: "",
      exitCode: 0,
      daemonLog: [{ line: "GET /v1/x HTTP/1.1", proxyAuth: false }],
      proxyLog: [],
    });
  });

  it("https:// URL: TLS is spoken to the daemon itself instead of sending it a CONNECT", async () => {
    expect(await fetchInChild("https://daemon.invalid/v1/y", tlsSock)).toEqual({
      stdout: "200 daemon",
      stderr: "",
      exitCode: 0,
      daemonLog: [{ line: "GET /v1/y HTTP/1.1", proxyAuth: false }],
      proxyLog: [],
    });
  });

  it("a redirect off the unix socket is followed directly, not through the proxy", async () => {
    expect(await fetchInChild("http://daemon.invalid/redirect", plainSock)).toEqual({
      stdout: "200 origin",
      stderr: "",
      exitCode: 0,
      daemonLog: [{ line: "GET /redirect HTTP/1.1", proxyAuth: false }],
      proxyLog: [],
    });
  });
});

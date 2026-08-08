import { serve, ServeOptions, Server } from "bun";
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { isWindows, tempDir, tmpdirSync, tls as validTls } from "harness";
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

// Per-request `tls` options that require a custom SSL_CTX (ca / cert / key /
// ciphers / minVersion / ...) must be applied when the transport is a unix
// socket, exactly as they are for a TCP connect to the same server. The
// failure mode was that the unix-socket connect path returned on the default
// HTTPS context before the per-request SSL_CTX was resolved, so every
// context-level option was silently dropped.
describe.skipIf(isWindows)("tls over unix socket", () => {
  it("honors tls.ca for server verification", async () => {
    using dir = tempDir("fetch-unix-tls-ca", {});
    const unix = join(String(dir), "s.sock");
    using server = Bun.serve({
      unix,
      tls: { cert: validTls.cert, key: validTls.key },
      fetch: () => new Response("ok"),
    });
    const res = await fetch("https://localhost/", { unix, tls: { ca: validTls.cert } });
    expect(await res.text()).toBe("ok");
    expect(res.status).toBe(200);
  });

  it("presents tls.cert + tls.key to a requestCert server (mTLS)", async () => {
    using dir = tempDir("fetch-unix-tls-mtls", {});
    const unix = join(String(dir), "s.sock");
    using server = Bun.serve({
      unix,
      tls: {
        cert: validTls.cert,
        key: validTls.key,
        ca: validTls.cert,
        requestCert: true,
        rejectUnauthorized: true,
      },
      fetch: () => new Response("ok-mtls"),
    });
    const res = await fetch("https://localhost/", {
      unix,
      tls: { ca: validTls.cert, cert: validTls.cert, key: validTls.key },
    });
    expect(await res.text()).toBe("ok-mtls");
    expect(res.status).toBe(200);
  });

  it("rejects an invalid tls.ciphers string the same way a TCP connect does", async () => {
    using dir = tempDir("fetch-unix-tls-ciphers", {});
    const unix = join(String(dir), "s.sock");
    using server = Bun.serve({
      unix,
      tls: { cert: validTls.cert, key: validTls.key },
      fetch: () => new Response("ok"),
    });
    // A ciphers string BoringSSL cannot parse fails SSL_CTX creation. Over
    // TCP this surfaces as FailedToOpenSocket; over a unix socket it must
    // fail the same way rather than being ignored. rejectUnauthorized is off
    // so the only failure source is the ciphers option itself.
    await expect(
      fetch("https://localhost/", { unix, tls: { rejectUnauthorized: false, ciphers: "NOT-A-REAL-CIPHER" } }),
    ).rejects.toMatchObject({ code: "FailedToOpenSocket" });
  });
});

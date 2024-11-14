import { serve, ServeOptions, Server } from "bun";
import { afterAll, expect, it } from "bun:test";
import { rmSync } from "fs";
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
  ).toThrow("No such file or directory");
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

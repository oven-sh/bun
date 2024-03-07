import { serve, ServeOptions, Server } from "bun";
import { afterAll, afterEach, expect, it } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { request } from "http";
const tmp_dir = mkdtempSync(join(realpathSync(tmpdir()), "fetch.unix.test"));

let server_unix: Server;
function startServerUnix({ fetch, ...options }: ServeOptions): string {
  const socketPath = join(tmp_dir, `socket-${Math.random().toString(36).slice(2)}`);
  server_unix = serve({
    ...options,
    fetch,
    unix: socketPath,
  });
  return socketPath;
}

let server: Server;
function startServer({ fetch, ...options }: ServeOptions) {
  server = serve({
    ...options,
    fetch,
    port: 0,
  });
}

afterEach(() => {
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

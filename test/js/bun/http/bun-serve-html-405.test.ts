import { expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import { join } from "path";

test("dev server html route: non-GET/HEAD requests complete without hanging", async () => {
  const dir = tempDirWithFiles("html-route-405", {
    "index.html": `<!DOCTYPE html><html><head><title>t</title></head><body>hi</body></html>`,
  });
  const { default: html } = await import(join(dir, "index.html"));

  using server = Bun.serve({
    port: 0,
    development: true,
    routes: { "/": html },
    fetch(req) {
      return new Response("Not found", { status: 404 });
    },
  });

  // GET should serve the page.
  {
    const res = await fetch(server.url);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>t</title>");
  }

  // Non-GET/HEAD requests used to write a bare `405` status line with no
  // Content-Length, so HTTP/1.1 keep-alive clients would block forever
  // waiting for framing.
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS", "PATCH"]) {
    const res = await fetch(server.url, { method });
    await res.arrayBuffer();
    expect({ method, status: res.status, contentLength: res.headers.get("content-length") }).toEqual({
      method,
      status: 405,
      contentLength: "0",
    });
  }
});

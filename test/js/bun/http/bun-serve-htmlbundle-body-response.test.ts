import { HTMLBundle } from "bun";
import { expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import { join } from "path";

const dir = tempDirWithFiles("htmlbundle", {
  "index.html": "<!DOCTYPE html><html><body>Hello HTML</body></html>",
});

const html = (await import(join(dir, "index.html"))).default as HTMLBundle;

test("fetch routes HTMLBundle", async () => {
  using server = Bun.serve({
    port: 0,
    routes: {
      "/": html,
    },
  });

  const res = await fetch(server.url);
  expect(await res.text()).toContain("Hello HTML");

  const missing = await fetch(`${server.url}/missing`);
  expect(missing.status).toBe(404); // Esto depende de cómo Bun maneja rutas faltantes
});

test("fetch Response(HTMLBundle)", async () => {
  using server = Bun.serve({
    port: 0,
    routes: {
      "/": new Response(html),
    },
  });

  const res = await fetch(server.url);
  expect(await res.text()).toContain("Hello HTML");
  const missing = await fetch(`${server.url}/missing`);
  expect(missing.status).toBe(404);
});

test("fetch async () => Response(HTMLBundle)", async () => {
  using server = Bun.serve({
    port: 0,
    routes: {
      "/": async () => {
        await Bun.sleep(1000);
        return new Response(html);
      },
    },
  });

  const res = await fetch(server.url);
  const text = await res.text();
  expect(text).toContain("Hello HTML");
  const missing = await fetch(`${server.url}/missing`);
  expect(missing.status).toBe(404);
});

test("fetch async () => Response(HTMLBundle) with headers", async () => {
  using server = Bun.serve({
    port: 0,
    routes: {
      "/": async () => {
        return new Response(html, { status: 401, headers: { "X-Test": "true" } });
      },
    },
  });

  const res = await fetch(server.url);
  expect(res.status).toBe(401);
  expect(res.headers.get("x-test")).toBe("true");
  const text = await res.text();
  expect(text).toContain("Hello HTML");
});

test("fetch () => Response(HTMLBundle)", async () => {
  using server = Bun.serve({
    port: 0,
    routes: {
      "/": () => new Response(html),
    },
  });

  const res = await fetch(server.url);
  const text = await res.text();
  expect(text).toContain("Hello HTML");
  const missing = await fetch(`${server.url}/missing`);
  expect(missing.status).toBe(404);
});
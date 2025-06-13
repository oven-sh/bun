import { type HTMLBundle } from "bun";
import { expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import { join } from "path";

const dir = tempDirWithFiles("htmlbundle", {
  "index.html": "<!DOCTYPE html><html><body>Hello HTML</body></html>",
});

const { default: html }: { default: HTMLBundle } = await import(join(dir, "index.html"));

test("fetch routes HTMLBundle", async () => {
  using server = Bun.serve({
    port: 0,
    routes: {
      "/": html,
    },
  });

  const res = await fetch(server.url);
  expect(await res.text()).toContain("Hello HTML");
  const missing = await fetch(`${server.url}/index.html`);
  expect(missing.status).toBe(404);
  await server.stop();
});

test("fetch Sleep 1s Response(HTMLBundle)", async () => {
  using server = Bun.serve({
    port: 0,
    routes: {
      "/": async () => {
        Bun.sleep(1000);
        return new Response(html);
      },
    },
  });

  const res = await fetch(server.url);
  expect(await res.text()).toContain("Hello HTML");
  const missing = await fetch(`${server.url}/index.html`);
  expect(missing.status).toBe(404);
});

test("fetch Response(HTMLBundle)", async () => {
  using server = Bun.serve({
    port: 0,
    routes: {
      "/": new Response(html),
    },
  });

  const res = await fetch(server.url);
  await server.stop();
  expect(await res.text()).toContain("Hello HTML");
  const missing = await fetch(`${server.url}/index.html`);
  expect(missing.status).toBe(404);
});

test("fetch Response(HTMLBundle) headers", async () => {
  using server = Bun.serve({
    port: 0,
    routes: {
      "/": async () => {
        return new Response(html, { status: 401, headers: { "X-Test": "true" } });
      },
    },
  });

  const res = await fetch(server.url);
  await server.stop();
  expect(res.status).toBe(401);
  expect(res.headers.get("x-test")).toBe("true");
});

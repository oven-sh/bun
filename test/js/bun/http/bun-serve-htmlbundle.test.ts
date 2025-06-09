import { type HTMLBundle } from "bun";
import { expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import { join } from "path";

// returning HTMLBundle directly works
test("fetch routes HTMLBundle", async () => {
  const dir = tempDirWithFiles("htmlbundle", {
    "index.html": "<!DOCTYPE html><html><body>Hello HTML</body></html>",
  });

  const { default: html }: { default: HTMLBundle } = await import(join(dir, "index.html"));

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
});

// returning HTMLBundle from a function should work
test("routes () => HTMLBundle", async () => {
  const dir = tempDirWithFiles("htmlbundle", {
    "index.html": "<!DOCTYPE html><html><body>Hello HTML</body></html>",
  });

  const { default: html }: { default: HTMLBundle } = await import(join(dir, "index.html"));

  using server = Bun.serve({
    port: 0,
    routes: {
      "/": () => html,
    },
  });

  const res = await fetch(server.url);
  expect(await res.text()).toContain("Hello HTML");
  const missing = await fetch(`${server.url}/index.html`);
  expect(missing.status).toBe(404);
});
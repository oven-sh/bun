import { test, expect } from "bun:test";
import { tempDirWithFiles } from "harness";
import { join } from "path";

test("Response(htmlImport)", async () => {
  const dir = tempDirWithFiles("response-htmlbundle", {
    "index.html": "<!DOCTYPE html><html><body>Hello HTML</body></html>",
  });
  const { default: html } = await import(join(dir, "index.html"));
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(html);
    },
  });
  const res = await fetch(server.url);
  expect(await res.text()).toContain("Hello HTML");
  const missing = await fetch(server.url + "/index.html");
  expect(missing.status).toBe(404);
});

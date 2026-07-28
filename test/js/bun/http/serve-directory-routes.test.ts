import { serve, type Server } from "bun";
import { afterEach, describe, expect, it } from "bun:test";
import { symlinkSync } from "fs";
import { isLinux, tempDir } from "harness";
import { join } from "path";

describe("Bun.serve() directory routes", () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  it("serves files from a directory at /*", async () => {
    using dir = tempDir("serve-dir-root", {
      "public/index.html": "<h1>Hello World</h1>",
      "public/style.css": "body { margin: 0; }",
      "public/script.js": "console.log('hello');",
    });

    server = serve({
      port: 0,
      routes: { "/*": { dir: join(String(dir), "public") } },
    });

    const html = await fetch(`${server.url}index.html`);
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toContain("text/html");
    expect(await html.text()).toBe("<h1>Hello World</h1>");

    const css = await fetch(`${server.url}style.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
    expect(await css.text()).toBe("body { margin: 0; }");

    const js = await fetch(`${server.url}script.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
    expect(await js.text()).toBe("console.log('hello');");
  });

  it("serves nested directories", async () => {
    using dir = tempDir("serve-dir-nested", {
      "public/assets/images/logo.svg": "<svg></svg>",
      "public/assets/styles/main.css": "body { color: red; }",
      "public/js/app.js": "const x = 1;",
    });

    server = serve({
      port: 0,
      routes: { "/*": { dir: join(String(dir), "public") } },
    });

    expect(await (await fetch(`${server.url}assets/images/logo.svg`)).text()).toBe("<svg></svg>");
    expect(await (await fetch(`${server.url}assets/styles/main.css`)).text()).toBe("body { color: red; }");
    expect(await (await fetch(`${server.url}js/app.js`)).text()).toBe("const x = 1;");
  });

  it("serves from a custom prefix", async () => {
    using dir = tempDir("serve-dir-prefix", {
      "assets/file.txt": "Hello from assets",
      "assets/sub/deep.txt": "deep",
    });

    server = serve({
      port: 0,
      routes: { "/static/*": { dir: join(String(dir), "assets") } },
      fetch: () => new Response("fallback", { status: 404 }),
    });

    const res = await fetch(`${server.url}static/file.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Hello from assets");

    const deep = await fetch(`${server.url}static/sub/deep.txt`);
    expect(deep.status).toBe(200);
    expect(await deep.text()).toBe("deep");
  });

  it("serves index.html for directory requests", async () => {
    using dir = tempDir("serve-dir-index", {
      "public/index.html": "<h1>root</h1>",
      "public/sub/index.html": "<h1>sub</h1>",
    });

    server = serve({
      port: 0,
      routes: { "/*": { dir: join(String(dir), "public") } },
    });

    const root = await fetch(`${server.url}`);
    expect(root.status).toBe(200);
    expect(root.headers.get("content-type")).toContain("text/html");
    expect(await root.text()).toBe("<h1>root</h1>");

    const sub = await fetch(`${server.url}sub/`);
    expect(sub.status).toBe(200);
    expect(await sub.text()).toBe("<h1>sub</h1>");

    const subNoSlash = await fetch(`${server.url}sub`);
    expect(subNoSlash.status).toBe(200);
    expect(await subNoSlash.text()).toBe("<h1>sub</h1>");
  });

  it("falls through to fetch for missing files", async () => {
    using dir = tempDir("serve-dir-404", {
      "public/exists.txt": "yes",
    });

    server = serve({
      port: 0,
      routes: { "/static/*": { dir: join(String(dir), "public") } },
      fetch: () => new Response("fallback", { status: 404 }),
    });

    const hit = await fetch(`${server.url}static/exists.txt`);
    expect(hit.status).toBe(200);
    expect(await hit.text()).toBe("yes");

    const miss = await fetch(`${server.url}static/nope.txt`);
    expect(miss.status).toBe(404);
    expect(await miss.text()).toBe("fallback");
  });

  it("supports HEAD", async () => {
    using dir = tempDir("serve-dir-head", {
      "public/large.txt": Buffer.alloc(10000, "x").toString(),
    });

    server = serve({
      port: 0,
      routes: { "/*": { dir: join(String(dir), "public") } },
    });

    const res = await fetch(`${server.url}large.txt`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("10000");
    expect(await res.text()).toBe("");
  });

  it("sends Last-Modified and a weak ETag", async () => {
    using dir = tempDir("serve-dir-lm", {
      "public/data.json": '{"key":"value"}',
    });

    server = serve({
      port: 0,
      routes: { "/*": { dir: join(String(dir), "public") } },
    });

    const res = await fetch(`${server.url}data.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("last-modified")).toBeTruthy();
    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
  });

  it("honors If-None-Match with 304", async () => {
    using dir = tempDir("serve-dir-inm", {
      "public/data.json": '{"key":"value"}',
    });

    server = serve({
      port: 0,
      routes: { "/*": { dir: join(String(dir), "public") } },
    });

    const first = await fetch(`${server.url}data.json`);
    const etag = first.headers.get("etag")!;
    expect(etag).toBeTruthy();

    const second = await fetch(`${server.url}data.json`, {
      headers: { "if-none-match": etag },
    });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
  });

  it("honors If-Modified-Since with 304", async () => {
    using dir = tempDir("serve-dir-ims", {
      "public/data.json": '{"key":"value"}',
    });

    server = serve({
      port: 0,
      routes: { "/*": { dir: join(String(dir), "public") } },
    });

    const first = await fetch(`${server.url}data.json`);
    const lm = first.headers.get("last-modified")!;
    expect(lm).toBeTruthy();

    const second = await fetch(`${server.url}data.json`, {
      headers: { "if-modified-since": lm },
    });
    expect(second.status).toBe(304);

    const stale = await fetch(`${server.url}data.json`, {
      headers: { "if-modified-since": "Sat, 01 Jan 2000 00:00:00 GMT" },
    });
    expect(stale.status).toBe(200);
    expect(await stale.text()).toBe('{"key":"value"}');
  });

  it("handles Range requests", async () => {
    using dir = tempDir("serve-dir-range", {
      "public/data.bin": "0123456789",
    });

    server = serve({
      port: 0,
      routes: { "/*": { dir: join(String(dir), "public") } },
    });

    const res = await fetch(`${server.url}data.bin`, {
      headers: { range: "bytes=2-5" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await res.text()).toBe("2345");

    const unsat = await fetch(`${server.url}data.bin`, {
      headers: { range: "bytes=100-200" },
    });
    expect(unsat.status).toBe(416);
    expect(unsat.headers.get("content-range")).toBe("bytes */10");
  });

  it("rejects path traversal", async () => {
    using dir = tempDir("serve-dir-traversal", {
      "secret.txt": "SECRET",
      "public/ok.txt": "ok",
    });

    server = serve({
      port: 0,
      routes: { "/static/*": { dir: join(String(dir), "public") } },
      fetch: () => new Response("fallback", { status: 404 }),
    });

    expect(await (await fetch(`${server.url}static/ok.txt`)).text()).toBe("ok");

    // fetch() normalizes `..` in the URL client-side, so send the raw bytes
    // over a socket to exercise the server's resolver.
    async function raw(path: string): Promise<{ status: number; body: string }> {
      const { promise, resolve } = Promise.withResolvers<string>();
      let buf = "";
      const sock = await Bun.connect({
        hostname: "127.0.0.1",
        port: server!.port,
        socket: {
          data(_s, chunk) {
            buf += chunk.toString("latin1");
          },
          close() {
            resolve(buf);
          },
          error() {
            resolve(buf);
          },
        },
      });
      sock.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
      const full = await promise;
      const status = parseInt(full.slice(9, 12), 10);
      const body = full.split("\r\n\r\n").slice(1).join("\r\n\r\n");
      return { status, body };
    }

    for (const p of [
      "/static/../secret.txt",
      "/static/..%2Fsecret.txt",
      "/static/%2e%2e/secret.txt",
      "/static/%2e%2e%2fsecret.txt",
      "/static/ok.txt/../../secret.txt",
      "/static/a%00.txt",
      "/static/a%5Cb.txt",
    ]) {
      const { status, body } = await raw(p);
      expect(body).not.toContain("SECRET");
      expect([404, 400]).toContain(status);
    }

    // Double-encoded `..` should decode once to `%2e%2e` and miss on disk.
    const dbl = await raw("/static/%252e%252e/secret.txt");
    expect(dbl.body).not.toContain("SECRET");
  });

  it.skipIf(!isLinux)("rejects symlink escapes on Linux via RESOLVE_IN_ROOT", async () => {
    using dir = tempDir("serve-dir-symlink", {
      "secret.txt": "SECRET",
      "public/ok.txt": "ok",
      "public/inside.txt": "inside",
    });

    const root = String(dir);
    // Absolute target: IN_ROOT resolves it against dirfd, so this looks for
    // public/<abs path> which doesn't exist.
    symlinkSync(join(root, "secret.txt"), join(root, "public", "escape-abs"));
    // Relative target climbing out: `..` is clamped at the root.
    symlinkSync("../secret.txt", join(root, "public", "escape-rel"));
    symlinkSync("inside.txt", join(root, "public", "alias"));

    server = serve({
      port: 0,
      routes: { "/static/*": { dir: join(root, "public") } },
      fetch: () => new Response("fallback", { status: 404 }),
    });

    // Symlink that stays inside the root is allowed.
    const inside = await fetch(`${server.url}static/alias`);
    expect(inside.status).toBe(200);
    expect(await inside.text()).toBe("inside");

    // Symlinks that escape the root are clamped by the kernel.
    for (const name of ["escape-abs", "escape-rel"]) {
      const res = await fetch(`${server.url}static/${name}`);
      expect(await res.text()).not.toContain("SECRET");
      expect(res.status).toBe(404);
    }
  });

  it("percent-decodes file names", async () => {
    using dir = tempDir("serve-dir-pct", {
      "public/hello world.txt": "hi",
    });

    server = serve({
      port: 0,
      routes: { "/*": { dir: join(String(dir), "public") } },
    });

    const res = await fetch(`${server.url}hello%20world.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hi");
  });

  it("ignores the query string", async () => {
    using dir = tempDir("serve-dir-query", {
      "public/app.js": "ok",
      "public/index.html": "root",
    });

    server = serve({
      port: 0,
      routes: { "/*": { dir: join(String(dir), "public") } },
    });

    const res = await fetch(`${server.url}app.js?v=abc123`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");

    const root = await fetch(`${server.url}?foo=bar`);
    expect(root.status).toBe(200);
    expect(await root.text()).toBe("root");
  });

  it("supports multiple directory routes", async () => {
    using dir = tempDir("serve-dir-multi", {
      "a/one.txt": "one",
      "b/two.txt": "two",
    });

    server = serve({
      port: 0,
      routes: {
        "/a/*": { dir: join(String(dir), "a") },
        "/b/*": { dir: join(String(dir), "b") },
      },
    });

    expect(await (await fetch(`${server.url}a/one.txt`)).text()).toBe("one");
    expect(await (await fetch(`${server.url}b/two.txt`)).text()).toBe("two");
  });

  it("rejects non-wildcard paths", () => {
    using dir = tempDir("serve-dir-nowild", { "public/x.txt": "x" });
    expect(() =>
      serve({
        port: 0,
        routes: { "/static": { dir: join(String(dir), "public") } },
      }),
    ).toThrow(/ends in `\/\*`/);
  });

  it("throws if the directory does not exist", () => {
    expect(() =>
      serve({
        port: 0,
        routes: { "/static/*": { dir: "/nonexistent/path/that/does/not/exist" } },
      }),
    ).toThrow(expect.objectContaining({ code: "ENOENT" }));
  });

  it("is reflected in server.routes", async () => {
    // Ensure DirectoryRoute is wired through AnyRoute introspection without
    // crashing (guards the match arms added for the new variant).
    using dir = tempDir("serve-dir-introspect", { "public/x.txt": "x" });
    server = serve({
      port: 0,
      routes: { "/static/*": { dir: join(String(dir), "public") } },
    });
    expect(await (await fetch(`${server.url}static/x.txt`)).text()).toBe("x");
    server.reload({
      routes: { "/static/*": { dir: join(String(dir), "public") } },
    });
    expect(await (await fetch(`${server.url}static/x.txt`)).text()).toBe("x");
  });
});

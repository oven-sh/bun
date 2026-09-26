import { serve, type Server } from "bun";
import { afterEach, describe, expect, it } from "bun:test";
import { symlinkSync } from "fs";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "path";

const strace = isLinux ? Bun.which("strace") : null;
const straceEnv = {
  ...bunEnv,
  ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
  LSAN_OPTIONS: "detect_leaks=0",
};
const straceInjectArgs = (traceFile: string) => [
  "-o",
  traceFile,
  "-e",
  "trace=openat2",
  "-e",
  "inject=openat2:error=EPERM:when=1",
];
const canInjectOpenat2Error =
  !!strace &&
  Bun.spawnSync({
    cmd: [strace, ...straceInjectArgs("/dev/null"), bunExe(), "--version"],
    env: straceEnv,
    stdout: "ignore",
    stderr: "ignore",
  }).exitCode === 0;

describe("Bun.serve() directory routes", () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  // fetch() normalizes `..` client-side, so the traversal/adversarial tests
  // send raw request bytes over a socket.
  async function raw(
    path: string,
  ): Promise<{ status: number; headers: Record<string, string>; head: string; body: string }> {
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
    const headEnd = full.indexOf("\r\n\r\n");
    const head = full.slice(0, headEnd);
    const headers: Record<string, string> = {};
    for (const line of head.slice(head.indexOf("\r\n") + 2).split("\r\n")) {
      const i = line.indexOf(":");
      if (i > 0) headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
    }
    const body = full.slice(headEnd + 4);
    return { status, headers, head, body };
  }

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

    // Without a trailing slash the server 301-redirects to the slash form so
    // the followed request re-enters routing.
    const noSlash = await fetch(`${server.url}sub`, { redirect: "manual" });
    expect(noSlash.status).toBe(301);
    expect(noSlash.headers.get("location")).toBe("/sub/");

    const withQuery = await fetch(`${server.url}sub?v=1`, { redirect: "manual" });
    expect(withQuery.status).toBe(301);
    expect(withQuery.headers.get("location")).toBe("/sub/?v=1");

    const followed = await fetch(`${server.url}sub`);
    expect(followed.status).toBe(200);
    expect(await followed.text()).toBe("<h1>sub</h1>");

    // A trailing slash on a regular file is a miss (nginx/send behavior).
    const fileSlash = await fetch(`${server.url}index.html/`, { redirect: "manual" });
    expect(fileSlash.status).toBe(404);
  });

  it("sets Content-Type case-insensitively by extension", async () => {
    using dir = tempDir("serve-dir-mime-case", {
      "public/photo.JPG": Buffer.alloc(8, 0).toString("binary"),
      "public/style.CSS": "body{}",
      "public/app.MJS": "export{}",
    });
    server = serve({
      port: 0,
      routes: { "/*": { dir: join(String(dir), "public") } },
    });

    const jpg = await fetch(`${server.url}photo.JPG`);
    expect(jpg.status).toBe(200);
    expect(jpg.headers.get("content-type")).toContain("image/jpeg");

    const css = await fetch(`${server.url}style.CSS`);
    expect(css.headers.get("content-type")).toContain("text/css");

    const mjs = await fetch(`${server.url}app.MJS`);
    expect(mjs.headers.get("content-type")).toContain("javascript");
  });

  describe.each(["/static/*", "/*"] as const)("mounted at %s", prefix => {
    const base = prefix === "/*" ? "" : "static/";
    it("returns 404 for missing files", async () => {
      using dir = tempDir("serve-dir-404", {
        "public/exists.txt": "yes",
      });

      server = serve({
        port: 0,
        routes: { [prefix]: { dir: join(String(dir), "public") } },
        fetch: () => new Response("fallback", { status: 200 }),
      });

      const hit = await fetch(`${server.url}${base}exists.txt`);
      expect(hit.status).toBe(200);
      expect(await hit.text()).toBe("yes");

      // A miss returns a plain 404 from the directory route itself; the
      // fetch handler is not consulted for paths under the mounted prefix.
      const miss = await fetch(`${server.url}${base}nope.txt`);
      expect(miss.status).toBe(404);
      expect(await miss.text()).toBe("");
    });
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

    for (const p of [
      "/static/../secret.txt",
      "/static/..%2Fsecret.txt",
      "/static/%2e%2e/secret.txt",
      "/static/%2e%2e%2fsecret.txt",
      "/static/ok.txt/../../secret.txt",
      "/static/a%00.txt",
      "/static/a%5Cb.txt",
      "/static/c:/windows/win.ini",
      "/static/c%3A/windows/win.ini",
      "/static/ok.txt::$DATA",
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

  it.skipIf(!canInjectOpenat2Error)("keeps clamping symlinks to the root after an open error on one path", async () => {
    using dir = tempDir("serve-dir-open-error", {
      "secret.txt": "SECRET",
      "public/ok.txt": "ok",
    });
    const root = String(dir);
    symlinkSync("../secret.txt", join(root, "public", "escape-rel"));
    symlinkSync(join(root, "secret.txt"), join(root, "public", "escape-abs"));

    const script = `
        const server = Bun.serve({
          port: 0,
          routes: { "/static/*": { dir: ${JSON.stringify(join(root, "public"))} } },
        });
        const out = [];
        for (const p of ["escape-rel", "escape-abs", "ok.txt"]) {
          const res = await fetch(server.url + "static/" + p);
          out.push([res.status, await res.text()]);
        }
        server.stop(true);
        console.log(JSON.stringify(out));
      `;
    const traceFile = join(root, "strace.log");
    await using proc = Bun.spawn({
      cmd: [strace!, ...straceInjectArgs(traceFile), bunExe(), "-e", script],
      env: straceEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const trace = await Bun.file(traceFile).text();
    expect(trace, stderr).toMatch(/openat2\(.*"escape-rel".*= -1 EPERM .*\(INJECTED\)/);
    expect(stdout.trim(), stderr).toBe(`[[404,""],[404,""],[200,"ok"]]`);
    expect(exitCode).toBe(0);
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

  it("rejects :parameters in the route path", () => {
    using dir = tempDir("serve-dir-param", { "public/x.txt": "x" });
    expect(() =>
      serve({
        port: 0,
        routes: { "/users/:id/files/*": { dir: join(String(dir), "public") } },
      }),
    ).toThrow(/do not support :parameters/);
  });

  it("rejects empty segments in the route path", () => {
    using dir = tempDir("serve-dir-empty-seg", { "public/x.txt": "x" });
    for (const key of ["//*", "//assets/*", "/a//*"]) {
      expect(() =>
        serve({
          port: 0,
          routes: { [key]: { dir: join(String(dir), "public") } },
        }),
      ).toThrow(/empty segments/);
    }
  });

  it("throws if the directory does not exist", () => {
    using dir = tempDir("serve-dir-enoent", {});
    expect(() =>
      serve({
        port: 0,
        routes: { "/static/*": { dir: join(String(dir), "does-not-exist") } },
      }),
    ).toThrow(expect.objectContaining({ code: "ENOENT" }));
  });

  it("serves correctly with more unique paths than stat-cache slots", async () => {
    const N = 300; // > STAT_CACHE_SLOTS (256)
    const files: Record<string, string> = {};
    for (let i = 0; i < N; i++) files[`public/f${i}.txt`] = `v${i}`;
    using dir = tempDir("serve-dir-exhaust", files);

    server = serve({
      port: 0,
      routes: { "/*": { dir: join(String(dir), "public") } },
    });

    // Walk the full set twice so every slot is guaranteed to have been
    // evicted and reused between the two visits to any given path.
    for (let pass = 0; pass < 2; pass++) {
      const batch = 32;
      for (let base = 0; base < N; base += batch) {
        const chunk = Array.from({ length: Math.min(batch, N - base) }, (_, j) => base + j);
        const bodies = await Promise.all(chunk.map(i => fetch(`${server!.url}f${i}.txt`).then(r => r.text())));
        expect(bodies).toEqual(chunk.map(i => `v${i}`));
      }
    }

    // After eviction churn, conditionals on a hot path still work.
    const first = await fetch(`${server.url}f0.txt`);
    const lm = first.headers.get("last-modified")!;
    const etag = first.headers.get("etag")!;
    expect((await fetch(`${server.url}f0.txt`, { headers: { "if-modified-since": lm } })).status).toBe(304);
    expect((await fetch(`${server.url}f0.txt`, { headers: { "if-none-match": etag } })).status).toBe(304);
  });

  describe.each([true, false])("statCache: %p", statCache => {
    it("serves and honors conditionals", async () => {
      using dir = tempDir(`serve-dir-cache-${statCache}`, {
        "public/a.txt": "a",
      });
      server = serve({
        port: 0,
        routes: { "/*": { dir: join(String(dir), "public"), statCache } },
      });

      const res = await fetch(`${server.url}a.txt`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("a");
      const lm = res.headers.get("last-modified")!;
      expect(lm).toBeTruthy();
      expect(res.headers.get("etag")).toMatch(/^W\/"/);

      const cond = await fetch(`${server.url}a.txt`, { headers: { "if-modified-since": lm } });
      expect(cond.status).toBe(304);
    });
  });

  it("handles a concurrent burst on one file", async () => {
    using dir = tempDir("serve-dir-burst", {
      "public/hot.txt": "hot",
    });
    server = serve({
      port: 0,
      routes: { "/*": { dir: join(String(dir), "public") } },
    });

    const results = await Promise.all(
      Array.from({ length: 128 }, () => fetch(`${server!.url}hot.txt`).then(r => r.text())),
    );
    expect(results.every(r => r === "hot")).toBe(true);
  });

  it("cannot bypass a more-specific overlapping route via path manipulation", async () => {
    using dir = tempDir("serve-dir-bypass", {
      "public/admin/secret.txt": "SECRET",
      "public/admin/index.html": "SECRET-INDEX",
      "public/secret.pdf": "SECRET-PDF",
      "public/ok.txt": "ok",
    });

    server = serve({
      port: 0,
      routes: {
        "/static/admin/*": () => new Response("auth", { status: 401 }),
        "/static/secret.pdf": () => new Response("auth", { status: 401 }),
        "/static/*": { dir: join(String(dir), "public") },
      },
    });

    // Canonical path hits the inner route.
    expect((await fetch(`${server.url}static/admin/secret.txt`)).status).toBe(401);
    expect((await fetch(`${server.url}static/admin/`)).status).toBe(401);
    expect((await fetch(`${server.url}static/secret.pdf`)).status).toBe(401);

    // Non-canonical forms that uWS routes to the outer wildcard must not
    // reach public/admin/ via the directory route.
    for (const p of [
      "/static//admin/secret.txt",
      "/static/./admin/secret.txt",
      "/static/x/../admin/secret.txt",
      "/static/admin%2Fsecret.txt",
      // `%XX` encoding a character that can appear literally in a path
      // segment: uWS sees `%61dmin` != `admin` and routes to `/static/*`.
      "/static/%61dmin/secret.txt",
      "/static/admi%6E/secret.txt",
      "/static/ad%4Din/secret.txt",
      "/static/%61dmin/",
    ]) {
      const r = await raw(p);
      expect(r.body).not.toContain("SECRET");
      expect([401, 404]).toContain(r.status);
    }

    // A directory hit without a trailing slash 301-redirects to the slash
    // form, which re-enters routing and matches `/static/admin/*`. It must
    // not serve `admin/index.html` directly.
    const noSlash = await raw("/static/admin");
    expect(noSlash.body).not.toContain("SECRET");
    expect(noSlash.status).toBe(301);
    expect(noSlash.headers.location).toBe("/static/admin/");
    // Exactly one Content-Length header (strict intermediaries reject duplicates).
    expect(noSlash.head.toLowerCase().match(/^content-length:/gm)?.length).toBe(1);
    expect((await fetch(`${server.url}static/admin`)).status).toBe(401);

    // A trailing slash on a regular file routes past the exact `/static/secret.pdf`
    // handler in uWS; the directory route must not strip the slash and serve it.
    const fileSlash = await raw("/static/secret.pdf/");
    expect(fileSlash.body).not.toContain("SECRET");
    expect(fileSlash.status).toBe(404);

    // Canonical paths under the outer route still work.
    expect(await (await fetch(`${server.url}static/ok.txt`)).text()).toBe("ok");
  });

  it("yields to more-specific overlapping routes", async () => {
    using dir = tempDir("serve-dir-precedence", {
      "public/file.txt": "from-dir",
      "public/api": "from-dir",
      "public/sub/x.txt": "parent",
      "public/other.txt": "from-dir",
      "inner/x.txt": "inner",
    });

    server = serve({
      port: 0,
      routes: {
        "/static/file.txt": new Response("exact", { status: 200 }),
        "/static/api": () => new Response("handler"),
        "/static/sub/*": { dir: join(String(dir), "inner") },
        "/static/*": { dir: join(String(dir), "public") },
      },
    });

    // Exact static route beats the wildcard directory.
    expect(await (await fetch(`${server.url}static/file.txt`)).text()).toBe("exact");
    // Handler route beats the directory.
    expect(await (await fetch(`${server.url}static/api`)).text()).toBe("handler");
    // More specific wildcard prefix beats the broader one.
    expect(await (await fetch(`${server.url}static/sub/x.txt`)).text()).toBe("inner");
    // Paths only the broad wildcard matches still reach it.
    expect(await (await fetch(`${server.url}static/other.txt`)).text()).toBe("from-dir");
  });

  it.skipIf(!isLinux)("is case-sensitive on a case-sensitive filesystem", async () => {
    using dir = tempDir("serve-dir-case", {
      "public/File.txt": "upper",
    });
    server = serve({
      port: 0,
      routes: { "/static/*": { dir: join(String(dir), "public") } },
      fetch: () => new Response("miss", { status: 404 }),
    });

    expect(await (await fetch(`${server.url}static/File.txt`)).text()).toBe("upper");
    expect((await fetch(`${server.url}static/file.txt`)).status).toBe(404);
    expect((await fetch(`${server.url}static/FILE.TXT`)).status).toBe(404);
  });

  it("rejects adversarial inputs", async () => {
    using dir = tempDir("serve-dir-adversarial", {
      "secret.txt": "SECRET",
      "public/ok.txt": "ok",
      "public/a/b/c/d/e/f/g/h/target.txt": "deep",
      "public/\u00e9.txt": "utf8",
    });

    server = serve({
      port: 0,
      routes: { "/static/*": { dir: join(String(dir), "public") } },
      fetch: () => new Response("fallback", { status: 404 }),
    });

    // `..`, `.`, empty segments, and encoded `/` are rejected outright so the
    // served path matches what uWS routed on (route-precedence parity).
    for (const p of [
      "/static/a/b/c/d/e/f/g/h/../../../../../../../../a/b/c/d/e/f/g/h/target.txt",
      "/static/a/b/c/d/e/f/g/h/../../../../../../../../../secret.txt",
      "/static////////ok.txt",
      "/static/./ok.txt",
      "/static/a/../ok.txt",
      "/static/a%2Fb%2Fok.txt",
    ]) {
      const r = await raw(p);
      expect(r.body).not.toContain("SECRET");
      expect(r.status).toBe(404);
    }

    // Absolute-form request-target (RFC 9112 §3.2.2).
    const abs = await raw("http://x/static/ok.txt");
    expect(abs.status).toBe(200);
    expect(abs.body).toContain("ok");

    // Percent-encoded UTF-8 filename.
    const utf8 = await fetch(`${server.url}static/%C3%A9.txt`);
    expect(utf8.status).toBe(200);
    expect(await utf8.text()).toBe("utf8");

    // Paths at and around PATH_MAX (1024 on macOS, 4096 on Linux) must not
    // crash the server; they yield or 404.
    for (const len of [1023, 1024, 1025, 4095, 4096, 4097, 8000]) {
      const r = await raw("/static/" + Buffer.alloc(len, "a").toString());
      expect([404, 400, 414]).toContain(r.status);
    }
    // Server still responds after the boundary probes.
    expect((await fetch(`${server.url}static/ok.txt`)).status).toBe(200);

    // Oversized Range start must not overflow.
    const hugeRange = await fetch(`${server.url}static/ok.txt`, {
      headers: { range: "bytes=999999999999999999999999-" },
    });
    expect([200, 416]).toContain(hugeRange.status);
  });

  it("survives server.reload()", async () => {
    using dir = tempDir("serve-dir-reload", { "public/x.txt": "x" });
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

  it("applies { headers } to served files", async () => {
    using dir = tempDir("serve-dir-headers", {
      "public/app.js": "console.log(1);",
      "public/sub/index.html": "<h1>sub</h1>",
    });
    const cacheControl = "public, max-age=31536000, immutable";
    server = serve({
      port: 0,
      routes: {
        "/assets/*": {
          dir: join(String(dir), "public"),
          headers: { "cache-control": cacheControl, "x-custom": "1" },
        },
      },
    });

    const res = await fetch(`${server.url}assets/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(cacheControl);
    expect(res.headers.get("x-custom")).toBe("1");
    // Generated headers still present alongside the user headers.
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(res.headers.get("etag")).toStartWith('W/"');

    const head = await fetch(`${server.url}assets/app.js`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("cache-control")).toBe(cacheControl);

    // 304 responses carry the headers too (RFC 9110 §15.4.5).
    const notModified = await fetch(`${server.url}assets/app.js`, {
      headers: { "if-none-match": res.headers.get("etag")! },
    });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("cache-control")).toBe(cacheControl);

    // Routing outcomes (404, 301) are not the served files: no user headers.
    const miss = await fetch(`${server.url}assets/nope.js`);
    expect(miss.status).toBe(404);
    expect(miss.headers.get("cache-control")).toBeNull();

    const redirect = await fetch(`${server.url}assets/sub`, { redirect: "manual" });
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get("cache-control")).toBeNull();
  });

  it("a user header replaces the generated header of the same name", async () => {
    using dir = tempDir("serve-dir-headers-override", {
      "public/data.json": `{"a":1}`,
    });
    server = serve({
      port: 0,
      routes: {
        "/static/*": {
          dir: join(String(dir), "public"),
          headers: { "content-type": "text/plain", etag: '"custom"' },
        },
      },
    });

    const { status, head, headers } = await raw("/static/data.json");
    expect(status).toBe(200);
    expect(headers["content-type"]).toBe("text/plain");
    expect(headers["etag"]).toBe('"custom"');
    // Exactly one of each: the generated header is replaced, not duplicated.
    expect(head.toLowerCase().split("content-type:").length - 1).toBe(1);
    expect(head.toLowerCase().split("etag:").length - 1).toBe(1);

    // Preconditions compare against the user ETag.
    const notModified = await fetch(`${server.url}static/data.json`, {
      headers: { "if-none-match": '"custom"' },
    });
    expect(notModified.status).toBe(304);
  });

  it("a user last-modified header replaces the stat time in precondition checks", async () => {
    using dir = tempDir("serve-dir-headers-lm", {
      "public/a.txt": "aaa",
    });
    const userDate = "Wed, 01 Jan 2020 00:00:00 GMT";
    server = serve({
      port: 0,
      routes: {
        "/static/*": {
          dir: join(String(dir), "public"),
          headers: { "last-modified": userDate },
        },
      },
    });

    const { status, head, headers } = await raw("/static/a.txt");
    expect(status).toBe(200);
    expect(headers["last-modified"]).toBe(userDate);
    // The stat-derived header is replaced, not duplicated.
    expect(head.toLowerCase().split("last-modified:").length - 1).toBe(1);

    // The file mtime is "now", so a 304 here proves the comparison uses the
    // user date, not the stat time.
    const notModified = await fetch(`${server.url}static/a.txt`, {
      headers: { "if-modified-since": userDate },
    });
    expect(notModified.status).toBe(304);

    const precondFailed = await fetch(`${server.url}static/a.txt`, {
      headers: { "if-unmodified-since": "Tue, 01 Jan 2019 00:00:00 GMT" },
    });
    expect(precondFailed.status).toBe(412);
  });

  it("ignores user framing and range headers", async () => {
    using dir = tempDir("serve-dir-headers-framing", {
      "public/a.txt": "0123456789",
    });
    server = serve({
      port: 0,
      routes: {
        "/static/*": {
          dir: join(String(dir), "public"),
          headers: {
            "content-length": "1",
            "content-range": "bytes 0-0/1",
            "transfer-encoding": "chunked",
            "accept-ranges": "none",
            "x-kept": "1",
          },
        },
      },
    });

    const { status, headers, head, body } = await raw("/static/a.txt");
    expect(status).toBe(200);
    // The non-framing user header is kept, the framing ones are dropped.
    expect(headers["x-kept"]).toBe("1");
    // Framing comes from the file, not the user headers.
    expect(headers["content-length"]).toBe("10");
    expect(body).toBe("0123456789");
    expect(head.toLowerCase()).not.toContain("content-range:");
    expect(head.toLowerCase()).not.toContain("transfer-encoding:");
    expect(headers["accept-ranges"]).toBe("bytes");
    expect(head.toLowerCase().split("accept-ranges:").length - 1).toBe(1);

    // Range serving stays on.
    const partial = await fetch(`${server.url}static/a.txt`, {
      headers: { range: "bytes=2-4" },
    });
    expect(partial.status).toBe(206);
    expect(await partial.text()).toBe("234");
    expect(partial.headers.get("content-range")).toBe("bytes 2-4/10");
  });
});

import { describe, expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { join } from "path";

// A handler returns `new Response(htmlBundle, init)` for an `import index from
// "./index.html"`. Bun.serve builds the bundle and sends the page with the
// Response's status and headers (#41362, #17595).

const files = {
  "index.html": `<!DOCTYPE html><html><head><title>t</title><script type="module" src="./app.ts"></script></head><body><h1>Hello HTML</h1></body></html>`,
  "app.ts": `console.log("hello from app");`,
};

function scriptSrc(html: string): string {
  const match = html.match(/<script[^>]*src="([^"]+)"/);
  expect(match).not.toBeNull();
  return match![1];
}

describe.each([false, true])("development: %p", development => {
  test("handler returns new Response(htmlBundle, init)", async () => {
    using dir = tempDir("html-response", files);
    const { default: html } = await import(join(dir, "index.html"));

    let cookies = false;
    using server = Bun.serve({
      port: 0,
      development,
      routes: {
        "/": req => {
          if (cookies) req.cookies.set("session", "abc");
          return new Response(html, {
            status: 401,
            headers: { "x-custom": "yes", "cache-control": "private" },
          });
        },
      },
      fetch() {
        return new Response("not found", { status: 404 });
      },
    });

    const res = await fetch(server.url);
    const page = await res.text();
    expect(page).toContain("<h1>Hello HTML</h1>");
    expect(page).not.toContain("app.ts");
    expect({
      status: res.status,
      contentType: res.headers.get("content-type"),
      custom: res.headers.get("x-custom"),
      cacheControl: res.headers.get("cache-control"),
      hasEtag: res.headers.has("etag"),
    }).toEqual({
      status: 401,
      contentType: "text/html;charset=utf-8",
      custom: "yes",
      cacheControl: "private",
      hasEtag: true,
    });

    // The bundled script is served next to the page.
    const script = await fetch(new URL(scriptSrc(page), server.url));
    expect(script.status).toBe(200);
    expect(await script.text()).toContain("hello from app");

    // HEAD frames the page a GET sends.
    const head = await fetch(server.url, { method: "HEAD" });
    expect(await head.text()).toBe("");
    expect({
      status: head.status,
      contentLength: head.headers.get("content-length"),
      contentType: head.headers.get("content-type"),
    }).toEqual({
      status: 401,
      contentLength: String(Buffer.byteLength(page)),
      contentType: "text/html;charset=utf-8",
    });

    // The same bundle again, with cookies from the request.
    cookies = true;
    const again = await fetch(server.url);
    expect(await again.text()).toBe(page);
    expect(again.headers.get("set-cookie")).toContain("session=abc");
  });
});

test("a bare htmlBundle return is new Response(htmlBundle)", async () => {
  using dir = tempDir("html-response-bare", files);
  const { default: html } = await import(join(dir, "index.html"));
  using server = Bun.serve({
    port: 0,
    development: false,
    async fetch() {
      return html;
    },
  });
  const res = await fetch(server.url);
  const page = await res.text();
  expect(page).toContain("<h1>Hello HTML</h1>");
  expect({ status: res.status, contentType: res.headers.get("content-type") }).toEqual({
    status: 200,
    contentType: "text/html;charset=utf-8",
  });
  const script = await fetch(new URL(scriptSrc(page), server.url));
  expect(await script.text()).toContain("hello from app");
  expect(script.status).toBe(200);
});

test("with the dev server: a handler-returned bundle gets the HMR script", async () => {
  using dir = tempDir("html-response-hmr", files);
  const { default: html } = await import(join(dir, "index.html"));
  using server = Bun.serve({
    port: 0,
    development: true,
    routes: { "/app": html },
    fetch() {
      return new Response(html, { status: 404, headers: { "x-fallback": "1" } });
    },
  });

  const route = await fetch(new URL("/app", server.url));
  const routePage = await route.text();
  expect(route.status).toBe(200);
  expect(routePage).toContain("data-bun-dev-server-script");

  const fallback = await fetch(new URL("/missing", server.url));
  const fallbackPage = await fallback.text();
  expect({
    status: fallback.status,
    contentType: fallback.headers.get("content-type"),
    fallbackHeader: fallback.headers.get("x-fallback"),
  }).toEqual({
    status: 404,
    contentType: "text/html;charset=utf-8",
    fallbackHeader: "1",
  });
  expect(fallbackPage).toContain("<h1>Hello HTML</h1>");
  expect(fallbackPage).toContain("data-bun-dev-server-script");

  const script = await fetch(new URL(scriptSrc(fallbackPage), server.url));
  expect(script.status).toBe(200);
  expect(await script.text()).toContain("hello from app");
});

describe.each([false, true])("development: %p", development => {
  test("requests that arrive while the bundle builds all get the page", async () => {
    using dir = tempDir("html-response-concurrent", files);
    const { default: html } = await import(join(dir, "index.html"));
    using server = Bun.serve({
      port: 0,
      development,
      routes: development ? { "/app": html } : {},
      fetch() {
        return new Response(html, { status: 202 });
      },
    });

    // One of them is aborted while the bundle builds.
    const aborted = new AbortController();
    const abortedFetch = fetch(server.url, { signal: aborted.signal });
    aborted.abort();
    await expect(abortedFetch).rejects.toThrow();

    const responses = await Promise.all(Array.from({ length: 16 }, () => fetch(server.url)));
    const pages = await Promise.all(responses.map(res => res.text()));
    expect(responses.map(res => res.status)).toEqual(Array(16).fill(202));
    expect(new Set(pages).size).toBe(1);
    expect(pages[0]).toContain("<h1>Hello HTML</h1>");
  });
});

const brokenFiles = {
  "index.html": `<!DOCTYPE html><html><head><script type="module" src="./app.ts"></script></head><body>broken</body></html>`,
  "app.ts": `export const broken = ;`,
};

test("a build failure reaches the error handler", async () => {
  using dir = tempDir("html-response-build-error", brokenFiles);
  const { default: html } = await import(join(dir, "index.html"));
  let error: unknown;
  using server = Bun.serve({
    port: 0,
    development: false,
    fetch() {
      return new Response(html);
    },
    error(err) {
      error = err;
      return new Response("handled", { status: 503 });
    },
  });
  const res = await fetch(server.url);
  expect(await res.text()).toBe("handled");
  expect(res.status).toBe(503);
  expect((error as Error).message).toContain("Failed to bundle");
});

describe.each(["sync", "async"])("the error handler returns a bundle (%s)", kind => {
  test("the page is sent like any other Response", async () => {
    using dir = tempDir("html-response-error-handler", files);
    const { default: html } = await import(join(dir, "index.html"));
    using server = Bun.serve({
      port: 0,
      development: false,
      fetch() {
        throw new Error("boom");
      },
      error: kind === "sync" ? () => html : () => Promise.resolve(new Response(html, { status: 500 })),
    });
    const res = await fetch(server.url);
    const page = await res.text();
    expect(page).toContain("<h1>Hello HTML</h1>");
    expect(res.status).toBe(kind === "sync" ? 200 : 500);
  });
});

// Several requests wait on one failing build. The first waiter's error handler
// repairs the source and returns the same bundle, which starts a new build
// while the other waiters are still being resumed. They wait for that build.
test("a waiter whose error handler rebuilds the bundle does not strand the others", async () => {
  using dir = tempDir("html-response-rebuild", brokenFiles);
  const { default: html } = await import(join(dir, "index.html"));
  let errors = 0;
  using server = Bun.serve({
    port: 0,
    development: true,
    fetch() {
      return new Response(html);
    },
    error() {
      errors++;
      writeFileSync(join(dir, "app.ts"), files["app.ts"]);
      return new Response(html, { status: 503 });
    },
  });
  const responses = await Promise.all(Array.from({ length: 4 }, () => fetch(server.url)));
  const pages = await Promise.all(responses.map(res => res.text()));
  expect(errors).toBe(1);
  expect(responses.map(res => res.status).sort()).toEqual([200, 200, 200, 503]);
  expect(new Set(pages).size).toBe(1);
  expect(pages[0]).toContain("<body>broken</body>");
});

test("with the dev server: a build failure renders the error page", async () => {
  using dir = tempDir("html-response-build-error-hmr", brokenFiles);
  const { default: html } = await import(join(dir, "index.html"));
  using server = Bun.serve({
    port: 0,
    development: true,
    routes: { "/app": html },
    fetch() {
      return new Response(html);
    },
  });
  const res = await fetch(new URL("/missing", server.url));
  const page = await res.text();
  expect(page).toContain("Build Failed");
  expect(res.status).toBe(500);
});

test("new Response(htmlBundle) as a route value is the bundle route", async () => {
  using dir = tempDir("html-response-route-value", files);
  const { default: html } = await import(join(dir, "index.html"));
  using server = Bun.serve({
    port: 0,
    development: false,
    routes: { "/": new Response(html) },
  });
  const res = await fetch(server.url);
  expect(await res.text()).toContain("<h1>Hello HTML</h1>");
  expect(res.status).toBe(200);

  // An init needs a handler: a route value cannot carry it.
  expect(() =>
    Bun.serve({
      port: 0,
      development: false,
      routes: { "/": new Response(html, { status: 404 }) },
    }),
  ).toThrow("return new Response(index, init) from a route handler");
});

// The handler path takes refs on the bundle, its route, the request context
// and the Response. LeakSanitizer reports any of them left at VM teardown.
test.skipIf(!isASAN || isWindows)(
  "a handler-returned bundle is freed at VM teardown",
  async () => {
    using dir = tempDir("html-response-teardown-leak", files);
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { default: html } = await import(process.argv[1]);
          for (const development of [false, true]) {
            const server = Bun.serve({
              port: 0,
              development,
              routes: development ? { "/app": html } : {},
              fetch: () => new Response(html, { status: 404 }),
            });
            await Promise.all(Array.from({ length: 4 }, () => fetch(server.url).then(res => res.text())));
            await (await fetch(server.url, { method: "HEAD" })).text();
            server.stop(true);
          }
        `,
        join(dir, "index.html"),
      ],
      env: {
        ...bunEnv,
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dirname, "../../../leaksan.supp")}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const filtered = stderr
      .split("\n")
      .filter(l => !l.includes("Bundled page in "))
      .join("\n")
      .trim();
    expect({ stdout, stderr: filtered, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  },
  30_000,
);

test("an HTMLBundle body cannot be read outside Bun.serve", async () => {
  using dir = tempDir("html-response-read", files);
  const { default: html } = await import(join(dir, "index.html"));
  const response = new Response(html);
  await expect(response.text()).rejects.toThrow(TypeError);
  expect(() => response.body).toThrow(TypeError);
  await expect(Bun.write(join(dir, "out.html"), new Response(html))).rejects.toThrow(TypeError);
  expect(() => new Request("http://localhost/", { method: "POST", body: html })).toThrow(TypeError);
  expect(() => new Request("http://localhost/", new Response(html) as any)).toThrow(TypeError);
  expect(() => new HTMLRewriter().transform(new Response(html))).toThrow(TypeError);
  await expect(WebAssembly.compileStreaming(new Response(html))).rejects.toThrow(TypeError);
  // On Windows `cat` is a shell builtin, and builtins take no Response redirect.
  if (!isWindows) {
    await expect(Bun.$`cat < ${new Response(html)}`.text()).rejects.toThrow("HTMLBundle");
  }
});

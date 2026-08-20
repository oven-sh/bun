// Which framework route the dev server serves a URL with (`fileSystemRouterTypes[n]` options included).
import { Bake } from "bun";
import { expect } from "bun:test";
import { devTest, minimalFramework } from "../bake-harness";

/** `minimalFramework` with one router type per entry, each overriding the minimal router type's options. */
function frameworkWithRouterTypes(...types: Partial<Bake.FrameworkFileSystemRouterType>[]): Bake.Framework {
  const [minimalType] = minimalFramework.fileSystemRouterTypes!;
  return {
    ...minimalFramework,
    fileSystemRouterTypes: types.map(options => ({ ...minimalType, ...options })),
  };
}

const page = (text: string) => `export default () => new Response(${JSON.stringify(text)});`;

devTest("the most specific dynamic route serves the request", {
  framework: minimalFramework,
  files: {
    "routes/[...all].ts": page("[...all]"),
    "routes/[slug].ts": page("[slug]"),
    "routes/[slug]/[id].ts": page("[slug]/[id]"),
    "routes/[team]/docs/[[...path]].ts": page("[team]/docs/[[...path]]"),
    "routes/opt/[[...rest]].ts": page("opt/[[...rest]]"),
  },
  async test(dev) {
    await dev.fetch("/a").equals("[slug]");
    await dev.fetch("/a/b").equals("[slug]/[id]");
    await dev.fetch("/a/b/c").equals("[...all]");
    await dev.fetch("/acme/docs").equals("[team]/docs/[[...path]]");
    await dev.fetch("/acme/docs/intro").equals("[team]/docs/[[...path]]");
    await dev.fetch("/opt").equals("opt/[[...rest]]");
    await dev.fetch("/opt/a").equals("opt/[[...rest]]");
  },
});

// One trailing slash is ignored, like Bun.FileSystemRouter, so it cannot move a request from a static page to a dynamic one.
devTest("a trailing slash serves the same route", {
  framework: minimalFramework,
  files: {
    "routes/about.ts": page("about"),
    "routes/[slug].ts": `export default (req, meta) => new Response("[slug]:" + meta.params.slug);`,
  },
  async test(dev) {
    await dev.fetch("/about").equals("about");
    await dev.fetch("/about/").equals("about");
    await dev.fetch("/other/").equals("[slug]:other");
  },
});

// Like Next.js: segments split on the raw path, then each static segment and param value is percent-decoded once.
devTest("percent-escapes are decoded per segment", {
  framework: minimalFramework,
  files: {
    "routes/héllo.ts": page("héllo"),
    "routes/blog/[slug].ts": `export default (req, meta) => new Response("slug:" + meta.params.slug);`,
    "routes/docs/[...rest].ts": `export default (req, meta) => new Response("rest:" + [].concat(meta.params.rest).join("|"));`,
  },
  async test(dev) {
    await dev.fetch("/h%C3%A9llo").equals("héllo");
    await dev.fetch("/blog/caf%C3%A9").equals("slug:café");
    // An escaped slash is data inside a param, not a separator.
    await dev.fetch("/blog/a%2Fb").equals("slug:a/b");
    await dev.fetch("/docs/a%2Fb/c").equals("rest:a/b|c");
    // A malformed escape names no route.
    expect((await dev.fetch("/blog/%zz")).status).toBe(404);
  },
});

// The request-target carries the query string; only its pathname picks the route.
devTest("the query string is not part of the route path", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": page("index"),
    "routes/about.ts": page("about"),
    "routes/[user]/posts.ts": `export default (req, meta) => new Response("posts:" + meta.params.user);`,
    "routes/echo/[...rest].ts": `export default (req, meta) => new Response("rest:" + [].concat(meta.params.rest).join(","));`,
  },
  async test(dev) {
    await dev.fetch("/?x=1").equals("index");
    await dev.fetch("/about?x=1").equals("about");
    await dev.fetch("/joe/posts").equals("posts:joe");
    await dev.fetch("/joe/posts?tab=1").equals("posts:joe");
    await dev.fetch("/joe/posts/?tab=1").equals("posts:joe");
    // A pathname with a scheme-like segment is still origin-form (`//` itself is rejected: empty segments never match).
    await dev.fetch("/echo/mailto:someone@example.com/a?q=1").equals("rest:mailto:someone@example.com,a");
    expect((await dev.fetch("/echo/https://example.com/a?q=1")).status).toBe(404);
  },
});

/**
 * Sends `requestLine` as a raw HTTP/1.1 request, for request-targets fetch() cannot produce. Resolves once
 * `Content-Length` body bytes arrived or the server closed the socket (a crashed server sends nothing).
 */
async function rawRequest(port: number, requestLine: string): Promise<{ status: string; body: string }> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const chunks: Buffer[] = [];
  const parse = () => {
    const response = Buffer.concat(chunks).toString();
    const headerEnd = response.indexOf("\r\n\r\n");
    const body = headerEnd === -1 ? "" : response.slice(headerEnd + 4);
    const contentLength = headerEnd === -1 ? null : /^content-length: *(\d+)/im.exec(response.slice(0, headerEnd));
    return {
      status: response.split("\r\n")[0],
      body,
      complete: contentLength !== null && body.length >= Number(contentLength[1]),
    };
  };
  await using socket = await Bun.connect({
    hostname: "127.0.0.1",
    port,
    socket: {
      open(socket) {
        socket.write(`${requestLine}\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
      },
      data(socket, chunk) {
        chunks.push(chunk);
        if (parse().complete) resolve();
      },
      close: () => resolve(),
      error: (socket, error) => reject(error),
      connectError: (socket, error) => reject(error),
    },
  });
  await promise;
  const { status, body } = parse();
  return { status, body };
}

const requestTargetFiles = {
  "routes/index.ts": page("index"),
  "routes/blog/[slug].ts": `export default (req, meta) => new Response("slug:" + meta.params.slug);`,
};

// RFC 9112 section 3.2.2: a server MUST accept the absolute-form that proxies send.
devTest("an absolute-form request-target routes like origin-form", {
  framework: minimalFramework,
  files: requestTargetFiles,
  async test(dev) {
    const origin = `http://127.0.0.1:${dev.port}`;
    expect(await rawRequest(dev.port, `GET ${origin}/ HTTP/1.1`)).toEqual({ status: "HTTP/1.1 200 OK", body: "index" });
    expect(await rawRequest(dev.port, `GET ${origin}/blog/abc?x=1 HTTP/1.1`)).toEqual({
      status: "HTTP/1.1 200 OK",
      body: "slug:abc",
    });
    // An empty path names the root, and the authority ends at '?', so a '/' in the query does not start the path.
    expect(await rawRequest(dev.port, `GET ${origin} HTTP/1.1`)).toEqual({ status: "HTTP/1.1 200 OK", body: "index" });
    expect(await rawRequest(dev.port, `GET ${origin}?next=/blog/abc HTTP/1.1`)).toEqual({
      status: "HTTP/1.1 200 OK",
      body: "index",
    });
  },
});

// A CONNECT target names no path: it matches no route and must not take the server down.
devTest("an authority-form request-target matches no route", {
  framework: minimalFramework,
  files: requestTargetFiles,
  async test(dev) {
    expect(await rawRequest(dev.port, `CONNECT 127.0.0.1:${dev.port} HTTP/1.1`)).toEqual({
      status: "HTTP/1.1 404 Not Found",
      body: "404 Not Found",
    });
    await dev.fetch("/").equals("index");
  },
});

devTest("ignoreDirs skips directories whose name is listed", {
  framework: frameworkWithRouterTypes({ ignoreDirs: ["hidden", "also-hidden"] }),
  files: {
    "routes/index.ts": page("index"),
    "routes/hidden/index.ts": page("hidden"),
    "routes/also-hidden/index.ts": page("also-hidden"),
    "routes/visible/index.ts": page("visible"),
    "routes/visible/hidden/index.ts": page("visible/hidden"),
    "routes/hidden-suffix/index.ts": page("hidden-suffix"),
    "routes/node_modules/index.ts": page("node_modules"),
  },
  async test(dev) {
    await dev.fetch("/").equals("index");
    await dev.fetch("/visible").equals("visible");
    await dev.fetch("/hidden").expect404();
    await dev.fetch("/also-hidden").expect404();
    // Matched at any depth, not only directly under the root.
    await dev.fetch("/visible/hidden").expect404();
    // Compared against the whole directory name, not as a prefix.
    await dev.fetch("/hidden-suffix").equals("hidden-suffix");
    // Like `extensions`, a configured list replaces the default one instead of extending it.
    await dev.fetch("/node_modules").equals("node_modules");
  },
});

devTest("ignoreDirs is read from each router type", {
  framework: frameworkWithRouterTypes(
    { root: "routes-a", ignoreDirs: ["skip-a"] },
    { root: "routes-b", ignoreDirs: ["skip-b"] },
  ),
  files: {
    "routes-a/skip-a/one.ts": page("a: skip-a/one"),
    "routes-a/skip-b/two.ts": page("a: skip-b/two"),
    "routes-b/skip-a/three.ts": page("b: skip-a/three"),
    "routes-b/skip-b/four.ts": page("b: skip-b/four"),
  },
  async test(dev) {
    await dev.fetch("/skip-a/one").expect404();
    await dev.fetch("/skip-b/two").equals("a: skip-b/two");
    await dev.fetch("/skip-a/three").equals("b: skip-a/three");
    await dev.fetch("/skip-b/four").expect404();
  },
});

devTest("ignoreDirs defaults to node_modules and .git", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": page("index"),
    "routes/other/index.ts": page("other"),
    "routes/node_modules/index.ts": page("node_modules"),
    "routes/.git/index.ts": page(".git"),
  },
  async test(dev) {
    await dev.fetch("/").equals("index");
    await dev.fetch("/other").equals("other");
    await dev.fetch("/node_modules").expect404();
    await dev.fetch("/.git").expect404();
  },
});

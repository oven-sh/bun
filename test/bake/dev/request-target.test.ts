// Tests for how the dev server maps the raw HTTP/1.1 request-target onto
// framework routes. The request-target is not always an origin-form pathname:
// it carries the query string, proxies send absolute-form targets
// (`GET http://host/path HTTP/1.1`, RFC 9112 section 3.2.2), and CONNECT /
// `OPTIONS *` do not name a path at all.
import { expect } from "bun:test";
import { devTest, minimalFramework } from "../bake-harness";

/**
 * Writes `requestLine` as a raw HTTP/1.1 request over a TCP socket (fetch()
 * cannot produce these request-targets) and returns the parsed response. The
 * promise resolves once `Content-Length` bytes of the body arrived, or when
 * the server closes the socket; a crashed server closes it with no bytes,
 * which fails the status-line assertion.
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
      close() {
        resolve();
      },
      error(socket, error) {
        reject(error);
      },
      connectError(socket, error) {
        reject(error);
      },
    },
  });
  await promise;
  const { status, body } = parse();
  return { status, body };
}

const routeFiles = {
  "routes/index.ts": `
    export default function (req, meta) {
      return new Response("index route");
    }
  `,
  "routes/blog/[slug].ts": `
    export default function (req, meta) {
      return new Response("slug=" + meta.params.slug);
    }
  `,
  "routes/echo/[...rest].ts": `
    export default function (req, meta) {
      return new Response("rest=" + JSON.stringify(meta.params.rest));
    }
  `,
};

devTest("query string is not part of the route path", {
  framework: minimalFramework,
  files: routeFiles,
  async test(dev) {
    expect(await rawRequest(dev.port, "GET /?foo=bar HTTP/1.1")).toEqual({
      status: "HTTP/1.1 200 OK",
      body: "index route",
    });
    expect(await rawRequest(dev.port, "GET /blog/abc?foo=bar#hash HTTP/1.1")).toEqual({
      status: "HTTP/1.1 200 OK",
      body: "slug=abc",
    });
    // A pathname that embeds a URL is origin-form, not absolute-form.
    expect(await rawRequest(dev.port, "GET /echo/https://example.com/a?q=1 HTTP/1.1")).toEqual({
      status: "HTTP/1.1 200 OK",
      body: 'rest=["https:","example.com","a"]',
    });
  },
});

devTest("absolute-form request-target routes like origin-form", {
  framework: minimalFramework,
  files: routeFiles,
  async test(dev) {
    // RFC 9112 section 3.2.2: a server MUST accept the absolute-form.
    expect(await rawRequest(dev.port, `GET http://127.0.0.1:${dev.port}/ HTTP/1.1`)).toEqual({
      status: "HTTP/1.1 200 OK",
      body: "index route",
    });
    expect(await rawRequest(dev.port, `GET http://127.0.0.1:${dev.port}/blog/abc?x=1 HTTP/1.1`)).toEqual({
      status: "HTTP/1.1 200 OK",
      body: "slug=abc",
    });
    // An absolute-form target with an empty path names the root.
    expect(await rawRequest(dev.port, `GET http://127.0.0.1:${dev.port} HTTP/1.1`)).toEqual({
      status: "HTTP/1.1 200 OK",
      body: "index route",
    });
    // The authority ends at '?' (RFC 3986 section 3.2); a '/' inside the
    // query of an empty-path target is not the start of the path.
    expect(await rawRequest(dev.port, `GET http://127.0.0.1:${dev.port}?next=/blog/abc HTTP/1.1`)).toEqual({
      status: "HTTP/1.1 200 OK",
      body: "index route",
    });
  },
});

devTest("authority-form request-target does not match a route and does not abort", {
  framework: minimalFramework,
  files: routeFiles,
  async test(dev) {
    // A CONNECT target names no path, so it can never match a route. It must
    // not take the server down either; origin-form requests keep working.
    expect(await rawRequest(dev.port, `CONNECT 127.0.0.1:${dev.port} HTTP/1.1`)).toEqual({
      status: "HTTP/1.1 404 Not Found",
      body: "404 Not Found",
    });
    await dev.fetch("/").equals("index route");
  },
});

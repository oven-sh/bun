import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import http2 from "node:http2";

// Client-side header validation in the HTTP/2 frame parser: field names must
// be lowercase tchars, field values must not contain NUL/CR/LF (RFC 9113
// section 8.2.1), and single-value headers must not repeat. Covers both the
// single-value and array encoding paths.
describe("client request header validation", () => {
  let server: http2.Http2Server;
  let url: string;
  let lastHeaders: http2.IncomingHttpHeaders;
  beforeAll(async () => {
    server = http2.createServer();
    server.on("stream", (stream, headers) => {
      lastHeaders = headers;
      stream.respond({ ":status": 200 }, { endStream: true });
    });
    await new Promise<void>(resolve => server.listen(0, resolve));
    url = `http://localhost:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => {
    server.close();
  });

  function requestError(headers: Record<string, string | string[]>) {
    const client = http2.connect(url);
    client.on("error", () => {});
    try {
      client.request({ ":path": "/", ...headers });
      return null;
    } catch (err) {
      return err as Error & { code?: string };
    } finally {
      client.close();
    }
  }

  it("rejects a control character in a single header value", () => {
    for (const bad of ["a\rb", "a\nb", "a\u0000b"]) {
      const err = requestError({ "x-bad": bad });
      expect(err).toBeInstanceOf(TypeError);
      expect(err!.code).toBe("ERR_HTTP2_INVALID_HEADER_VALUE");
      expect(err!.message).toBe('Invalid value for header "x-bad"');
    }
  });

  it("rejects a control character in an array header value", () => {
    const err = requestError({ "x-arr": ["good", "bad\u0000"] });
    expect(err).toBeInstanceOf(TypeError);
    expect(err!.code).toBe("ERR_HTTP2_INVALID_HEADER_VALUE");
    expect(err!.message).toBe('Invalid value for header "x-arr"');
  });

  it("rejects an invalid character in a header name", () => {
    const err = requestError({ "bad header": "v" });
    expect(err).toBeInstanceOf(TypeError);
    expect(err!.code).toBe("ERR_INVALID_HTTP_TOKEN");
  });

  it("rejects multiple values for a single-value header", () => {
    const err = requestError({ "content-type": ["text/plain", "text/html"] });
    expect(err).toBeInstanceOf(TypeError);
    expect(err!.code).toBe("ERR_HTTP2_HEADER_SINGLE_VALUE");
    expect(err!.message).toBe('Header field "content-type" must only have a single value');
  });

  it("lowercases header names and accepts tchar names and array values", async () => {
    const client = http2.connect(url);
    const { promise, resolve, reject } = Promise.withResolvers<http2.IncomingHttpHeaders>();
    client.on("error", reject);
    const req = client.request({
      ":path": "/",
      "X-Mixed-CASE": "ok",
      "x-multi": ["a", "b"],
      "x-t0k3n!#$%&'*+-.^_`|~": "ok",
    });
    req.on("response", resolve);
    req.on("error", reject);
    req.end();
    try {
      const res = await promise;
      expect(res[":status"]).toBe(200);
      expect(lastHeaders["x-mixed-case"]).toBe("ok");
      expect(lastHeaders["x-multi"]).toBe("a, b");
      expect(lastHeaders["x-t0k3n!#$%&'*+-.^_`|~"]).toBe("ok");
    } finally {
      client.close();
    }
  });
});

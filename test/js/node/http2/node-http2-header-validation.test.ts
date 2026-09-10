import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import http2 from "node:http2";

// Client-side header validation in the HTTP/2 frame parser: field names must
// be lowercase tchars, field values must not contain NUL/CR/LF (RFC 9113
// section 8.2.1), and single-value headers must not repeat. Covers both the
// single-value and array encoding paths.
//
// Name and single-value violations are thrown synchronously from
// `client.request()`; value violations are detected when the header block is
// encoded and surface as an 'error' on the request. `requestError` captures
// whichever of the two delivers.
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

  type CodedError = Error & { code?: string };

  async function requestError(headers: Record<string, string | string[]>): Promise<CodedError> {
    const client = http2.connect(url);
    client.on("error", () => {});
    try {
      let req: http2.ClientHttp2Stream;
      try {
        req = client.request({ ":path": "/", ...headers });
      } catch (err) {
        return err as CodedError;
      }
      const { promise, resolve, reject } = Promise.withResolvers<CodedError>();
      req.on("error", resolve);
      req.on("response", () => reject(new Error("request unexpectedly succeeded")));
      req.end();
      return await promise;
    } finally {
      client.close();
    }
  }

  it("rejects a control character in a single header value", async () => {
    for (const bad of ["a\rb", "a\nb", "a\u0000b"]) {
      const err = await requestError({ "x-bad": bad });
      expect(err).toBeInstanceOf(TypeError);
      expect(err.code).toBe("ERR_HTTP2_INVALID_HEADER_VALUE");
      expect(err.message).toBe('Invalid value for header "x-bad"');
    }
  });

  it("rejects a control character in an array header value", async () => {
    const err = await requestError({ "x-arr": ["good", "bad\u0000"] });
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_HTTP2_INVALID_HEADER_VALUE");
    expect(err.message).toBe('Invalid value for header "x-arr"');
  });

  it("rejects an invalid character in a header name", async () => {
    const err = await requestError({ "bad header": "v" });
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_INVALID_HTTP_TOKEN");
  });

  it("rejects multiple values for a single-value header", async () => {
    const err = await requestError({ "content-type": ["text/plain", "text/html"] });
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_HTTP2_HEADER_SINGLE_VALUE");
    expect(err.message).toBe('Header field "content-type" must only have a single value');
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

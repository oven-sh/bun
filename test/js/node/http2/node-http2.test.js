import http2 from "node:http2";
import { Duplex } from "stream";
import tls from "node:tls";
import net from "node:net";
import { which } from "bun";
import path from "node:path";
import fs from "node:fs";
import { bunExe, bunEnv } from "harness";
import { tmpdir } from "node:os";
import http2utils from "./helpers";

const TLS_CERT = {
  key: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC+7odzr3yIYewR\nNRGIubF5hzT7Bym2dDab4yhaKf5drL+rcA0J15BM8QJ9iSmL1ovg7x35Q2MBKw3r\nl/Yyy3aJS8whZTUze522El72iZbdNbS+oH6GxB2gcZB6hmUehPjHIUH4icwPdwVU\neR6fB7vkfDddLXe0Tb4qsO1EK8H0mr5PiQSXfj39Yc1QHY7/gZ/xeSrt/6yn0oH9\nHbjF2XLSL2j6cQPKEayartHN0SwzwLi0eWSzcziVPSQV7c6Lg9UuIHbKlgOFzDpc\np1p1lRqv2yrT25im/dS6oy9XX+p7EfZxqeqpXX2fr5WKxgnzxI3sW93PG8FUIDHt\nnUsoHX3RAgMBAAECggEAAckMqkn+ER3c7YMsKRLc5bUE9ELe+ftUwfA6G+oXVorn\nE+uWCXGdNqI+TOZkQpurQBWn9IzTwv19QY+H740cxo0ozZVSPE4v4czIilv9XlVw\n3YCNa2uMxeqp76WMbz1xEhaFEgn6ASTVf3hxYJYKM0ljhPX8Vb8wWwlLONxr4w4X\nOnQAB5QE7i7LVRsQIpWKnGsALePeQjzhzUZDhz0UnTyGU6GfC+V+hN3RkC34A8oK\njR3/Wsjahev0Rpb+9Pbu3SgTrZTtQ+srlRrEsDG0wVqxkIk9ueSMOHlEtQ7zYZsk\nlX59Bb8LHNGQD5o+H1EDaC6OCsgzUAAJtDRZsPiZEQKBgQDs+YtVsc9RDMoC0x2y\nlVnP6IUDXt+2UXndZfJI3YS+wsfxiEkgK7G3AhjgB+C+DKEJzptVxP+212hHnXgr\n1gfW/x4g7OWBu4IxFmZ2J/Ojor+prhHJdCvD0VqnMzauzqLTe92aexiexXQGm+WW\nwRl3YZLmkft3rzs3ZPhc1G2X9QKBgQDOQq3rrxcvxSYaDZAb+6B/H7ZE4natMCiz\nLx/cWT8n+/CrJI2v3kDfdPl9yyXIOGrsqFgR3uhiUJnz+oeZFFHfYpslb8KvimHx\nKI+qcVDcprmYyXj2Lrf3fvj4pKorc+8TgOBDUpXIFhFDyM+0DmHLfq+7UqvjU9Hs\nkjER7baQ7QKBgQDTh508jU/FxWi9RL4Jnw9gaunwrEt9bxUc79dp+3J25V+c1k6Q\nDPDBr3mM4PtYKeXF30sBMKwiBf3rj0CpwI+W9ntqYIwtVbdNIfWsGtV8h9YWHG98\nJ9q5HLOS9EAnogPuS27walj7wL1k+NvjydJ1of+DGWQi3aQ6OkMIegap0QKBgBlR\nzCHLa5A8plG6an9U4z3Xubs5BZJ6//QHC+Uzu3IAFmob4Zy+Lr5/kITlpCyw6EdG\n3xDKiUJQXKW7kluzR92hMCRnVMHRvfYpoYEtydxcRxo/WS73SzQBjTSQmicdYzLE\ntkLtZ1+ZfeMRSpXy0gR198KKAnm0d2eQBqAJy0h9AoGBAM80zkd+LehBKq87Zoh7\ndtREVWslRD1C5HvFcAxYxBybcKzVpL89jIRGKB8SoZkF7edzhqvVzAMP0FFsEgCh\naClYGtO+uo+B91+5v2CCqowRJUGfbFOtCuSPR7+B3LDK8pkjK2SQ0mFPUfRA5z0z\nNVWtC0EYNBTRkqhYtqr3ZpUc\n-----END PRIVATE KEY-----\n",
  cert: "-----BEGIN CERTIFICATE-----\nMIIDrzCCApegAwIBAgIUHaenuNcUAu0tjDZGpc7fK4EX78gwDQYJKoZIhvcNAQEL\nBQAwaTELMAkGA1UEBhMCVVMxCzAJBgNVBAgMAkNBMRYwFAYDVQQHDA1TYW4gRnJh\nbmNpc2NvMQ0wCwYDVQQKDARPdmVuMREwDwYDVQQLDAhUZWFtIEJ1bjETMBEGA1UE\nAwwKc2VydmVyLWJ1bjAeFw0yMzA5MDYyMzI3MzRaFw0yNTA5MDUyMzI3MzRaMGkx\nCzAJBgNVBAYTAlVTMQswCQYDVQQIDAJDQTEWMBQGA1UEBwwNU2FuIEZyYW5jaXNj\nbzENMAsGA1UECgwET3ZlbjERMA8GA1UECwwIVGVhbSBCdW4xEzARBgNVBAMMCnNl\ncnZlci1idW4wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC+7odzr3yI\nYewRNRGIubF5hzT7Bym2dDab4yhaKf5drL+rcA0J15BM8QJ9iSmL1ovg7x35Q2MB\nKw3rl/Yyy3aJS8whZTUze522El72iZbdNbS+oH6GxB2gcZB6hmUehPjHIUH4icwP\ndwVUeR6fB7vkfDddLXe0Tb4qsO1EK8H0mr5PiQSXfj39Yc1QHY7/gZ/xeSrt/6yn\n0oH9HbjF2XLSL2j6cQPKEayartHN0SwzwLi0eWSzcziVPSQV7c6Lg9UuIHbKlgOF\nzDpcp1p1lRqv2yrT25im/dS6oy9XX+p7EfZxqeqpXX2fr5WKxgnzxI3sW93PG8FU\nIDHtnUsoHX3RAgMBAAGjTzBNMCwGA1UdEQQlMCOCCWxvY2FsaG9zdIcEfwAAAYcQ\nAAAAAAAAAAAAAAAAAAAAATAdBgNVHQ4EFgQUF3y/su4J/8ScpK+rM2LwTct6EQow\nDQYJKoZIhvcNAQELBQADggEBAGWGWp59Bmrk3Gt0bidFLEbvlOgGPWCT9ZrJUjgc\nhY44E+/t4gIBdoKOSwxo1tjtz7WsC2IYReLTXh1vTsgEitk0Bf4y7P40+pBwwZwK\naeIF9+PC6ZoAkXGFRoyEalaPVQDBg/DPOMRG9OH0lKfen9OGkZxmmjRLJzbyfAhU\noI/hExIjV8vehcvaJXmkfybJDYOYkN4BCNqPQHNf87ZNdFCb9Zgxwp/Ou+47J5k4\n5plQ+K7trfKXG3ABMbOJXNt1b0sH8jnpAsyHY4DLEQqxKYADbXsr3YX/yy6c0eOo\nX2bHGD1+zGsb7lGyNyoZrCZ0233glrEM4UxmvldBcWwOWfk=\n-----END CERTIFICATE-----\n",
};

const nodeExecutable = which("node");
async function nodeEchoServer() {
  if (!nodeExecutable) throw new Error("node executable not found");
  const subprocess = Bun.spawn([nodeExecutable, path.join(import.meta.dir, "node-echo-server.fixture.js")], {
    stdout: "pipe",
  });
  const reader = subprocess.stdout.getReader();
  const data = await reader.read();
  const decoder = new TextDecoder("utf-8");
  const address = JSON.parse(decoder.decode(data.value));
  const url = `https://${address.family === "IPv6" ? `[${address.address}]` : address.address}:${address.port}`;
  return { address, url, subprocess };
}
async function nodeDynamicServer(test_name, code) {
  if (!nodeExecutable) throw new Error("node executable not found");

  const tmp_dir = path.join(fs.realpathSync(tmpdir()), "http.nodeDynamicServer");
  if (!fs.existsSync(tmp_dir)) {
    fs.mkdirSync(tmp_dir, { recursive: true });
  }

  const file_name = path.join(tmp_dir, test_name);
  const contents = Buffer.from(`const http2 = require("http2");
  const server = http2.createServer();
${code}
server.listen(0);
server.on("listening", () => {
  process.stdout.write(JSON.stringify(server.address()));
});`);
  fs.writeFileSync(file_name, contents);

  const subprocess = Bun.spawn([nodeExecutable, file_name], {
    stdout: "pipe",
  });
  const reader = subprocess.stdout.getReader();
  const data = await reader.read();
  const decoder = new TextDecoder("utf-8");
  const address = JSON.parse(decoder.decode(data.value));
  const url = `http://${address.family === "IPv6" ? `[${address.address}]` : address.address}:${address.port}`;
  return { address, url, subprocess };
}

function doHttp2Request(url, headers, payload, options, request_options) {
  const { promise, resolve, reject: promiseReject } = Promise.withResolvers();

  const client = options ? http2.connect(url, options) : http2.connect(url);
  client.on("error", promiseReject);
  function reject(err) {
    promiseReject(err);
    client.close();
  }

  const req = request_options ? client.request(headers, request_options) : client.request(headers);

  let response_headers = null;
  req.on("response", (headers, flags) => {
    response_headers = headers;
  });

  req.setEncoding("utf8");
  let data = "";
  req.on("data", chunk => {
    data += chunk;
  });
  req.on("error", reject);
  req.on("end", () => {
    resolve({ data, headers: response_headers });
    client.close();
  });

  if (payload) {
    req.write(payload);
  }
  req.end();
  return promise;
}

function doMultiplexHttp2Request(url, requests) {
  const { promise, resolve, reject: promiseReject } = Promise.withResolvers();

  const client = http2.connect(url);

  client.on("error", promiseReject);
  function reject(err) {
    promiseReject(err);
    client.close();
  }
  let completed = 0;
  const results = [];
  for (let i = 0; i < requests.length; i++) {
    const { headers, payload } = requests[i];

    const req = client.request(headers);

    let response_headers = null;
    req.on("response", (headers, flags) => {
      response_headers = headers;
    });

    req.setEncoding("utf8");
    let data = "";
    req.on("data", chunk => {
      data += chunk;
    });
    req.on("error", reject);
    req.on("end", () => {
      results.push({ data, headers: response_headers });
      completed++;
      if (completed === requests.length) {
        resolve(results);
        client.close();
      }
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  }
  return promise;
}

describe("Client Basics", () => {
  // we dont support server yet but we support client
  it("should be able to send a GET request", async () => {
    const result = await doHttp2Request("https://httpbin.org", { ":path": "/get", "test-header": "test-value" });
    let parsed;
    expect(() => (parsed = JSON.parse(result.data))).not.toThrow();
    expect(parsed.url).toBe("https://httpbin.org/get");
    expect(parsed.headers["Test-Header"]).toBe("test-value");
  });
  it("should be able to send a POST request", async () => {
    const payload = JSON.stringify({ "hello": "bun" });
    const result = await doHttp2Request(
      "https://httpbin.org",
      { ":path": "/post", "test-header": "test-value", ":method": "POST" },
      payload,
    );
    let parsed;
    expect(() => (parsed = JSON.parse(result.data))).not.toThrow();
    expect(parsed.url).toBe("https://httpbin.org/post");
    expect(parsed.headers["Test-Header"]).toBe("test-value");
    expect(parsed.json).toEqual({ "hello": "bun" });
    expect(parsed.data).toEqual(payload);
  });
  it("should be able to send data using end", async () => {
    const payload = JSON.stringify({ "hello": "bun" });
    const { promise, resolve, reject } = Promise.withResolvers();
    const client = http2.connect("https://httpbin.org");
    client.on("error", reject);
    const req = client.request({ ":path": "/post", "test-header": "test-value", ":method": "POST" });
    let response_headers = null;
    req.on("response", (headers, flags) => {
      response_headers = headers;
    });
    req.setEncoding("utf8");
    let data = "";
    req.on("data", chunk => {
      data += chunk;
    });
    req.on("end", () => {
      resolve({ data, headers: response_headers });
      client.close();
    });
    req.end(payload);
    const result = await promise;
    let parsed;
    expect(() => (parsed = JSON.parse(result.data))).not.toThrow();
    expect(parsed.url).toBe("https://httpbin.org/post");
    expect(parsed.headers["Test-Header"]).toBe("test-value");
    expect(parsed.json).toEqual({ "hello": "bun" });
    expect(parsed.data).toEqual(payload);
  });
  it("should be able to mutiplex GET requests", async () => {
    const results = await doMultiplexHttp2Request("https://httpbin.org", [
      { headers: { ":path": "/get" } },
      { headers: { ":path": "/get" } },
      { headers: { ":path": "/get" } },
      { headers: { ":path": "/get" } },
      { headers: { ":path": "/get" } },
    ]);
    expect(results.length).toBe(5);
    for (let i = 0; i < results.length; i++) {
      let parsed;
      expect(() => (parsed = JSON.parse(results[i].data))).not.toThrow();
      expect(parsed.url).toBe("https://httpbin.org/get");
    }
  });
  it("should be able to mutiplex POST requests", async () => {
    const results = await doMultiplexHttp2Request("https://httpbin.org", [
      { headers: { ":path": "/post", ":method": "POST" }, payload: JSON.stringify({ "request": 1 }) },
      { headers: { ":path": "/post", ":method": "POST" }, payload: JSON.stringify({ "request": 2 }) },
      { headers: { ":path": "/post", ":method": "POST" }, payload: JSON.stringify({ "request": 3 }) },
      { headers: { ":path": "/post", ":method": "POST" }, payload: JSON.stringify({ "request": 4 }) },
      { headers: { ":path": "/post", ":method": "POST" }, payload: JSON.stringify({ "request": 5 }) },
    ]);
    expect(results.length).toBe(5);
    for (let i = 0; i < results.length; i++) {
      let parsed;
      expect(() => (parsed = JSON.parse(results[i].data))).not.toThrow();
      expect(parsed.url).toBe("https://httpbin.org/post");
      expect([1, 2, 3, 4, 5]).toContain(parsed.json?.request);
    }
  });
  it("constants", () => {
    expect(http2.constants).toEqual({
      "NGHTTP2_ERR_FRAME_SIZE_ERROR": -522,
      "NGHTTP2_SESSION_SERVER": 0,
      "NGHTTP2_SESSION_CLIENT": 1,
      "NGHTTP2_STREAM_STATE_IDLE": 1,
      "NGHTTP2_STREAM_STATE_OPEN": 2,
      "NGHTTP2_STREAM_STATE_RESERVED_LOCAL": 3,
      "NGHTTP2_STREAM_STATE_RESERVED_REMOTE": 4,
      "NGHTTP2_STREAM_STATE_HALF_CLOSED_LOCAL": 5,
      "NGHTTP2_STREAM_STATE_HALF_CLOSED_REMOTE": 6,
      "NGHTTP2_STREAM_STATE_CLOSED": 7,
      "NGHTTP2_FLAG_NONE": 0,
      "NGHTTP2_FLAG_END_STREAM": 1,
      "NGHTTP2_FLAG_END_HEADERS": 4,
      "NGHTTP2_FLAG_ACK": 1,
      "NGHTTP2_FLAG_PADDED": 8,
      "NGHTTP2_FLAG_PRIORITY": 32,
      "DEFAULT_SETTINGS_HEADER_TABLE_SIZE": 4096,
      "DEFAULT_SETTINGS_ENABLE_PUSH": 1,
      "DEFAULT_SETTINGS_MAX_CONCURRENT_STREAMS": 4294967295,
      "DEFAULT_SETTINGS_INITIAL_WINDOW_SIZE": 65535,
      "DEFAULT_SETTINGS_MAX_FRAME_SIZE": 16384,
      "DEFAULT_SETTINGS_MAX_HEADER_LIST_SIZE": 65535,
      "DEFAULT_SETTINGS_ENABLE_CONNECT_PROTOCOL": 0,
      "MAX_MAX_FRAME_SIZE": 16777215,
      "MIN_MAX_FRAME_SIZE": 16384,
      "MAX_INITIAL_WINDOW_SIZE": 2147483647,
      "NGHTTP2_SETTINGS_HEADER_TABLE_SIZE": 1,
      "NGHTTP2_SETTINGS_ENABLE_PUSH": 2,
      "NGHTTP2_SETTINGS_MAX_CONCURRENT_STREAMS": 3,
      "NGHTTP2_SETTINGS_INITIAL_WINDOW_SIZE": 4,
      "NGHTTP2_SETTINGS_MAX_FRAME_SIZE": 5,
      "NGHTTP2_SETTINGS_MAX_HEADER_LIST_SIZE": 6,
      "NGHTTP2_SETTINGS_ENABLE_CONNECT_PROTOCOL": 8,
      "PADDING_STRATEGY_NONE": 0,
      "PADDING_STRATEGY_ALIGNED": 1,
      "PADDING_STRATEGY_MAX": 2,
      "PADDING_STRATEGY_CALLBACK": 1,
      "NGHTTP2_NO_ERROR": 0,
      "NGHTTP2_PROTOCOL_ERROR": 1,
      "NGHTTP2_INTERNAL_ERROR": 2,
      "NGHTTP2_FLOW_CONTROL_ERROR": 3,
      "NGHTTP2_SETTINGS_TIMEOUT": 4,
      "NGHTTP2_STREAM_CLOSED": 5,
      "NGHTTP2_FRAME_SIZE_ERROR": 6,
      "NGHTTP2_REFUSED_STREAM": 7,
      "NGHTTP2_CANCEL": 8,
      "NGHTTP2_COMPRESSION_ERROR": 9,
      "NGHTTP2_CONNECT_ERROR": 10,
      "NGHTTP2_ENHANCE_YOUR_CALM": 11,
      "NGHTTP2_INADEQUATE_SECURITY": 12,
      "NGHTTP2_HTTP_1_1_REQUIRED": 13,
      "NGHTTP2_DEFAULT_WEIGHT": 16,
      "HTTP2_HEADER_STATUS": ":status",
      "HTTP2_HEADER_METHOD": ":method",
      "HTTP2_HEADER_AUTHORITY": ":authority",
      "HTTP2_HEADER_SCHEME": ":scheme",
      "HTTP2_HEADER_PATH": ":path",
      "HTTP2_HEADER_PROTOCOL": ":protocol",
      "HTTP2_HEADER_ACCEPT_ENCODING": "accept-encoding",
      "HTTP2_HEADER_ACCEPT_LANGUAGE": "accept-language",
      "HTTP2_HEADER_ACCEPT_RANGES": "accept-ranges",
      "HTTP2_HEADER_ACCEPT": "accept",
      "HTTP2_HEADER_ACCESS_CONTROL_ALLOW_CREDENTIALS": "access-control-allow-credentials",
      "HTTP2_HEADER_ACCESS_CONTROL_ALLOW_HEADERS": "access-control-allow-headers",
      "HTTP2_HEADER_ACCESS_CONTROL_ALLOW_METHODS": "access-control-allow-methods",
      "HTTP2_HEADER_ACCESS_CONTROL_ALLOW_ORIGIN": "access-control-allow-origin",
      "HTTP2_HEADER_ACCESS_CONTROL_EXPOSE_HEADERS": "access-control-expose-headers",
      "HTTP2_HEADER_ACCESS_CONTROL_REQUEST_HEADERS": "access-control-request-headers",
      "HTTP2_HEADER_ACCESS_CONTROL_REQUEST_METHOD": "access-control-request-method",
      "HTTP2_HEADER_AGE": "age",
      "HTTP2_HEADER_AUTHORIZATION": "authorization",
      "HTTP2_HEADER_CACHE_CONTROL": "cache-control",
      "HTTP2_HEADER_CONNECTION": "connection",
      "HTTP2_HEADER_CONTENT_DISPOSITION": "content-disposition",
      "HTTP2_HEADER_CONTENT_ENCODING": "content-encoding",
      "HTTP2_HEADER_CONTENT_LENGTH": "content-length",
      "HTTP2_HEADER_CONTENT_TYPE": "content-type",
      "HTTP2_HEADER_COOKIE": "cookie",
      "HTTP2_HEADER_DATE": "date",
      "HTTP2_HEADER_ETAG": "etag",
      "HTTP2_HEADER_FORWARDED": "forwarded",
      "HTTP2_HEADER_HOST": "host",
      "HTTP2_HEADER_IF_MODIFIED_SINCE": "if-modified-since",
      "HTTP2_HEADER_IF_NONE_MATCH": "if-none-match",
      "HTTP2_HEADER_IF_RANGE": "if-range",
      "HTTP2_HEADER_LAST_MODIFIED": "last-modified",
      "HTTP2_HEADER_LINK": "link",
      "HTTP2_HEADER_LOCATION": "location",
      "HTTP2_HEADER_RANGE": "range",
      "HTTP2_HEADER_REFERER": "referer",
      "HTTP2_HEADER_SERVER": "server",
      "HTTP2_HEADER_SET_COOKIE": "set-cookie",
      "HTTP2_HEADER_STRICT_TRANSPORT_SECURITY": "strict-transport-security",
      "HTTP2_HEADER_TRANSFER_ENCODING": "transfer-encoding",
      "HTTP2_HEADER_TE": "te",
      "HTTP2_HEADER_UPGRADE_INSECURE_REQUESTS": "upgrade-insecure-requests",
      "HTTP2_HEADER_UPGRADE": "upgrade",
      "HTTP2_HEADER_USER_AGENT": "user-agent",
      "HTTP2_HEADER_VARY": "vary",
      "HTTP2_HEADER_X_CONTENT_TYPE_OPTIONS": "x-content-type-options",
      "HTTP2_HEADER_X_FRAME_OPTIONS": "x-frame-options",
      "HTTP2_HEADER_KEEP_ALIVE": "keep-alive",
      "HTTP2_HEADER_PROXY_CONNECTION": "proxy-connection",
      "HTTP2_HEADER_X_XSS_PROTECTION": "x-xss-protection",
      "HTTP2_HEADER_ALT_SVC": "alt-svc",
      "HTTP2_HEADER_CONTENT_SECURITY_POLICY": "content-security-policy",
      "HTTP2_HEADER_EARLY_DATA": "early-data",
      "HTTP2_HEADER_EXPECT_CT": "expect-ct",
      "HTTP2_HEADER_ORIGIN": "origin",
      "HTTP2_HEADER_PURPOSE": "purpose",
      "HTTP2_HEADER_TIMING_ALLOW_ORIGIN": "timing-allow-origin",
      "HTTP2_HEADER_X_FORWARDED_FOR": "x-forwarded-for",
      "HTTP2_HEADER_PRIORITY": "priority",
      "HTTP2_HEADER_ACCEPT_CHARSET": "accept-charset",
      "HTTP2_HEADER_ACCESS_CONTROL_MAX_AGE": "access-control-max-age",
      "HTTP2_HEADER_ALLOW": "allow",
      "HTTP2_HEADER_CONTENT_LANGUAGE": "content-language",
      "HTTP2_HEADER_CONTENT_LOCATION": "content-location",
      "HTTP2_HEADER_CONTENT_MD5": "content-md5",
      "HTTP2_HEADER_CONTENT_RANGE": "content-range",
      "HTTP2_HEADER_DNT": "dnt",
      "HTTP2_HEADER_EXPECT": "expect",
      "HTTP2_HEADER_EXPIRES": "expires",
      "HTTP2_HEADER_FROM": "from",
      "HTTP2_HEADER_IF_MATCH": "if-match",
      "HTTP2_HEADER_IF_UNMODIFIED_SINCE": "if-unmodified-since",
      "HTTP2_HEADER_MAX_FORWARDS": "max-forwards",
      "HTTP2_HEADER_PREFER": "prefer",
      "HTTP2_HEADER_PROXY_AUTHENTICATE": "proxy-authenticate",
      "HTTP2_HEADER_PROXY_AUTHORIZATION": "proxy-authorization",
      "HTTP2_HEADER_REFRESH": "refresh",
      "HTTP2_HEADER_RETRY_AFTER": "retry-after",
      "HTTP2_HEADER_TRAILER": "trailer",
      "HTTP2_HEADER_TK": "tk",
      "HTTP2_HEADER_VIA": "via",
      "HTTP2_HEADER_WARNING": "warning",
      "HTTP2_HEADER_WWW_AUTHENTICATE": "www-authenticate",
      "HTTP2_HEADER_HTTP2_SETTINGS": "http2-settings",
      "HTTP2_METHOD_ACL": "ACL",
      "HTTP2_METHOD_BASELINE_CONTROL": "BASELINE-CONTROL",
      "HTTP2_METHOD_BIND": "BIND",
      "HTTP2_METHOD_CHECKIN": "CHECKIN",
      "HTTP2_METHOD_CHECKOUT": "CHECKOUT",
      "HTTP2_METHOD_CONNECT": "CONNECT",
      "HTTP2_METHOD_COPY": "COPY",
      "HTTP2_METHOD_DELETE": "DELETE",
      "HTTP2_METHOD_GET": "GET",
      "HTTP2_METHOD_HEAD": "HEAD",
      "HTTP2_METHOD_LABEL": "LABEL",
      "HTTP2_METHOD_LINK": "LINK",
      "HTTP2_METHOD_LOCK": "LOCK",
      "HTTP2_METHOD_MERGE": "MERGE",
      "HTTP2_METHOD_MKACTIVITY": "MKACTIVITY",
      "HTTP2_METHOD_MKCALENDAR": "MKCALENDAR",
      "HTTP2_METHOD_MKCOL": "MKCOL",
      "HTTP2_METHOD_MKREDIRECTREF": "MKREDIRECTREF",
      "HTTP2_METHOD_MKWORKSPACE": "MKWORKSPACE",
      "HTTP2_METHOD_MOVE": "MOVE",
      "HTTP2_METHOD_OPTIONS": "OPTIONS",
      "HTTP2_METHOD_ORDERPATCH": "ORDERPATCH",
      "HTTP2_METHOD_PATCH": "PATCH",
      "HTTP2_METHOD_POST": "POST",
      "HTTP2_METHOD_PRI": "PRI",
      "HTTP2_METHOD_PROPFIND": "PROPFIND",
      "HTTP2_METHOD_PROPPATCH": "PROPPATCH",
      "HTTP2_METHOD_PUT": "PUT",
      "HTTP2_METHOD_REBIND": "REBIND",
      "HTTP2_METHOD_REPORT": "REPORT",
      "HTTP2_METHOD_SEARCH": "SEARCH",
      "HTTP2_METHOD_TRACE": "TRACE",
      "HTTP2_METHOD_UNBIND": "UNBIND",
      "HTTP2_METHOD_UNCHECKOUT": "UNCHECKOUT",
      "HTTP2_METHOD_UNLINK": "UNLINK",
      "HTTP2_METHOD_UNLOCK": "UNLOCK",
      "HTTP2_METHOD_UPDATE": "UPDATE",
      "HTTP2_METHOD_UPDATEREDIRECTREF": "UPDATEREDIRECTREF",
      "HTTP2_METHOD_VERSION_CONTROL": "VERSION-CONTROL",
      "HTTP_STATUS_CONTINUE": 100,
      "HTTP_STATUS_SWITCHING_PROTOCOLS": 101,
      "HTTP_STATUS_PROCESSING": 102,
      "HTTP_STATUS_EARLY_HINTS": 103,
      "HTTP_STATUS_OK": 200,
      "HTTP_STATUS_CREATED": 201,
      "HTTP_STATUS_ACCEPTED": 202,
      "HTTP_STATUS_NON_AUTHORITATIVE_INFORMATION": 203,
      "HTTP_STATUS_NO_CONTENT": 204,
      "HTTP_STATUS_RESET_CONTENT": 205,
      "HTTP_STATUS_PARTIAL_CONTENT": 206,
      "HTTP_STATUS_MULTI_STATUS": 207,
      "HTTP_STATUS_ALREADY_REPORTED": 208,
      "HTTP_STATUS_IM_USED": 226,
      "HTTP_STATUS_MULTIPLE_CHOICES": 300,
      "HTTP_STATUS_MOVED_PERMANENTLY": 301,
      "HTTP_STATUS_FOUND": 302,
      "HTTP_STATUS_SEE_OTHER": 303,
      "HTTP_STATUS_NOT_MODIFIED": 304,
      "HTTP_STATUS_USE_PROXY": 305,
      "HTTP_STATUS_TEMPORARY_REDIRECT": 307,
      "HTTP_STATUS_PERMANENT_REDIRECT": 308,
      "HTTP_STATUS_BAD_REQUEST": 400,
      "HTTP_STATUS_UNAUTHORIZED": 401,
      "HTTP_STATUS_PAYMENT_REQUIRED": 402,
      "HTTP_STATUS_FORBIDDEN": 403,
      "HTTP_STATUS_NOT_FOUND": 404,
      "HTTP_STATUS_METHOD_NOT_ALLOWED": 405,
      "HTTP_STATUS_NOT_ACCEPTABLE": 406,
      "HTTP_STATUS_PROXY_AUTHENTICATION_REQUIRED": 407,
      "HTTP_STATUS_REQUEST_TIMEOUT": 408,
      "HTTP_STATUS_CONFLICT": 409,
      "HTTP_STATUS_GONE": 410,
      "HTTP_STATUS_LENGTH_REQUIRED": 411,
      "HTTP_STATUS_PRECONDITION_FAILED": 412,
      "HTTP_STATUS_PAYLOAD_TOO_LARGE": 413,
      "HTTP_STATUS_URI_TOO_LONG": 414,
      "HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE": 415,
      "HTTP_STATUS_RANGE_NOT_SATISFIABLE": 416,
      "HTTP_STATUS_EXPECTATION_FAILED": 417,
      "HTTP_STATUS_TEAPOT": 418,
      "HTTP_STATUS_MISDIRECTED_REQUEST": 421,
      "HTTP_STATUS_UNPROCESSABLE_ENTITY": 422,
      "HTTP_STATUS_LOCKED": 423,
      "HTTP_STATUS_FAILED_DEPENDENCY": 424,
      "HTTP_STATUS_TOO_EARLY": 425,
      "HTTP_STATUS_UPGRADE_REQUIRED": 426,
      "HTTP_STATUS_PRECONDITION_REQUIRED": 428,
      "HTTP_STATUS_TOO_MANY_REQUESTS": 429,
      "HTTP_STATUS_REQUEST_HEADER_FIELDS_TOO_LARGE": 431,
      "HTTP_STATUS_UNAVAILABLE_FOR_LEGAL_REASONS": 451,
      "HTTP_STATUS_INTERNAL_SERVER_ERROR": 500,
      "HTTP_STATUS_NOT_IMPLEMENTED": 501,
      "HTTP_STATUS_BAD_GATEWAY": 502,
      "HTTP_STATUS_SERVICE_UNAVAILABLE": 503,
      "HTTP_STATUS_GATEWAY_TIMEOUT": 504,
      "HTTP_STATUS_HTTP_VERSION_NOT_SUPPORTED": 505,
      "HTTP_STATUS_VARIANT_ALSO_NEGOTIATES": 506,
      "HTTP_STATUS_INSUFFICIENT_STORAGE": 507,
      "HTTP_STATUS_LOOP_DETECTED": 508,
      "HTTP_STATUS_BANDWIDTH_LIMIT_EXCEEDED": 509,
      "HTTP_STATUS_NOT_EXTENDED": 510,
      "HTTP_STATUS_NETWORK_AUTHENTICATION_REQUIRED": 511,
    });
  });
  it("getDefaultSettings", () => {
    const settings = http2.getDefaultSettings();
    expect(settings).toEqual({
      headerTableSize: 4096,
      enablePush: true,
      initialWindowSize: 65535,
      maxFrameSize: 16384,
      maxConcurrentStreams: 2147483647,
      maxHeaderListSize: 65535,
      maxHeaderSize: 65535,
    });
  });
  it("getPackedSettings/getUnpackedSettings", () => {
    const settings = {
      headerTableSize: 1,
      enablePush: false,
      initialWindowSize: 2,
      maxFrameSize: 32768,
      maxConcurrentStreams: 4,
      maxHeaderListSize: 5,
      maxHeaderSize: 5,
    };
    const buffer = http2.getPackedSettings(settings);
    expect(buffer.byteLength).toBe(36);
    expect(http2.getUnpackedSettings(buffer)).toEqual(settings);
  });
  it("getUnpackedSettings should throw if buffer is too small", () => {
    const buffer = new ArrayBuffer(1);
    expect(() => http2.getUnpackedSettings(buffer)).toThrow(
      /Expected buf to be a Buffer of at least 6 bytes and a multiple of 6 bytes/,
    );
  });
  it("getUnpackedSettings should throw if buffer is not a multiple of 6 bytes", () => {
    const buffer = new ArrayBuffer(7);
    expect(() => http2.getUnpackedSettings(buffer)).toThrow(
      /Expected buf to be a Buffer of at least 6 bytes and a multiple of 6 bytes/,
    );
  });
  it("getUnpackedSettings should throw if buffer is not a buffer", () => {
    const buffer = {};
    expect(() => http2.getUnpackedSettings(buffer)).toThrow(/Expected buf to be a Buffer/);
  });
  it("headers cannot be bigger than 65536 bytes", async () => {
    try {
      await doHttp2Request("https://bun.sh", { ":path": "/", "test-header": "A".repeat(90000) });
      expect("unreachable").toBe(true);
    } catch (err) {
      expect(err.code).toBe("ERR_HTTP2_STREAM_ERROR");
      expect(err.message).toBe("Stream closed with error code 9");
    }
  });
  it("should be destroyed after close", async () => {
    const { promise, resolve, reject: promiseReject } = Promise.withResolvers();
    const client = http2.connect("https://httpbin.org/get");
    client.on("error", promiseReject);
    client.on("close", resolve);
    function reject(err) {
      promiseReject(err);
      client.close();
    }
    const req = client.request({
      ":path": "/get",
    });
    req.on("error", reject);
    req.on("end", () => {
      client.close();
    });
    req.end();
    await promise;
    expect(client.destroyed).toBe(true);
  });
  it("should be destroyed after destroy", async () => {
    const { promise, resolve, reject: promiseReject } = Promise.withResolvers();
    const client = http2.connect("https://httpbin.org/get");
    client.on("error", promiseReject);
    client.on("close", resolve);
    function reject(err) {
      promiseReject(err);
      client.destroy();
    }
    const req = client.request({
      ":path": "/get",
    });
    req.on("error", reject);
    req.on("end", () => {
      client.destroy();
    });
    req.end();
    await promise;
    expect(client.destroyed).toBe(true);
  });
  it("should fail to connect over HTTP/1.1", async () => {
    const tls = {
      ...TLS_CERT,
      ca: TLS_CERT.cert,
    };
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls,
      fetch() {
        return new Response("hello");
      },
    });
    const url = `https://127.0.0.1:${server.port}`;
    try {
      await doHttp2Request(url, { ":path": "/" }, null, tls);
      expect("unreachable").toBe(true);
    } catch (err) {
      expect(err.code).toBe("ERR_HTTP2_ERROR");
    } finally {
      server.stop();
    }
  });
  it("works with Duplex", async () => {
    class JSSocket extends Duplex {
      constructor(socket) {
        super({ emitClose: true });
        socket.on("close", () => this.destroy());
        socket.on("data", data => this.push(data));
        this.socket = socket;
      }
      _write(data, encoding, callback) {
        this.socket.write(data, encoding, callback);
      }
      _read(size) {}
      _final(cb) {
        cb();
      }
    }
    const { promise, resolve, reject } = Promise.withResolvers();
    const socket = tls
      .connect(
        {
          rejectUnauthorized: false,
          host: "httpbin.org",
          port: 443,
          ALPNProtocols: ["h2"],
        },
        () => {
          doHttp2Request("https://httpbin.org/get", { ":path": "/get" }, null, {
            createConnection: () => {
              return new JSSocket(socket);
            },
          }).then(resolve, reject);
        },
      )
      .on("error", reject);
    const result = await promise;
    let parsed;
    expect(() => (parsed = JSON.parse(result.data))).not.toThrow();
    expect(parsed.url).toBe("https://httpbin.org/get");
    socket.destroy();
  });
  it("close callback", async () => {
    const { promise, resolve, reject } = Promise.withResolvers();
    const client = http2.connect(`https://httpbin.org/get`);
    client.on("error", reject);
    client.close(resolve);
    await promise;
    expect(client.destroyed).toBe(true);
  });
  it("is possibel to abort request", async () => {
    const abortController = new AbortController();
    const promise = doHttp2Request("https://httpbin.org/get", { ":path": "/get" }, null, null, {
      signal: abortController.signal,
    });
    abortController.abort();
    try {
      await promise;
      expect("unreachable").toBe(true);
    } catch (err) {
      expect(err.code).toBe("ERR_HTTP2_STREAM_ERROR");
      expect(err.message).toBe("Stream closed with error code 8");
    }
  });
  it("aborted event should work with abortController", async () => {
    const abortController = new AbortController();
    const { promise, resolve, reject } = Promise.withResolvers();
    const client = http2.connect("https://www.example.com");
    client.on("error", reject);
    const req = client.request({ ":path": "/" }, { signal: abortController.signal });
    req.on("aborted", resolve);
    req.on("end", () => {
      resolve();
      client.close();
    });
    abortController.abort();
    const result = await promise;
    expect(result).toBeDefined();
    expect(result.name).toBe("AbortError");
    expect(result.message).toBe("The operation was aborted.");
    expect(result.code).toBe(20);
    expect(req.aborted).toBeTrue();
    expect(req.rstCode).toBe(8);
  });
  it("aborted event should work with aborted signal", async () => {
    const { promise, resolve, reject } = Promise.withResolvers();
    const client = http2.connect("https://www.example.com");
    client.on("error", reject);
    const req = client.request({ ":path": "/" }, { signal: AbortSignal.abort() });
    req.on("aborted", resolve);
    req.on("end", () => {
      resolve();
      client.close();
    });
    const result = await promise;
    expect(result).toBeDefined();
    expect(result.name).toBe("AbortError");
    expect(result.message).toBe("The operation was aborted.");
    expect(result.code).toBe(20);
    expect(req.rstCode).toBe(8);
    expect(req.aborted).toBeTrue();
  });
  it("endAfterHeaders should work", async () => {
    const { promise, resolve, reject } = Promise.withResolvers();
    const client = http2.connect("https://www.example.com");
    client.on("error", reject);
    const req = client.request({ ":path": "/" });
    req.endAfterHeaders = true;
    let response_headers = null;
    req.on("response", (headers, flags) => {
      response_headers = headers;
    });
    req.setEncoding("utf8");
    let data = "";
    req.on("data", chunk => {
      data += chunk;
    });
    req.on("end", () => {
      resolve();
      client.close();
    });
    await promise;
    expect(response_headers[":status"]).toBe(200);
    expect(data).toBeFalsy();
  });
  it("state should work", async () => {
    const { promise, resolve, reject } = Promise.withResolvers();
    const client = http2.connect("https://www.example.com");
    client.on("error", reject);
    const req = client.request({ ":path": "/", "test-header": "test-value" });
    {
      const state = req.state;
      expect(typeof state).toBe("object");
      expect(typeof state.state).toBe("number");
      expect(typeof state.weight).toBe("number");
      expect(typeof state.sumDependencyWeight).toBe("number");
      expect(typeof state.localClose).toBe("number");
      expect(typeof state.remoteClose).toBe("number");
      expect(typeof state.localWindowSize).toBe("number");
    }
    // Test Session State.
    {
      const state = client.state;
      expect(typeof state).toBe("object");
      expect(typeof state.effectiveLocalWindowSize).toBe("number");
      expect(typeof state.effectiveRecvDataLength).toBe("number");
      expect(typeof state.nextStreamID).toBe("number");
      expect(typeof state.localWindowSize).toBe("number");
      expect(typeof state.lastProcStreamID).toBe("number");
      expect(typeof state.remoteWindowSize).toBe("number");
      expect(typeof state.outboundQueueSize).toBe("number");
      expect(typeof state.deflateDynamicTableSize).toBe("number");
      expect(typeof state.inflateDynamicTableSize).toBe("number");
    }
    let response_headers = null;
    req.on("response", (headers, flags) => {
      response_headers = headers;
    });
    req.on("end", () => {
      resolve();
      client.close();
    });
    await promise;
    expect(response_headers[":status"]).toBe(200);
  });
  it("settings and properties should work", async () => {
    const assertSettings = settings => {
      expect(settings).toBeDefined();
      expect(typeof settings).toBe("object");
      expect(typeof settings.headerTableSize).toBe("number");
      expect(typeof settings.enablePush).toBe("boolean");
      expect(typeof settings.initialWindowSize).toBe("number");
      expect(typeof settings.maxFrameSize).toBe("number");
      expect(typeof settings.maxConcurrentStreams).toBe("number");
      expect(typeof settings.maxHeaderListSize).toBe("number");
      expect(typeof settings.maxHeaderSize).toBe("number");
    };
    const { promise, resolve, reject } = Promise.withResolvers();
    const client = http2.connect("https://www.example.com");
    client.on("error", reject);
    expect(client.connecting).toBeTrue();
    expect(client.alpnProtocol).toBeUndefined();
    expect(client.encrypted).toBeTrue();
    expect(client.closed).toBeFalse();
    expect(client.destroyed).toBeFalse();
    expect(client.originSet.length).toBe(0);
    expect(client.pendingSettingsAck).toBeTrue();
    let received_origin = null;
    client.on("origin", origin => {
      received_origin = origin;
    });
    assertSettings(client.localSettings);
    expect(client.remoteSettings).toBeNull();
    const headers = { ":path": "/" };
    const req = client.request(headers);
    expect(req.closed).toBeFalse();
    expect(req.destroyed).toBeFalse();
    // we always asign a stream id to the request
    expect(req.pending).toBeFalse();
    expect(typeof req.id).toBe("number");
    expect(req.session).toBeDefined();
    expect(req.sentHeaders).toEqual(headers);
    expect(req.sentTrailers).toBeUndefined();
    expect(req.sentInfoHeaders.length).toBe(0);
    expect(req.scheme).toBe("https");
    let response_headers = null;
    req.on("response", (headers, flags) => {
      response_headers = headers;
    });
    req.on("end", () => {
      resolve();
    });
    await promise;
    expect(response_headers[":status"]).toBe(200);
    const settings = client.remoteSettings;
    const localSettings = client.localSettings;
    assertSettings(settings);
    assertSettings(localSettings);
    expect(settings).toEqual(client.remoteSettings);
    expect(localSettings).toEqual(client.localSettings);
    client.destroy();
    expect(client.connecting).toBeFalse();
    expect(client.alpnProtocol).toBe("h2");
    expect(client.originSet.length).toBe(1);
    expect(client.originSet).toEqual(received_origin);
    expect(client.originSet[0]).toBe("www.example.com");
    expect(client.pendingSettingsAck).toBeFalse();
    expect(client.destroyed).toBeTrue();
    expect(client.closed).toBeTrue();
    expect(req.closed).toBeTrue();
    expect(req.destroyed).toBeTrue();
    expect(req.rstCode).toBe(http2.constants.NGHTTP2_NO_ERROR);
  });
  it("ping events should work", async () => {
    const { promise, resolve, reject } = Promise.withResolvers();
    const client = http2.connect("https://www.example.com");
    client.on("error", reject);
    client.on("connect", () => {
      client.ping(Buffer.from("12345678"), (err, duration, payload) => {
        if (err) {
          reject(err);
        } else {
          resolve({ duration, payload });
        }
        client.close();
      });
    });
    let received_ping;
    client.on("ping", payload => {
      received_ping = payload;
    });
    const result = await promise;
    expect(typeof result.duration).toBe("number");
    expect(result.payload).toBeInstanceOf(Buffer);
    expect(result.payload.byteLength).toBe(8);
    expect(received_ping).toBeInstanceOf(Buffer);
    expect(received_ping.byteLength).toBe(8);
    expect(received_ping).toEqual(result.payload);
    expect(received_ping).toEqual(Buffer.from("12345678"));
  });
  it("ping without events should work", async () => {
    const { promise, resolve, reject } = Promise.withResolvers();
    const client = http2.connect("https://www.example.com");
    client.on("error", reject);
    client.on("connect", () => {
      client.ping((err, duration, payload) => {
        if (err) {
          reject(err);
        } else {
          resolve({ duration, payload });
        }
        client.close();
      });
    });
    let received_ping;
    client.on("ping", payload => {
      received_ping = payload;
    });
    const result = await promise;
    expect(typeof result.duration).toBe("number");
    expect(result.payload).toBeInstanceOf(Buffer);
    expect(result.payload.byteLength).toBe(8);
    expect(received_ping).toBeInstanceOf(Buffer);
    expect(received_ping.byteLength).toBe(8);
    expect(received_ping).toEqual(result.payload);
  });
  it("ping with wrong payload length events should error", async () => {
    const { promise, resolve, reject } = Promise.withResolvers();
    const client = http2.connect("https://www.example.com");
    client.on("error", resolve);
    client.on("connect", () => {
      client.ping(Buffer.from("oops"), (err, duration, payload) => {
        if (err) {
          resolve(err);
        } else {
          reject("unreachable");
        }
        client.close();
      });
    });
    const result = await promise;
    expect(result).toBeDefined();
    expect(result.code).toBe("ERR_HTTP2_PING_LENGTH");
  });
  it("ping with wrong payload type events should throw", async () => {
    const { promise, resolve, reject } = Promise.withResolvers();
    const client = http2.connect("https://www.example.com");
    client.on("error", resolve);
    client.on("connect", () => {
      try {
        client.ping("oops", (err, duration, payload) => {
          reject("unreachable");
          client.close();
        });
      } catch (err) {
        resolve(err);
        client.close();
      }
    });
    const result = await promise;
    expect(result).toBeDefined();
    expect(result.code).toBe("ERR_INVALID_ARG_TYPE");
  });
  it("stream event should work", async () => {
    const { promise, resolve, reject } = Promise.withResolvers();
    const client = http2.connect("https://www.example.com");
    client.on("error", reject);
    client.on("stream", stream => {
      resolve(stream);
      client.close();
    });
    client.request({ ":path": "/" }).end();
    const stream = await promise;
    expect(stream).toBeDefined();
    expect(stream.id).toBe(1);
  });
  it("should wait request to be sent before closing", async () => {
    const { promise, resolve, reject } = Promise.withResolvers();
    const client = http2.connect("https://www.example.com");
    client.on("error", reject);
    const req = client.request({ ":path": "/" });
    let response_headers = null;
    req.on("response", (headers, flags) => {
      response_headers = headers;
    });
    client.close(resolve);
    req.end();
    await promise;
    expect(response_headers).toBeTruthy();
    expect(response_headers[":status"]).toBe(200);
  });
  it("wantTrailers should work", async () => {
    const info = await nodeEchoServer();
    try {
      const { promise, resolve, reject } = Promise.withResolvers();
      const client = http2.connect(info.url, {
        ...TLS_CERT,
        ca: TLS_CERT.cert,
      });
      client.on("error", reject);
      const headers = { ":path": "/", ":method": "POST", "x-wait-trailer": "true" };
      const req = client.request(headers, {
        waitForTrailers: true,
      });
      req.setEncoding("utf8");
      let response_headers;
      req.on("response", headers => {
        response_headers = headers;
      });
      let trailers = { "x-trailer": "hello" };
      req.on("wantTrailers", () => {
        req.sendTrailers(trailers);
      });
      let data = "";
      req.on("data", chunk => {
        data += chunk;
        client.close();
      });
      req.on("error", reject);
      req.on("end", () => {
        resolve({ data, headers: response_headers });
        client.close();
      });
      req.end("hello");
      const response = await promise;
      let parsed;
      expect(() => (parsed = JSON.parse(response.data))).not.toThrow();
      expect(parsed.headers[":method"]).toEqual(headers[":method"]);
      expect(parsed.headers[":path"]).toEqual(headers[":path"]);
      expect(parsed.headers["x-wait-trailer"]).toEqual(headers["x-wait-trailer"]);
      expect(parsed.trailers).toEqual(trailers);
      expect(response.headers[":status"]).toBe(200);
      expect(response.headers["set-cookie"]).toEqual([
        "a=b",
        "c=d; Wed, 21 Oct 2015 07:28:00 GMT; Secure; HttpOnly",
        "e=f",
      ]);
    } finally {
      info.subprocess.kill();
    }
  });

  it("should not leak memory", () => {
    const { stdout, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "--smol", "run", path.join(import.meta.dir, "node-http2-memory-leak.js")],
      env: {
        ...bunEnv,
        BUN_JSC_forceRAMSize: (1024 * 1024 * 64).toString("10"),
      },
      stderr: "inherit",
    });
    expect(stdout.toString("utf-8")).toBeEmpty();
    expect(exitCode).toBe(0);
  }, 100000);

  it("should receive goaway", async () => {
    const { promise, resolve, reject } = Promise.withResolvers();
    const server = await nodeDynamicServer(
      "http2.away.1.js",
      `
    server.on("stream", (stream, headers, flags) => {
      stream.session.goaway(http2.constants.NGHTTP2_CONNECT_ERROR, 0, Buffer.from("123456"));
    });
  `,
    );
    try {
      const client = http2.connect(server.url);
      client.on("goaway", (...params) => resolve(params));
      client.on("error", reject);
      client.on("connect", () => {
        const req = client.request({ ":path": "/" });
        req.end();
      });
      const result = await promise;
      expect(result).toBeDefined();
      const [code, lastStreamID, opaqueData] = result;
      expect(code).toBe(http2.constants.NGHTTP2_CONNECT_ERROR);
      expect(lastStreamID).toBe(0);
      expect(opaqueData.toString()).toBe("123456");
    } finally {
      server.subprocess.kill();
    }
  });
  it("should receive goaway without debug data", async () => {
    const { promise, resolve, reject } = Promise.withResolvers();
    const server = await nodeDynamicServer(
      "http2.away.2.js",
      `
    server.on("stream", (stream, headers, flags) => {
      stream.session.goaway(http2.constants.NGHTTP2_CONNECT_ERROR, 0);
    });
  `,
    );
    try {
      const client = http2.connect(server.url);
      client.on("goaway", (...params) => resolve(params));
      client.on("error", reject);
      client.on("connect", () => {
        const req = client.request({ ":path": "/" });
        req.end();
      });
      const result = await promise;
      expect(result).toBeDefined();
      const [code, lastStreamID, opaqueData] = result;
      expect(code).toBe(http2.constants.NGHTTP2_CONNECT_ERROR);
      expect(lastStreamID).toBe(0);
      expect(opaqueData.toString()).toBe("");
    } finally {
      server.subprocess.kill();
    }
  });
  it("should not be able to write on socket", async () => {
    const server = await nodeEchoServer();
    try {
      const client = http2.connect(server.url);
      client.socket.write("hello");
      client.socket.end();
      expect("unreachable").toBe(true);
    } catch (err) {
      expect(err.code).toBe("ERR_HTTP2_NO_SOCKET_MANIPULATION");
    } finally {
      server.subprocess.kill();
    }
  });
  it("should handle bad GOAWAY server frame size", done => {
    const server = net.createServer(socket => {
      const settings = new http2utils.SettingsFrame(true);
      socket.write(settings.data);
      const frame = new http2utils.Frame(7, 7, 0, 0).data;
      socket.write(Buffer.concat([frame, Buffer.alloc(7)]));
    });
    server.listen(0, "127.0.0.1", async () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      try {
        const { promise, resolve } = Promise.withResolvers();
        const client = http2.connect(url);
        client.on("error", resolve);
        client.on("connect", () => {
          const req = client.request({ ":path": "/" });
          req.end();
        });
        const result = await promise;
        expect(result).toBeDefined();
        expect(result.code).toBe("ERR_HTTP2_SESSION_ERROR");
        expect(result.message).toBe("Session closed with error code 6");
        done();
      } catch (err) {
        done(err);
      } finally {
        server.close();
      }
    });
  });
  it("should handle bad DATA_FRAME server frame size", done => {
    const { promise: waitToWrite, resolve: allowWrite } = Promise.withResolvers();
    const server = net.createServer(async socket => {
      const settings = new http2utils.SettingsFrame(true);
      socket.write(settings.data);
      await waitToWrite;
      const frame = new http2utils.DataFrame(1, Buffer.alloc(16384 * 2), 0, 1).data;
      socket.write(frame);
    });
    server.listen(0, "127.0.0.1", async () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      try {
        const { promise, resolve } = Promise.withResolvers();
        const client = http2.connect(url);
        client.on("error", resolve);
        client.on("connect", () => {
          const req = client.request({ ":path": "/" });
          req.end();
          allowWrite();
        });
        const result = await promise;
        expect(result).toBeDefined();
        expect(result.code).toBe("ERR_HTTP2_SESSION_ERROR");
        expect(result.message).toBe("Session closed with error code 6");
        done();
      } catch (err) {
        done(err);
      } finally {
        server.close();
      }
    });
  });
  it("should handle bad RST_FRAME server frame size (no stream)", done => {
    const { promise: waitToWrite, resolve: allowWrite } = Promise.withResolvers();
    const server = net.createServer(async socket => {
      const settings = new http2utils.SettingsFrame(true);
      socket.write(settings.data);
      await waitToWrite;
      const frame = new http2utils.Frame(4, 3, 0, 0).data;
      socket.write(Buffer.concat([frame, Buffer.alloc(4)]));
    });
    server.listen(0, "127.0.0.1", async () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      try {
        const { promise, resolve } = Promise.withResolvers();
        const client = http2.connect(url);
        client.on("error", resolve);
        client.on("connect", () => {
          const req = client.request({ ":path": "/" });
          req.end();
          allowWrite();
        });
        const result = await promise;
        expect(result).toBeDefined();
        expect(result.code).toBe("ERR_HTTP2_SESSION_ERROR");
        expect(result.message).toBe("Session closed with error code 1");
        done();
      } catch (err) {
        done(err);
      } finally {
        server.close();
      }
    });
  });
  it("should handle bad RST_FRAME server frame size (less than allowed)", done => {
    const { promise: waitToWrite, resolve: allowWrite } = Promise.withResolvers();
    const server = net.createServer(async socket => {
      const settings = new http2utils.SettingsFrame(true);
      socket.write(settings.data);
      await waitToWrite;
      const frame = new http2utils.Frame(3, 3, 0, 1).data;
      socket.write(Buffer.concat([frame, Buffer.alloc(3)]));
    });
    server.listen(0, "127.0.0.1", async () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      try {
        const { promise, resolve } = Promise.withResolvers();
        const client = http2.connect(url);
        client.on("error", resolve);
        client.on("connect", () => {
          const req = client.request({ ":path": "/" });
          req.end();
          allowWrite();
        });
        const result = await promise;
        expect(result).toBeDefined();
        expect(result.code).toBe("ERR_HTTP2_SESSION_ERROR");
        expect(result.message).toBe("Session closed with error code 6");
        done();
      } catch (err) {
        done(err);
      } finally {
        server.close();
      }
    });
  });
  it("should handle bad RST_FRAME server frame size (more than allowed)", done => {
    const { promise: waitToWrite, resolve: allowWrite } = Promise.withResolvers();
    const server = net.createServer(async socket => {
      const settings = new http2utils.SettingsFrame(true);
      socket.write(settings.data);
      await waitToWrite;
      const buffer = Buffer.alloc(16384 * 2);
      const frame = new http2utils.Frame(buffer.byteLength, 3, 0, 1).data;
      socket.write(Buffer.concat([frame, buffer]));
    });
    server.listen(0, "127.0.0.1", async () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      try {
        const { promise, resolve } = Promise.withResolvers();
        const client = http2.connect(url);
        client.on("error", resolve);
        client.on("connect", () => {
          const req = client.request({ ":path": "/" });
          req.end();
          allowWrite();
        });
        const result = await promise;
        expect(result).toBeDefined();
        expect(result.code).toBe("ERR_HTTP2_SESSION_ERROR");
        expect(result.message).toBe("Session closed with error code 6");
        done();
      } catch (err) {
        done(err);
      } finally {
        server.close();
      }
    });
  });

  it("should handle bad CONTINUATION_FRAME server frame size", done => {
    const { promise: waitToWrite, resolve: allowWrite } = Promise.withResolvers();
    const server = net.createServer(async socket => {
      const settings = new http2utils.SettingsFrame(true);
      socket.write(settings.data);
      await waitToWrite;

      const frame = new http2utils.HeadersFrame(1, http2utils.kFakeResponseHeaders, 0, true, false);
      socket.write(frame.data);
      const continuationFrame = new http2utils.ContinuationFrame(1, http2utils.kFakeResponseHeaders, 0, true, false);
      socket.write(continuationFrame.data);
    });
    server.listen(0, "127.0.0.1", async () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      try {
        const { promise, resolve } = Promise.withResolvers();
        const client = http2.connect(url);
        client.on("error", resolve);
        client.on("connect", () => {
          const req = client.request({ ":path": "/" });
          req.end();
          allowWrite();
        });
        const result = await promise;
        expect(result).toBeDefined();
        expect(result.code).toBe("ERR_HTTP2_SESSION_ERROR");
        expect(result.message).toBe("Session closed with error code 1");
        done();
      } catch (err) {
        done(err);
      } finally {
        server.close();
      }
    });
  });

  it("should handle bad PRIOTITY_FRAME server frame size", done => {
    const { promise: waitToWrite, resolve: allowWrite } = Promise.withResolvers();
    const server = net.createServer(async socket => {
      const settings = new http2utils.SettingsFrame(true);
      socket.write(settings.data);
      await waitToWrite;

      const frame = new http2utils.Frame(4, 2, 0, 1).data;
      socket.write(Buffer.concat([frame, Buffer.alloc(4)]));
    });
    server.listen(0, "127.0.0.1", async () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      try {
        const { promise, resolve } = Promise.withResolvers();
        const client = http2.connect(url);
        client.on("error", resolve);
        client.on("connect", () => {
          const req = client.request({ ":path": "/" });
          req.end();
          allowWrite();
        });
        const result = await promise;
        expect(result).toBeDefined();
        expect(result.code).toBe("ERR_HTTP2_SESSION_ERROR");
        expect(result.message).toBe("Session closed with error code 6");
        done();
      } catch (err) {
        done(err);
      } finally {
        server.close();
      }
    });
  });
});

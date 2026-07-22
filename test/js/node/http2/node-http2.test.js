import { bunEnv, bunExe, isASAN, isCI, isDebug, nodeExe } from "harness";
import { createTest } from "node-harness";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { PerformanceObserver } from "node:perf_hooks";
import tls from "node:tls";
import { Duplex, duplexPair } from "stream";
import http2utils from "./helpers";
import { nodeEchoServer, TLS_CERT, TLS_OPTIONS } from "./http2-helpers";
const { describe, expect, it, beforeAll, afterAll, createCallCheckCtx } = createTest(import.meta.path);
// bun-debug ships with ASAN but isn't named bun-asan, so isASAN is false
// there; the 10k-request maxSessionMemory stress test takes ~105s under
// debug+ASAN vs ~2s release, so scale for either.
const ASAN_MULTIPLIER = isDebug ? 15 : isASAN ? 3 : 1;

function invalidArgTypeHelper(input) {
  if (input === null) return " Received null";

  if (typeof input == "symbol") return ` Received type symbol`;
  if (typeof input == "object")
    return ` Received an instance of ${Object.prototype.toString.call(input).split(" ")[1]?.replace("]", "")?.replace("[", "")}`;
  if (typeof input == "string") return ` Received type string ('${input}')`;
  return ` Received type ${typeof input} (${input})`;
}

function paddingStrategyName(paddingStrategy) {
  switch (paddingStrategy) {
    case http2.constants.PADDING_STRATEGY_NONE:
      return "none";
    case http2.constants.PADDING_STRATEGY_MAX:
      return "max";
    case http2.constants.PADDING_STRATEGY_ALIGNED:
      return "aligned";
  }
}

for (const nodeExecutable of [nodeExe(), bunExe()]) {
  for (const paddingStrategy of [
    http2.constants.PADDING_STRATEGY_NONE,
    http2.constants.PADDING_STRATEGY_MAX,
    http2.constants.PADDING_STRATEGY_ALIGNED,
  ]) {
    describe.concurrent(`${path.basename(nodeExecutable)} ${paddingStrategyName(paddingStrategy)}`, () => {
      async function nodeDynamicServer(test_name, code) {
        if (!nodeExecutable) throw new Error("node executable not found");

        const tmp_dir = path.join(fs.realpathSync(tmpdir()), "http.nodeDynamicServer");
        if (!fs.existsSync(tmp_dir)) {
          fs.mkdirSync(tmp_dir, { recursive: true });
        }

        const file_name = path.join(
          tmp_dir,
          `${path.basename(nodeExecutable)}.${paddingStrategyName(paddingStrategy)}.${test_name}`,
        );
        const contents = Buffer.from(`const http2 = require("http2");
    const server = http2.createServer({ paddingStrategy: ${paddingStrategy} });
  ${code}
  server.listen(0);
  server.on("listening", () => {
    process.stdout.write(JSON.stringify(server.address()));
  });`);
        fs.writeFileSync(file_name, contents);

        const subprocess = Bun.spawn([nodeExecutable, file_name, JSON.stringify(TLS_CERT)], {
          stdout: "pipe",
          stdin: "inherit",
          stderr: "inherit",
          env: bunEnv,
        });
        subprocess.unref();
        const reader = subprocess.stdout.getReader();
        const data = await reader.read();
        const decoder = new TextDecoder("utf-8");
        const text = decoder.decode(data.value);
        const address = JSON.parse(text);
        const url = `http://${address.family === "IPv6" ? `[${address.address}]` : address.address}:${address.port}`;
        return { address, url, subprocess };
      }

      function doHttp2Request(HTTPS_SERVER, url, headers, payload, options, request_options) {
        const { promise, resolve, reject: promiseReject } = Promise.withResolvers();
        if (url.startsWith(HTTPS_SERVER)) {
          options = { ...(options || {}), rejectUnauthorized: true, ...TLS_OPTIONS };
        }

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
        const client = http2.connect(url, TLS_OPTIONS);

        client.on("error", promiseReject);
        function reject(err) {
          promiseReject(err);
          client.close();
        }
        let completed = 0;
        const results = [];
        for (let i = 0; i < requests.length; i++) {
          const { headers, payload } = requests[i];

          const req = client.request(headers, {
            paddingStrategy: paddingStrategy,
          });

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
        // The echo server is stateless; share one instance across all tests in
        // this describe block instead of spawning a fresh subprocess per test.
        let sharedEchoServer;
        let HTTPS_SERVER;
        beforeAll(async () => {
          sharedEchoServer = await nodeEchoServer(paddingStrategy);
          HTTPS_SERVER = sharedEchoServer.url;
        });
        afterAll(() => {
          sharedEchoServer?.subprocess?.kill?.(9);
        });

        // we dont support server yet but we support client
        it("should be able to send a GET request", async () => {
          const result = await doHttp2Request(HTTPS_SERVER, HTTPS_SERVER, {
            ":path": "/get",
            "test-header": "test-value",
          });
          let parsed;
          expect(() => (parsed = JSON.parse(result.data))).not.toThrow();
          expect(parsed.url).toBe(`${HTTPS_SERVER}/get`);
          expect(parsed.headers["test-header"]).toBe("test-value");
        });
        it("should be able to send a POST request", async () => {
          const payload = JSON.stringify({ "hello": "bun" });
          const result = await doHttp2Request(
            HTTPS_SERVER,
            HTTPS_SERVER,
            { ":path": "/post", "test-header": "test-value", ":method": "POST" },
            payload,
          );
          let parsed;
          expect(() => (parsed = JSON.parse(result.data))).not.toThrow();
          expect(parsed.url).toBe(`${HTTPS_SERVER}/post`);
          expect(parsed.headers["test-header"]).toBe("test-value");
          expect(parsed.json).toEqual({ "hello": "bun" });
          expect(parsed.data).toEqual(payload);
        });
        it("should be able to send data using end", async () => {
          const payload = JSON.stringify({ "hello": "bun" });
          const { promise, resolve, reject } = Promise.withResolvers();
          const client = http2.connect(HTTPS_SERVER, TLS_OPTIONS);
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
          expect(parsed.url).toBe(`${HTTPS_SERVER}/post`);
          expect(parsed.headers["test-header"]).toBe("test-value");
          expect(parsed.json).toEqual({ "hello": "bun" });
          expect(parsed.data).toEqual(payload);
        });
        it("should be able to mutiplex GET requests", async () => {
          const results = await doMultiplexHttp2Request(HTTPS_SERVER, [
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
            expect(parsed.url).toBe(`${HTTPS_SERVER}/get`);
          }
        });
        it("http2 should receive remoteSettings when receiving default settings frame", async () => {
          const { promise, resolve, reject } = Promise.withResolvers();
          const session = http2.connect(HTTPS_SERVER, TLS_OPTIONS);

          session.once("remoteSettings", resolve);
          session.once("close", () => {
            reject(new Error("Failed to receive remoteSettings"));
          });
          try {
            const settings = await promise;
            expect(settings).toBeDefined();
            expect(settings).toEqual({
              headerTableSize: 4096,
              enablePush: true,
              maxConcurrentStreams: 4294967295,
              initialWindowSize: 65535,
              maxFrameSize: 16384,
              maxHeaderListSize: 65535,
              maxHeaderSize: 65535,
              enableConnectProtocol: false,
            });
          } finally {
            session.close();
          }
        });
        it("should be able to mutiplex POST requests", async () => {
          const results = await doMultiplexHttp2Request(HTTPS_SERVER, [
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
            expect(parsed.url).toBe(`${HTTPS_SERVER}/post`);
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
            enableConnectProtocol: false,
            headerTableSize: 4096,
            enablePush: true,
            initialWindowSize: 65535,
            maxFrameSize: 16384,
            maxConcurrentStreams: 4294967295,
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
            enableConnectProtocol: false,
          };
          const buffer = http2.getPackedSettings(settings);
          expect(buffer.byteLength).toBe(42);
          expect(http2.getUnpackedSettings(buffer)).toEqual(settings);
        });
        it("getUnpackedSettings should throw if buffer is too small", () => {
          const buffer = Buffer.alloc(1);
          expect(() => http2.getUnpackedSettings(buffer)).toThrow(/Packed settings length must be a multiple of six/);
        });
        it("getUnpackedSettings should throw if buffer is not a multiple of 6 bytes", () => {
          const buffer = Buffer.alloc(7);
          expect(() => http2.getUnpackedSettings(buffer)).toThrow(/Packed settings length must be a multiple of six/);
        });
        it("getUnpackedSettings should throw if buffer is not a buffer", () => {
          const buffer = {};
          expect(() => http2.getUnpackedSettings(buffer)).toThrow();
        });
        it("headers cannot be bigger than 65536 bytes", async () => {
          try {
            await doHttp2Request(HTTPS_SERVER, HTTPS_SERVER, { ":path": "/", "test-header": "A".repeat(90000) });
            expect("unreachable").toBe(true);
          } catch (err) {
            // Verified against node v26.3.0: a header block the encoder cannot emit fails the
            // session with COMPRESSION_ERROR (9), it does not just reset the stream.
            expect(err.code).toBe("ERR_HTTP2_SESSION_ERROR");
            expect(err.message).toBe("Session closed with error code 9");
          }
        });
        it("should be destroyed after close", async () => {
          const { promise, resolve, reject: promiseReject } = Promise.withResolvers();
          const client = http2.connect(`${HTTPS_SERVER}/get`, TLS_OPTIONS);
          client.on("error", promiseReject);
          client.on("close", resolve);
          function reject(err) {
            promiseReject(err);
            client.close();
          }
          const req = client.request({
            ":path": "/get",
          });
          req.resume();
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
          const client = http2.connect(`${HTTPS_SERVER}/get`, TLS_OPTIONS);
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
          req.resume();
          req.on("end", () => {
            client.destroy();
          });
          req.end();
          await promise;
          expect(client.destroyed).toBe(true);
        });
        it("should fail to connect over HTTP/1.1", async () => {
          const tlsCert = TLS_CERT;
          using server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            tls: {
              ...tlsCert,
              ca: TLS_CERT.ca,
            },
            fetch() {
              return new Response("hello");
            },
          });
          const url = `https://127.0.0.1:${server.port}`;
          try {
            await doHttp2Request(HTTPS_SERVER, url, { ":path": "/" }, null, TLS_OPTIONS);
            expect("unreachable").toBe(true);
          } catch (err) {
            expect(err.code).toBe("ERR_HTTP2_ERROR");
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
                host: new URL(HTTPS_SERVER).hostname,
                port: new URL(HTTPS_SERVER).port,
                ALPNProtocols: ["h2"],
                ...TLS_OPTIONS,
              },
              () => {
                doHttp2Request(HTTPS_SERVER, `${HTTPS_SERVER}/get`, { ":path": "/get" }, null, {
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
          expect(parsed.url).toBe(`${HTTPS_SERVER}/get`);
          socket.destroy();
        });
        it("close callback", async () => {
          const { promise, resolve, reject } = Promise.withResolvers();
          const client = http2.connect(`${HTTPS_SERVER}/get`, TLS_OPTIONS);
          client.on("error", reject);
          client.close(resolve);
          await promise;
          expect(client.destroyed).toBe(true);
        });
        it("is possible to abort request", async () => {
          const abortController = new AbortController();
          const promise = doHttp2Request(HTTPS_SERVER, `${HTTPS_SERVER}/get`, { ":path": "/get" }, null, null, {
            signal: abortController.signal,
          });
          abortController.abort();
          try {
            await promise;
            expect("unreachable").toBe(true);
          } catch (err) {
            expect(err.code).toBe("ABORT_ERR");
          }
        });
        it("aborted event should work with abortController", async () => {
          const abortController = new AbortController();
          const { promise, resolve, reject } = Promise.withResolvers();
          const client = http2.connect(HTTPS_SERVER, TLS_OPTIONS);
          client.on("error", reject);
          const req = client.request({ ":path": "/post", ":method": "POST" }, { signal: abortController.signal });
          req.on("aborted", resolve);
          req.on("error", err => {
            if (err.code !== "ABORT_ERR") {
              reject(err);
            }
          });
          req.on("end", () => {
            reject();
            client.close();
          });
          abortController.abort();
          const result = await promise;
          expect(result).toBeUndefined();
          expect(req.aborted).toBeTrue();
          expect(req.rstCode).toBe(http2.constants.NGHTTP2_CANCEL);
        });

        it("aborted event should work with aborted signal", async () => {
          const { promise, resolve, reject } = Promise.withResolvers();
          const client = http2.connect(HTTPS_SERVER, TLS_OPTIONS);
          client.on("error", reject);
          const req = client.request({ ":path": "/post", ":method": "POST" }, { signal: AbortSignal.abort() });
          req.on("aborted", reject); // will not be emited because we could not start the request at all
          req.on("error", err => {
            if (err.name !== "AbortError") {
              reject(err);
            } else {
              resolve();
            }
          });
          req.on("end", () => {
            client.close();
          });
          const result = await promise;
          expect(result).toBeUndefined();
          expect(req.rstCode).toBe(http2.constants.NGHTTP2_CANCEL);
          expect(req.aborted).toBeTrue(); // will be true in this case
        });

        it("signal validation matches node: non-signal objects throw, duck-typed { aborted } is accepted", async () => {
          const client = http2.connect(HTTPS_SERVER, TLS_OPTIONS);
          client.on("error", () => {});
          try {
            // node's validateAbortSignal accepts any object with an 'aborted'
            // property ('aborted' in signal), so a duck-typed { aborted: true }
            // takes the pre-aborted fast path instead of throwing...
            const { promise, resolve, reject } = Promise.withResolvers();
            const req = client.request({ ":path": "/" }, { signal: { aborted: true } });
            req.on("error", err => (err.name === "AbortError" ? resolve() : reject(err)));
            await promise;
            // ...while objects without 'aborted' (and non-objects) throw
            // ERR_INVALID_ARG_TYPE synchronously, before the fast path.
            expect(() => client.request({ ":path": "/" }, { signal: {} })).toThrow(
              expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
            );
            expect(() => client.request({ ":path": "/" }, { signal: 42 })).toThrow(
              expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
            );
          } finally {
            client.close();
          }
        });

        it("state should work", async () => {
          const { promise, resolve, reject } = Promise.withResolvers();
          const client = http2.connect(HTTPS_SERVER, TLS_OPTIONS);
          client.on("error", reject);
          const req = client.request({ ":path": "/", "test-header": "test-value" });
          {
            // Like node, the stream has no id (and an empty state object) until the session
            // finishes connecting; the populated shape is asserted from the 'response' handler.
            expect(req.state).toEqual({});
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
          let response_state = null;
          req.on("response", (headers, flags) => {
            response_headers = headers;
            response_state = req.state;
          });
          req.resume();
          req.on("end", () => {
            resolve();
            client.close();
          });
          await promise;
          expect(response_headers[":status"]).toBe(200);
          {
            const state = response_state;
            expect(typeof state).toBe("object");
            expect(typeof state.state).toBe("number");
            expect(typeof state.weight).toBe("number");
            expect(typeof state.sumDependencyWeight).toBe("number");
            expect(typeof state.localClose).toBe("number");
            expect(typeof state.remoteClose).toBe("number");
            expect(typeof state.localWindowSize).toBe("number");
          }
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
          const h2Server = http2.createSecureServer({ ...TLS_CERT, allowHTTP1: false });
          h2Server.on("stream", (stream, headers) => {
            stream.respond({ ":status": 200 });
            stream.end("OK");
          });
          const { promise: listenPromise, resolve: listenResolve } = Promise.withResolvers();
          h2Server.listen(0, () => listenResolve());
          await listenPromise;
          const serverAddress = h2Server.address();
          const serverUrl = `https://localhost:${serverAddress.port}`;
          try {
            const { promise, resolve, reject } = Promise.withResolvers();
            const client = http2.connect(serverUrl, TLS_OPTIONS);
            client.on("error", reject);
            expect(client.connecting).toBeTrue();
            expect(client.alpnProtocol).toBeUndefined();
            expect(client.encrypted).toBeTrue();
            expect(client.closed).toBeFalse();
            expect(client.destroyed).toBeFalse();
            expect(client.originSet.length).toBe(1);
            expect(client.pendingSettingsAck).toBeTrue();
            // node: while `connecting || destroyed` both getters return a fresh empty object; the
            // first SETTINGS ACK populates localSettings, the peer's first SETTINGS frame populates
            // remoteSettings.
            expect(client.localSettings).toEqual({});
            expect(client.remoteSettings).toEqual({});
            const headers = { ":path": "/" };
            const req = client.request(headers);
            expect(req.closed).toBeFalse();
            expect(req.destroyed).toBeFalse();
            // node: the stream stays pending (no id) until the session finishes connecting; the
            // HEADERS frame is submitted on 'connect'.
            expect(req.pending).toBeTrue();
            expect(req.id).toBeUndefined();
            expect(req.session).toBeDefined();
            expect(req.sentHeaders).toEqual({
              ":authority": `localhost:${serverAddress.port}`,
              ":method": "GET",
              ":path": "/",
              ":scheme": "https",
            });
            expect(req.sentTrailers).toBeUndefined();
            expect(req.sentInfoHeaders.length).toBe(0);
            expect(req.scheme).toBe("https");
            let response_headers = null;
            req.on("response", (headers, flags) => {
              response_headers = headers;
            });
            req.resume();
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
            expect(client.pendingSettingsAck).toBeFalse();
            expect(client.destroyed).toBeTrue();
            // node: destroy() does NOT set `closed` - only close() does (verified on
            // node v26.3.0 against a connected session).
            expect(client.closed).toBeFalse();
            expect(req.closed).toBeTrue();
            expect(req.destroyed).toBeTrue();
            expect(req.rstCode).toBe(http2.constants.NGHTTP2_NO_ERROR);
          } finally {
            h2Server.close();
          }
        });
        it("ping events should work", async () => {
          const { promise, resolve, reject } = Promise.withResolvers();
          const client = http2.connect(HTTPS_SERVER, TLS_OPTIONS);
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
          expect(result.payload).toEqual(Buffer.from("12345678"));
          // node emits 'ping' only for peer-initiated pings, never for the ACK of our
          // own ping (verified against node v26.3.0) - the ack already resolved above,
          // so the absence here is settled, not racy.
          expect(received_ping).toBeUndefined();
        });
        it("ping without events should work", async () => {
          const { promise, resolve, reject } = Promise.withResolvers();
          const client = http2.connect(HTTPS_SERVER, TLS_OPTIONS);
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
          // See above: no 'ping' event for ACKs of our own pings (node parity).
          expect(received_ping).toBeUndefined();
        });
        it("ping with wrong payload length events should error", async () => {
          // Node v26.3.0: ping() throws ERR_HTTP2_PING_LENGTH synchronously for a non-8-byte
          // payload (lib/internal/http2/core.js:1462) — it never reaches the callback.
          const { promise, resolve, reject } = Promise.withResolvers();
          const client = http2.connect(HTTPS_SERVER, TLS_OPTIONS);
          client.on("error", reject);
          client.on("connect", () => {
            try {
              client.ping(Buffer.from("oops"), () => reject("unreachable"));
              reject("did not throw");
            } catch (err) {
              resolve(err);
            }
            client.close();
          });
          const result = await promise;
          expect(result).toBeDefined();
          expect(result.code).toBe("ERR_HTTP2_PING_LENGTH");
        });
        it("ping with wrong payload type events should throw", async () => {
          const { promise, resolve, reject } = Promise.withResolvers();
          const client = http2.connect(HTTPS_SERVER, TLS_OPTIONS);
          client.on("error", reject);
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
          // node: a client session emits 'stream' only for peer-initiated (push) streams,
          // never for its own requests (verified on node v26.3.0). Assert the request
          // stream directly and that no spurious session 'stream' event fires.
          const { promise, resolve, reject } = Promise.withResolvers();
          const client = http2.connect(HTTPS_SERVER, TLS_OPTIONS);
          client.on("error", reject);
          let sessionStreamEvents = 0;
          client.on("stream", () => {
            sessionStreamEvents++;
          });
          const req = client.request({ ":path": "/" });
          req.on("error", reject);
          req.on("response", () => {
            resolve(req);
            client.close();
          });
          req.resume();
          req.end();
          const stream = await promise;
          expect(stream).toBeDefined();
          expect(stream.id).toBe(1);
          expect(sessionStreamEvents).toBe(0);
        });

        it("wantTrailers should work", async () => {
          const { promise, resolve, reject } = Promise.withResolvers();
          const client = http2.connect(HTTPS_SERVER, TLS_OPTIONS);
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
        });

        it.skipIf(!isCI)(
          "should not leak memory",
          async () => {
            // Use a dedicated server: this test floods it with requests for ~100s
            // and would contend with other concurrent tests sharing the same server.
            await using server = await nodeEchoServer(paddingStrategy);
            await using proc = Bun.spawn({
              cmd: [bunExe(), "--smol", "run", path.join(import.meta.dir, "node-http2-memory-leak.js")],
              env: {
                ...bunEnv,
                BUN_JSC_forceRAMSize: (1024 * 1024 * 64).toString("10"),
                HTTP2_SERVER_INFO: JSON.stringify(server),
                HTTP2_SERVER_TLS: JSON.stringify(TLS_OPTIONS),
              },
              stderr: "inherit",
              stdin: "inherit",
              stdout: "inherit",
            });
            const exitCode = await proc.exited;
            expect(exitCode || 0).toBe(0);
          },
          100000,
        );

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
              req.on("error", err => {
                if (err.errno !== http2.constants.NGHTTP2_CONNECT_ERROR) {
                  reject(err);
                }
              });
              req.end();
            });
            const result = await promise;
            expect(result).toBeDefined();
            const [code, lastStreamID, opaqueData] = result;
            expect(code).toBe(http2.constants.NGHTTP2_CONNECT_ERROR);
            expect(lastStreamID).toBe(1);
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
              req.on("error", err => {
                if (err.errno !== http2.constants.NGHTTP2_CONNECT_ERROR) {
                  reject(err);
                }
              });
              req.end();
            });
            const result = await promise;
            expect(result).toBeDefined();
            const [code, lastStreamID, opaqueData] = result;
            expect(code).toBe(http2.constants.NGHTTP2_CONNECT_ERROR);
            expect(lastStreamID).toBe(1);
            expect(opaqueData.toString()).toBe("");
          } finally {
            server.subprocess.kill();
          }
        });
        it("should not be able to write on socket", async () => {
          const { promise, resolve, reject } = Promise.withResolvers();
          const client = http2.connect(HTTPS_SERVER, TLS_OPTIONS, (session, socket) => {
            try {
              client.socket.write("hello");
              client.socket.end();
              reject(new Error("unreachable"));
            } catch (err) {
              try {
                expect(err.code).toBe("ERR_HTTP2_NO_SOCKET_MANIPULATION");
                resolve();
              } catch (err2) {
                reject(err2);
              }
            }
          });
          await promise;
        });
        it("should handle bad GOAWAY server frame size", async () => {
          const { promise: serverListening, resolve: serverResolve } = Promise.withResolvers();
          const server = net.createServer(socket => {
            const settings = new http2utils.SettingsFrame(true);
            socket.write(settings.data);
            const frame = new http2utils.Frame(7, 7, 0, 0).data;
            socket.write(Buffer.concat([frame, Buffer.alloc(7)]));
          });
          server.listen(0, "127.0.0.1", () => serverResolve());
          await serverListening;

          const url = `http://127.0.0.1:${server.address().port}`;
          try {
            const { promise, resolve } = Promise.withResolvers();
            const client = http2.connect(url);
            client.on("error", resolve);
            client.on("connect", () => {
              const req = client.request({ ":path": "/" });
              req.on("error", () => {});
              req.end();
            });
            const result = await promise;
            expect(result).toBeDefined();
            expect(result.code).toBe("ERR_HTTP2_ERROR");
            // node: a violation nghttp2 detects locally surfaces as NghttpError ("Protocol error"),
            // not as ERR_HTTP2_SESSION_ERROR (that one is reserved for a GOAWAY received from the peer).
            expect(result.message).toBe("Protocol error");
          } finally {
            server.close();
          }
        });
        it("client tolerates a late RST_STREAM for a stream it already closed and evicted", async () => {
          // RFC 9113 §5.1 (nghttp2 session_detect_idle_stream): a stream this client started and
          // closed is closed, not idle, even once its state is evicted — a late peer RST_STREAM
          // for it must be ignored, never answered with GOAWAY(PROTOCOL_ERROR).
          const { promise: rawSocket, resolve: onRawSocket } = Promise.withResolvers();
          const server = net.createServer(socket => {
            socket.on("error", () => {});
            socket.on("data", () => {});
            // Server preface: our (empty) SETTINGS plus an ACK of the client's.
            socket.write(new http2utils.SettingsFrame(false).data);
            socket.write(new http2utils.SettingsFrame(true).data);
            onRawSocket(socket);
          });
          await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
          const rstFrame = (id, code) => {
            const payload = Buffer.alloc(4);
            payload.writeUInt32BE(code, 0);
            return Buffer.concat([new http2utils.Frame(4, 3, 0, id).data, payload]);
          };
          try {
            const client = http2.connect(`http://127.0.0.1:${server.address().port}`);
            const sessionErrors = [];
            client.on("error", err => sessionErrors.push(err));
            const req = client.request({ ":path": "/" });
            req.on("error", () => {});
            const closed = new Promise(resolve => req.on("close", resolve));
            const socket = await rawSocket;
            // Close the client's only stream, then wait until the client has fully processed it.
            socket.write(rstFrame(1, http2.constants.NGHTTP2_CANCEL));
            await closed;
            // Late frame for the evicted stream, then a PING the session must still answer.
            const pinged = new Promise((resolve, reject) => {
              client.once("ping", resolve);
              client.once("error", reject);
              client.once("close", () => reject(new Error("session closed before the ping arrived")));
            });
            socket.write(rstFrame(1, http2.constants.NGHTTP2_NO_ERROR));
            socket.write(Buffer.concat([new http2utils.Frame(8, 6, 0, 0).data, Buffer.alloc(8, 7)]));
            await pinged;
            expect(sessionErrors).toEqual([]);
            expect(client.destroyed).toBe(false);
            client.destroy();
          } finally {
            server.close();
          }
        });
        it("should handle bad DATA_FRAME server frame size", async () => {
          const { promise: waitToWrite, resolve: allowWrite } = Promise.withResolvers();
          const { promise: serverListening, resolve: serverResolve } = Promise.withResolvers();
          const server = net.createServer(async socket => {
            const settings = new http2utils.SettingsFrame(true);
            socket.write(settings.data);
            await waitToWrite;
            const frame = new http2utils.DataFrame(1, Buffer.alloc(16384 * 2), 0, 1).data;
            socket.write(frame);
          });
          server.listen(0, "127.0.0.1", () => serverResolve());
          await serverListening;

          const url = `http://127.0.0.1:${server.address().port}`;
          try {
            const { promise, resolve } = Promise.withResolvers();
            const client = http2.connect(url);
            client.on("error", resolve);
            client.on("connect", () => {
              const req = client.request({ ":path": "/" });
              req.on("error", () => {});
              req.end();
              allowWrite();
            });
            const result = await promise;
            expect(result).toBeDefined();
            expect(result.code).toBe("ERR_HTTP2_ERROR");
            // node: a violation nghttp2 detects locally surfaces as NghttpError ("Protocol error"),
            // not as ERR_HTTP2_SESSION_ERROR (that one is reserved for a GOAWAY received from the peer).
            expect(result.message).toBe("Protocol error");
          } finally {
            server.close();
          }
        });
        it("should handle bad RST_FRAME server frame size (no stream)", async () => {
          const { promise: waitToWrite, resolve: allowWrite } = Promise.withResolvers();
          const { promise: serverListening, resolve: serverResolve } = Promise.withResolvers();
          const server = net.createServer(async socket => {
            const settings = new http2utils.SettingsFrame(true);
            socket.write(settings.data);
            await waitToWrite;
            const frame = new http2utils.Frame(4, 3, 0, 0).data;
            socket.write(Buffer.concat([frame, Buffer.alloc(4)]));
          });
          server.listen(0, "127.0.0.1", () => serverResolve());
          await serverListening;

          const url = `http://127.0.0.1:${server.address().port}`;
          try {
            const { promise, resolve } = Promise.withResolvers();
            const client = http2.connect(url);
            client.on("error", resolve);
            client.on("connect", () => {
              const req = client.request({ ":path": "/" });
              req.on("error", () => {});
              req.end();
              allowWrite();
            });
            const result = await promise;
            expect(result).toBeDefined();
            expect(result.code).toBe("ERR_HTTP2_ERROR");
            // node: a violation nghttp2 detects locally surfaces as NghttpError ("Protocol error"),
            // not as ERR_HTTP2_SESSION_ERROR (that one is reserved for a GOAWAY received from the peer).
            expect(result.message).toBe("Protocol error");
          } finally {
            server.close();
          }
        });
        it("should handle bad RST_FRAME server frame size (less than allowed)", async () => {
          const { promise: waitToWrite, resolve: allowWrite } = Promise.withResolvers();
          const { promise: serverListening, resolve: serverResolve } = Promise.withResolvers();
          const server = net.createServer(async socket => {
            const settings = new http2utils.SettingsFrame(true);
            socket.write(settings.data);
            await waitToWrite;
            const frame = new http2utils.Frame(3, 3, 0, 1).data;
            socket.write(Buffer.concat([frame, Buffer.alloc(3)]));
          });
          server.listen(0, "127.0.0.1", () => serverResolve());
          await serverListening;

          const url = `http://127.0.0.1:${server.address().port}`;
          try {
            const { promise, resolve } = Promise.withResolvers();
            const client = http2.connect(url);
            client.on("error", resolve);
            client.on("connect", () => {
              const req = client.request({ ":path": "/" });
              req.on("error", () => {});
              req.end();
              allowWrite();
            });
            const result = await promise;
            expect(result).toBeDefined();
            expect(result.code).toBe("ERR_HTTP2_ERROR");
            // node: a violation nghttp2 detects locally surfaces as NghttpError ("Protocol error"),
            // not as ERR_HTTP2_SESSION_ERROR (that one is reserved for a GOAWAY received from the peer).
            expect(result.message).toBe("Protocol error");
          } finally {
            server.close();
          }
        });
        it("should handle bad RST_FRAME server frame size (more than allowed)", async () => {
          const { promise: waitToWrite, resolve: allowWrite } = Promise.withResolvers();
          const { promise: serverListening, resolve: serverResolve } = Promise.withResolvers();
          const server = net.createServer(async socket => {
            const settings = new http2utils.SettingsFrame(true);
            socket.write(settings.data);
            await waitToWrite;
            const buffer = Buffer.alloc(16384 * 2);
            const frame = new http2utils.Frame(buffer.byteLength, 3, 0, 1).data;
            socket.write(Buffer.concat([frame, buffer]));
          });
          server.listen(0, "127.0.0.1", () => serverResolve());
          await serverListening;

          const url = `http://127.0.0.1:${server.address().port}`;
          try {
            const { promise, resolve } = Promise.withResolvers();
            const client = http2.connect(url);
            client.on("error", resolve);
            client.on("connect", () => {
              const req = client.request({ ":path": "/" });
              req.on("error", () => {});
              req.end();
              allowWrite();
            });
            const result = await promise;
            expect(result).toBeDefined();
            expect(result.code).toBe("ERR_HTTP2_ERROR");
            // node: a violation nghttp2 detects locally surfaces as NghttpError ("Protocol error"),
            // not as ERR_HTTP2_SESSION_ERROR (that one is reserved for a GOAWAY received from the peer).
            expect(result.message).toBe("Protocol error");
          } finally {
            server.close();
          }
        });

        it("should handle bad CONTINUATION_FRAME server frame size", async () => {
          const { promise: waitToWrite, resolve: allowWrite } = Promise.withResolvers();
          const { promise: serverListening, resolve: serverResolve } = Promise.withResolvers();
          const server = net.createServer(async socket => {
            const settings = new http2utils.SettingsFrame(true);
            socket.write(settings.data);
            await waitToWrite;

            const frame = new http2utils.HeadersFrame(1, http2utils.kFakeResponseHeaders, 0, true, false);
            socket.write(frame.data);
            const continuationFrame = new http2utils.ContinuationFrame(
              1,
              http2utils.kFakeResponseHeaders,
              0,
              true,
              false,
            );
            socket.write(continuationFrame.data);
          });
          server.listen(0, "127.0.0.1", () => serverResolve());
          await serverListening;

          const url = `http://127.0.0.1:${server.address().port}`;
          try {
            const { promise, resolve } = Promise.withResolvers();
            const client = http2.connect(url);
            client.on("error", resolve);
            client.on("connect", () => {
              const req = client.request({ ":path": "/" });
              req.on("error", () => {});
              req.end();
              allowWrite();
            });
            const result = await promise;
            expect(result).toBeDefined();
            expect(result.code).toBe("ERR_HTTP2_ERROR");
            // node: a violation nghttp2 detects locally surfaces as NghttpError ("Protocol error"),
            // not as ERR_HTTP2_SESSION_ERROR (that one is reserved for a GOAWAY received from the peer).
            expect(result.message).toBe("Protocol error");
          } finally {
            server.close();
          }
        });

        it("reassembles a header block split mid-instruction across HEADERS + CONTINUATION", async () => {
          const { promise: waitToWrite, resolve: allowWrite } = Promise.withResolvers();
          const { promise: serverListening, resolve: serverResolve } = Promise.withResolvers();
          const block = http2utils.kFakeResponseHeaders;
          const server = net.createServer(async socket => {
            socket.on("error", () => {});
            const settings = new http2utils.SettingsFrame(true);
            socket.write(settings.data);
            await waitToWrite;

            // Split the HPACK block 2 bytes into the cache-control literal so
            // neither fragment is independently decodable.
            const headersFrame = new http2utils.HeadersFrame(1, block.subarray(0, 7), 0, /* EOH */ false, false);
            socket.write(headersFrame.data);
            const continuationFrame = new http2utils.ContinuationFrame(1, block.subarray(7), 0, false);
            socket.write(continuationFrame.data);
          });
          server.listen(0, "127.0.0.1", () => serverResolve());
          await serverListening;

          const url = `http://127.0.0.1:${server.address().port}`;
          const client = http2.connect(url);
          try {
            const { promise, resolve, reject } = Promise.withResolvers();
            client.on("error", reject);
            let sawTrailers = false;
            client.on("connect", () => {
              const req = client.request({ ":path": "/" });
              req.on("error", reject);
              req.on("trailers", () => {
                sawTrailers = true;
              });
              req.on("response", headers => {
                queueMicrotask(() => resolve(headers));
              });
              req.end();
              allowWrite();
            });
            const headers = await promise;
            expect(headers[":status"]).toBe(302);
            expect(headers["cache-control"]).toBe("private");
            expect(headers["date"]).toBe("Mon, 21 Oct 2013 20:13:21 GMT");
            expect(headers["location"]).toBe("https://www.example.com");
            expect(sawTrailers).toBe(false);
          } finally {
            client.destroy();
            server.close();
          }
        });

        it("treats an HPACK decode error in a complete header block as COMPRESSION_ERROR", async () => {
          const { promise: waitToWrite, resolve: allowWrite } = Promise.withResolvers();
          const { promise: serverListening, resolve: serverResolve } = Promise.withResolvers();
          const block = http2utils.kFakeResponseHeaders;
          const server = net.createServer(async socket => {
            socket.on("error", () => {});
            const settings = new http2utils.SettingsFrame(true);
            socket.write(settings.data);
            await waitToWrite;

            // END_HEADERS is set, so this truncated block is "complete" and
            // must fail HPACK decoding as a connection error.
            const headersFrame = new http2utils.HeadersFrame(1, block.subarray(0, 7), 0, /* EOH */ true, false);
            socket.write(headersFrame.data);
          });
          server.listen(0, "127.0.0.1", () => serverResolve());
          await serverListening;

          const url = `http://127.0.0.1:${server.address().port}`;
          try {
            const { promise, resolve } = Promise.withResolvers();
            const client = http2.connect(url);
            client.on("error", resolve);
            client.on("connect", () => {
              const req = client.request({ ":path": "/" });
              req.on("error", () => {});
              req.on("response", headers => resolve({ response: headers }));
              req.end();
              allowWrite();
            });
            const result = await promise;
            expect(result).toBeDefined();
            expect(result.code).toBe("ERR_HTTP2_ERROR");
            // node: a violation nghttp2 detects locally surfaces as NghttpError ("Protocol error"),
            // not as ERR_HTTP2_SESSION_ERROR (that one is reserved for a GOAWAY received from the peer).
            expect(result.message).toBe("Protocol error");
          } finally {
            server.close();
          }
        });

        it("rejects a non-CONTINUATION frame while a header block is being reassembled", async () => {
          const { promise: waitToWrite, resolve: allowWrite } = Promise.withResolvers();
          const { promise: serverListening, resolve: serverResolve } = Promise.withResolvers();
          const block = http2utils.kFakeResponseHeaders;
          const server = net.createServer(async socket => {
            socket.on("error", () => {});
            const settings = new http2utils.SettingsFrame(true);
            socket.write(settings.data);
            await waitToWrite;

            // RFC 9113 4.3: only CONTINUATION frames for the same stream may
            // follow a HEADERS frame without END_HEADERS.
            const headersFrame = new http2utils.HeadersFrame(1, block.subarray(0, 7), 0, /* EOH */ false, false);
            socket.write(headersFrame.data);
            socket.write(new http2utils.PingFrame(false).data);
          });
          server.listen(0, "127.0.0.1", () => serverResolve());
          await serverListening;

          const url = `http://127.0.0.1:${server.address().port}`;
          try {
            const { promise, resolve } = Promise.withResolvers();
            const client = http2.connect(url);
            client.on("error", resolve);
            // If the interleaved PING is accepted the session pings back and no
            // error ever fires; surface that as a failure instead of hanging.
            client.on("ping", () => resolve({ ping: true }));
            client.on("connect", () => {
              const req = client.request({ ":path": "/" });
              req.on("error", () => {});
              req.on("response", headers => resolve({ response: headers }));
              req.end();
              allowWrite();
            });
            const result = await promise;
            expect(result).toBeDefined();
            expect(result.code).toBe("ERR_HTTP2_ERROR");
            // node: a violation nghttp2 detects locally surfaces as NghttpError ("Protocol error"),
            // not as ERR_HTTP2_SESSION_ERROR (that one is reserved for a GOAWAY received from the peer).
            expect(result.message).toBe("Protocol error");
          } finally {
            server.close();
          }
        });

        it("rejects a header block whose compressed size exceeds maxHeaderListSize", async () => {
          const { promise: waitToWrite, resolve: allowWrite } = Promise.withResolvers();
          const { promise: serverListening, resolve: serverResolve } = Promise.withResolvers();
          const server = net.createServer(async socket => {
            socket.on("error", () => {});
            const settings = new http2utils.SettingsFrame(true);
            socket.write(settings.data);
            await waitToWrite;

            // 5 x 16384 = 81920 compressed bytes > the default 65535
            // maxHeaderListSize; the connection must be torn down before the
            // block is ever decoded.
            const chunk = Buffer.alloc(16384, 0x41);
            socket.write(Buffer.concat([new http2utils.HeadersFrame(1, chunk, 0, /* EOH */ false, false).data]));
            for (let i = 0; i < 4; i++) {
              // raw CONTINUATION frame without END_HEADERS
              socket.write(Buffer.concat([new http2utils.Frame(chunk.byteLength, 9, 0, 1).data, chunk]));
            }
          });
          server.listen(0, "127.0.0.1", () => serverResolve());
          await serverListening;

          const url = `http://127.0.0.1:${server.address().port}`;
          try {
            const { promise, resolve } = Promise.withResolvers();
            const client = http2.connect(url);
            client.on("error", resolve);
            client.on("connect", () => {
              const req = client.request({ ":path": "/" });
              req.on("error", () => {});
              req.on("response", headers => resolve({ response: headers }));
              req.end();
              allowWrite();
            });
            const result = await promise;
            expect(result).toBeDefined();
            expect(result.code).toBe("ERR_HTTP2_ERROR");
            // node: a violation nghttp2 detects locally surfaces as NghttpError ("Protocol error"),
            // not as ERR_HTTP2_SESSION_ERROR (that one is reserved for a GOAWAY received from the peer).
            expect(result.message).toBe("Protocol error");
          } finally {
            server.close();
          }
        });

        it("should handle bad PRIOTITY_FRAME server frame size", async () => {
          const { promise: waitToWrite, resolve: allowWrite } = Promise.withResolvers();
          const { promise: serverListening, resolve: serverResolve } = Promise.withResolvers();
          const server = net.createServer(async socket => {
            const settings = new http2utils.SettingsFrame(true);
            socket.write(settings.data);
            await waitToWrite;

            const frame = new http2utils.Frame(4, 2, 0, 1).data;
            socket.write(Buffer.concat([frame, Buffer.alloc(4)]));
          });
          server.listen(0, "127.0.0.1", () => serverResolve());
          await serverListening;

          const url = `http://127.0.0.1:${server.address().port}`;
          try {
            const { promise, resolve } = Promise.withResolvers();
            const client = http2.connect(url);
            client.on("error", resolve);
            client.on("connect", () => {
              const req = client.request({ ":path": "/" });
              req.on("error", () => {});
              req.end();
              allowWrite();
            });
            const result = await promise;
            expect(result).toBeDefined();
            expect(result.code).toBe("ERR_HTTP2_ERROR");
            // node: a violation nghttp2 detects locally surfaces as NghttpError ("Protocol error"),
            // not as ERR_HTTP2_SESSION_ERROR (that one is reserved for a GOAWAY received from the peer).
            expect(result.message).toBe("Protocol error");
          } finally {
            server.close();
          }
        });
      });
    });
  }
}

// A stream's events run in the async context captured when request() was called (Node's
// Http2Stream is an async resource), even when that context is empty and the session's
// own socket callbacks carry the connect-time store.
it("client stream events observe the request-time async context, not the session's", async () => {
  const als = new AsyncLocalStorage();
  const server = http2.createServer();
  let client;
  try {
    server.on("stream", stream => {
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });
    await new Promise(resolve => server.listen(0, resolve));
    const { promise: connected, resolve: onConnect, reject } = Promise.withResolvers();
    client = als.run({ id: "connect" }, () => http2.connect(`http://localhost:${server.address().port}`));
    client.on("error", reject);
    client.on("connect", onConnect);
    await connected;
    // The await above resumed the test's own (empty) async context: this request
    // captures an empty snapshot while the socket's callbacks carry { id: "connect" }.
    const stores = [];
    const { promise: closed, resolve: onClose, reject: onStreamError } = Promise.withResolvers();
    const req = client.request({ ":path": "/" });
    req.on("response", () => stores.push(als.getStore()));
    req.on("data", () => stores.push(als.getStore()));
    req.on("end", () => stores.push(als.getStore()));
    req.on("close", onClose);
    req.on("error", onStreamError);
    req.end();
    await closed;
    expect(stores.length).toBeGreaterThanOrEqual(3);
    expect(stores).toEqual(new Array(stores.length).fill(undefined));
  } finally {
    client?.close?.();
    server.close();
  }
});

// Like Node, session.destroy(err) tears open streams down synchronously from the caller's
// stack: their 'error'/'close' run in the destroy() caller's async context (not the
// request()-time one), while the session's own 'error'/'close' keep the connect-time context.
it("client session.destroy() emits open streams' error/close in the caller's async context", async () => {
  const als = new AsyncLocalStorage();
  const CONNECT = { id: "connect" };
  const REQUEST = { id: "request" };
  const DESTROY = { id: "destroy" };
  const server = http2.createServer();
  let client;
  try {
    const { promise: streamsOpened, resolve: onStreamsOpened } = Promise.withResolvers();
    let openStreams = 0;
    server.on("stream", stream => {
      stream.on("error", () => {});
      if (++openStreams === 2) onStreamsOpened();
    });
    await new Promise(resolve => server.listen(0, resolve));
    const { promise: connected, resolve: onConnect } = Promise.withResolvers();
    client = als.run(CONNECT, () => http2.connect(`http://localhost:${server.address().port}`));
    client.on("connect", onConnect);
    const sessionEvents = { error: null, close: null };
    const { promise: sessionClosed, resolve: onSessionClose } = Promise.withResolvers();
    client.on("error", () => (sessionEvents.error = als.getStore()));
    client.on("close", () => {
      sessionEvents.close = als.getStore();
      onSessionClose();
    });
    await connected;
    const streamEvents = [];
    als.run(REQUEST, () => {
      for (let i = 0; i < 2; i++) {
        const req = client.request({ ":path": `/${i}` });
        req.on("error", () => streamEvents.push({ i, event: "error", store: als.getStore() }));
        req.on("close", () => streamEvents.push({ i, event: "close", store: als.getStore() }));
      }
    });
    await streamsOpened;
    als.run(DESTROY, () => client.destroy(new Error("boom")));
    await sessionClosed;
    // Emission order across the two streams is not the contract; the context each ran in is.
    streamEvents.sort((a, b) => a.i - b.i || a.event.localeCompare(b.event));
    expect(streamEvents).toEqual([
      { i: 0, event: "close", store: DESTROY },
      { i: 0, event: "error", store: DESTROY },
      { i: 1, event: "close", store: DESTROY },
      { i: 1, event: "error", store: DESTROY },
    ]);
    expect(sessionEvents).toEqual({ error: CONNECT, close: CONNECT });
  } finally {
    client?.destroy?.();
    server.close();
  }
});

it("sensitive headers should work", async () => {
  const server = http2.createServer();
  let client;
  try {
    const { promise, resolve, reject } = Promise.withResolvers();
    server.on("stream", stream => {
      stream.respond({
        ":status": 200,
        "content-type": "application/json",
        "x-custom-header": "some-value",

        [http2.sensitiveHeaders]: ["x-custom-header"],
      });

      stream.end(JSON.stringify({ message: "Hello from h2c server!" }));
    });

    server.listen(0, () => {
      const port = server.address().port;
      client = http2.connect(`http://localhost:${port}`);

      client.on("error", reject);

      const req = client.request({ ":path": "/" });
      req.on("response", resolve);
      req.on("error", reject);
      req.end();
    });
    const res = await promise;

    expect(res["x-custom-header"]).toBe("some-value");
    expect(res[http2.sensitiveHeaders]).toEqual(["x-custom-header"]);
  } finally {
    server.close();
    client?.close?.();
  }
});

it("http2 session.goaway() validates input types", async done => {
  const { mustCall } = createCallCheckCtx(done);
  const server = http2.createServer((req, res) => {
    res.end();
  });
  const types = [true, {}, [], null, new Date()];
  return await new Promise(resolve => {
    server.on(
      "stream",
      mustCall(stream => {
        const session = stream.session;

        for (const input of types) {
          const received = invalidArgTypeHelper(input);

          // Test code argument
          expect(() => session.goaway(input)).toThrow('The "code" argument must be of type number.' + received);

          // Test lastStreamID argument
          expect(() => session.goaway(0, input)).toThrow(
            'The "lastStreamID" argument must be of type number.' + received,
          );

          // Test opaqueData argument
          expect(() => session.goaway(0, 0, input)).toThrow(
            'The "opaqueData" argument must be an instance of Buffer, ' + `TypedArray, or DataView.${received}`,
          );
        }

        server.close();
        resolve();
      }),
    );

    server.listen(0, () => {
      const port = server.address().port;
      const client = http2.connect(`http://localhost:${port}`);
      const req = client.request();

      req.resume();
      req.end();
    });
  });
});

it("http2 stream.close() validates input types and ranges", async () => {
  const server = http2.createServer();

  return await new Promise(resolve => {
    server.on("stream", stream => {
      // Test string input
      expect(() => stream.close("string")).toThrow(
        'The "code" argument must be of type number. ' + "Received type string ('string')",
      );

      // Test non-integer number
      expect(() => stream.close(1.01)).toThrow(
        'The value of "code" is out of range. It must be an integer. ' + "Received 1.01",
      );

      // Test out of range values
      [-1, 2 ** 32].forEach(code => {
        expect(() => stream.close(code)).toThrow(
          `The value of "code" is out of range. It must be >= 0 && <= 4294967295. Received ${code}`,
        );
      });

      // Complete the stream
      stream.respond();
      stream.end("ok");
    });

    server.listen(0, () => {
      const port = server.address().port;
      const client = http2.connect(`http://localhost:${port}`);
      const req = client.request();

      req.resume();
      req.on("close", () => {
        server.close();
        client.close();
        resolve();
      });
    });
  });
});

it("http2 session.goaway() sends custom data", async done => {
  const { mustCall } = createCallCheckCtx(done);

  const data = Buffer.from([0x1, 0x2, 0x3, 0x4, 0x5]);

  let session;

  const server = http2.createServer();

  return await new Promise(resolve => {
    server.on("stream", stream => {
      session = stream.session;
      session.on("close", () => {});

      // Send GOAWAY frame with custom data
      session.goaway(0, 0, data);

      // Complete the stream
      stream.respond();
      stream.end();
    });

    server.on("close", mustCall());

    server.listen(0, () => {
      const port = server.address().port;
      const client = http2.connect(`http://localhost:${port}`);

      client.once("goaway", (code, lastStreamID, buf) => {
        // Verify the GOAWAY frame parameters
        expect(code).toBe(0);
        expect(lastStreamID).toBe(1);
        expect(buf).toEqual(data);

        // Clean up
        session.close();
        server.close();
        resolve();
      });

      const req = client.request();
      req.resume();
      req.on("end", mustCall());
      req.on("close", mustCall());
      req.end();
    });
  });
});

it("http2 server sends protocol-error GOAWAY on stream 0", async () => {
  // RFC 9113 section 6.8: GOAWAY frames MUST be sent with a stream identifier
  // of 0 in the frame header; the last processed stream id lives in the
  // payload. Trigger a connection-level protocol violation (a PING addressed
  // to stream 1) from a raw socket and inspect the GOAWAY frame the server
  // writes back.
  const server = http2.createServer();
  server.on("error", () => {});
  server.on("session", session => session.on("error", () => {}));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

  try {
    const chunks = [];
    const { promise: closed, resolve: onClose } = Promise.withResolvers();
    const socket = net.connect(server.address().port, "127.0.0.1", () => {
      socket.write(http2utils.kClientMagic);
      socket.write(new http2utils.SettingsFrame().data);
      // PING frame (type 0x6) addressed to stream 1 is a connection error.
      socket.write(Buffer.concat([new http2utils.Frame(8, 0x6, 0, 1).data, Buffer.alloc(8)]));
    });
    socket.on("error", () => {});
    socket.on("data", chunk => chunks.push(chunk));
    socket.on("close", onClose);
    await closed;

    const data = Buffer.concat(chunks);
    let offset = 0;
    let goaway = null;
    while (offset + 9 <= data.length) {
      const length = data.readUIntBE(offset, 3);
      const type = data.readUInt8(offset + 3);
      if (type === 0x07) {
        goaway = data.subarray(offset, offset + 9 + length);
        break;
      }
      offset += 9 + length;
    }

    expect(goaway).not.toBeNull();
    // Frame header stream identifier must be 0 (the connection stream).
    expect(goaway.readUInt32BE(5) & 0x7fffffff).toBe(0);
    // Payload: last-stream-id (no stream was ever opened) followed by the
    // error code, which must still be PROTOCOL_ERROR.
    expect(goaway.readUInt32BE(9) & 0x7fffffff).toBe(0);
    expect(goaway.readUInt32BE(13)).toBe(http2.constants.NGHTTP2_PROTOCOL_ERROR);
  } finally {
    server.close();
  }
});

it("http2 client receives 'goaway' when the server rejects a stream", async () => {
  // When the server rejects a stream and gives up on the session, the GOAWAY
  // it sends must be readable by a conforming client: the client should emit
  // 'goaway' with the server's error code instead of treating the frame
  // itself as a protocol error.
  const server = http2.createServer({ maxSessionRejectedStreams: 0, settings: { maxHeaderListSize: 100 } });
  server.on("error", () => {});
  server.on("session", session => session.on("error", () => {}));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

  try {
    const { promise: goawayReceived, resolve: onGoaway } = Promise.withResolvers();
    const { promise: clientClosed, resolve: onClientClose } = Promise.withResolvers();
    const client = http2.connect(`http://127.0.0.1:${server.address().port}`);
    let sessionError = null;
    client.on("error", err => {
      sessionError = err;
    });
    client.on("close", onClientClose);
    client.on("goaway", (code, lastStreamID, opaqueData) => {
      onGoaway({ code, lastStreamID, opaqueData });
    });

    // The header block exceeds the server's maxHeaderListSize, so the server
    // rejects the stream; with maxSessionRejectedStreams: 0 it answers with a
    // GOAWAY carrying NGHTTP2_ENHANCE_YOUR_CALM.
    const req = client.request({ ":path": "/", "x-filler": Buffer.alloc(256, "a").toString() });
    req.on("error", () => {});
    req.end();

    const { code } = await goawayReceived;
    expect(code).toBe(http2.constants.NGHTTP2_ENHANCE_YOUR_CALM);

    await clientClosed;
    // Like Node, a non-NO_ERROR GOAWAY destroys the session with
    // ERR_HTTP2_SESSION_ERROR (verified against Node 26: a server-sent
    // ENHANCE_YOUR_CALM goaway yields exactly this error on the client).
    expect(sessionError?.code).toBe("ERR_HTTP2_SESSION_ERROR");
    expect(sessionError?.message).toBe("Session closed with error code 11");
  } finally {
    server.close();
  }
});

it(
  "http2 server with minimal maxSessionMemory handles multiple requests",
  async () => {
    const server = http2.createServer({ maxSessionMemory: 1 });

    return await new Promise(resolve => {
      server.on("session", session => {
        session.on("stream", stream => {
          stream.on("end", function () {
            this.respond(
              {
                ":status": 200,
              },
              {
                endStream: true,
              },
            );
          });
          stream.resume();
        });
      });

      server.listen(0, () => {
        const port = server.address().port;
        const client = http2.connect(`http://localhost:${port}`);

        function next(i) {
          if (i === 10000) {
            client.close();
            server.close();
            resolve();
            return;
          }

          const stream = client.request({ ":method": "POST" });

          stream.on("response", function (headers) {
            expect(headers[":status"]).toBe(200);

            this.on("close", () => next(i + 1));
          });

          stream.end();
        }

        // Start the sequence with the first request
        next(0);
      });
    });
  },
  15_000 * ASAN_MULTIPLIER,
);

it("http2.createServer validates input options", () => {
  // Test invalid options passed to createServer
  const invalidOptions = [1, true, "test", null, Symbol("test")];

  invalidOptions.forEach(invalidOption => {
    expect(() => http2.createServer(invalidOption)).toThrow(
      'The "options" argument must be of type object.' + invalidArgTypeHelper(invalidOption),
    );
  });

  // Test invalid options.settings passed to createServer
  invalidOptions.forEach(invalidSettingsOption => {
    expect(() => http2.createServer({ settings: invalidSettingsOption })).toThrow(
      'The "options.settings" property must be of type object.' + invalidArgTypeHelper(invalidSettingsOption),
    );
  });

  // Test that http2.createServer validates numeric range options
  const rangeTests = {
    maxSessionInvalidFrames: [
      {
        val: -1,
        err: {
          name: "RangeError",
          code: "ERR_OUT_OF_RANGE",
        },
      },
      {
        val: Number.NEGATIVE_INFINITY,
        err: {
          name: "RangeError",
          code: "ERR_OUT_OF_RANGE",
        },
      },
    ],
    maxSessionRejectedStreams: [
      {
        val: -1,
        err: {
          name: "RangeError",
          code: "ERR_OUT_OF_RANGE",
        },
      },
      {
        val: Number.NEGATIVE_INFINITY,
        err: {
          name: "RangeError",
          code: "ERR_OUT_OF_RANGE",
        },
      },
    ],
  };

  Object.entries(rangeTests).forEach(([opt, tests]) => {
    tests.forEach(({ val, err }) => {
      expect(() => http2.createServer({ [opt]: val })).toThrow();

      // Note: Bun's expect doesn't have the same detailed error matching as Node's assert,
      // so we're just checking that it throws an error with the expected name
      let error;
      try {
        http2.createServer({ [opt]: val });
      } catch (e) {
        error = e;
      }

      expect(error).toBeTruthy();
      expect(error?.name).toBe(err.name);
      expect(error?.code).toBe(err.code);
    });
  });
});

it("http2 server handles multiple concurrent requests", async () => {
  const body = "<html><head></head><body><h1>this is some data</h2></body></html>";
  const server = http2.createServer();
  const count = 100;

  // Stream handler
  function onStream(stream, headers, flags) {
    expect(headers[":scheme"]).toBe("http");
    expect(headers[":authority"]).toBeTruthy();
    expect(headers[":method"]).toBe("GET");
    expect(flags).toBe(5);

    stream.respond({
      "content-type": "text/html",
      ":status": 200,
    });

    stream.write(body.slice(0, 20));
    stream.end(body.slice(20));
  }

  // Register stream handler
  server.on("stream", (stream, headers, flags) => onStream(stream, headers, flags));

  return await new Promise(resolve => {
    server.on("close", () => {
      resolve();
    });

    server.listen(0);

    server.on("listening", () => {
      const port = server.address().port;
      const client = http2.connect(`http://localhost:${port}`);

      client.setMaxListeners(101);
      client.on("goaway", console.log);

      client.on("connect", () => {
        expect(client.encrypted).toBeFalsy();
        expect(client.originSet).toBeFalsy();
        expect(client.alpnProtocol).toBe("h2c");
      });

      let countdown = count;
      function countDown() {
        countdown--;
        if (countdown === 0) {
          client.close();
          server.close();
        }
      }

      for (let n = 0; n < count; n++) {
        const req = client.request();

        req.on("response", function (headers) {
          expect(headers[":status"]).toBe(200);
          expect(headers["content-type"]).toBe("text/html");
          expect(headers.date).toBeTruthy();
        });

        let data = "";
        req.setEncoding("utf8");
        req.on("data", d => (data += d));

        req.on("end", () => {
          expect(body).toBe(data);
        });

        req.on("close", () => countDown());
      }
    });
  });
});

it("http2 connect supports various URL formats", async done => {
  const { mustCall } = createCallCheckCtx(done);
  return await new Promise(resolve => {
    const server = http2.createServer();
    server.listen(0);

    server.on("listening", function () {
      const port = this.address().port;

      const items = [
        [`http://localhost:${port}`],
        [new URL(`http://localhost:${port}`)],
        [{ protocol: "http:", hostname: "localhost", port }],
        [{ port }, { protocol: "http:" }],
        [{ port, hostname: "127.0.0.1" }, { protocol: "http:" }],
      ];

      let countdown = items.length + 1;
      function countDown() {
        countdown--;
        if (countdown === 0) {
          setImmediate(() => {
            server.close();
            resolve();
          });
        }
      }

      const maybeClose = client => {
        client.close();
        countDown();
      };

      items.forEach(i => {
        const client = http2.connect.apply(null, i);
        client.on("connect", () => maybeClose(client));
        client.on("close", mustCall());
      });

      // Will fail because protocol does not match the server.
      const client = http2.connect({
        port: port,
        protocol: "https:",
      });
      client.on("error", () => countDown());
      client.on("close", mustCall());
    });
  });
});

it("http2 request.close() validates input and manages stream state", async done => {
  const { mustCall } = createCallCheckCtx(done);
  const server = http2.createServer();

  server.on("stream", stream => {
    stream.on("close", () => {});
    stream.respond();
    stream.end("ok");
  });

  return await new Promise(resolve => {
    server.listen(0, () => {
      const port = server.address().port;
      const client = http2.connect(`http://localhost:${port}`);
      const req = client.request();
      const closeCode = 1;

      // Test out of range code
      expect(() => req.close(2 ** 32)).toThrow(
        'The value of "code" is out of range. It must be ' + ">= 0 && <= 4294967295. Received 4294967296",
      );
      expect(req.closed).toBe(false);

      // Test invalid callback argument types
      [true, 1, {}, [], null, "test"].forEach(notFunction => {
        expect(() => req.close(closeCode, notFunction)).toThrow();
        expect(req.closed).toBe(false);
      });

      // Valid close call with callback
      req.close(closeCode, mustCall());

      expect(req.closed).toBe(true);

      // Store original _destroy method
      const originalDestroy = req._destroy;

      // Replace _destroy to check if it's called
      req._destroy = mustCall((...args) => {
        return originalDestroy.apply(req, args);
      });

      // Second call doesn't do anything
      req.close(closeCode + 1);

      req.on("close", () => {
        expect(req.destroyed).toBe(true);
        expect(req.rstCode).toBe(closeCode);

        server.close();
        client.close();
        resolve();
      });

      req.on("error", err => {
        expect(err.code).toBe("ERR_HTTP2_STREAM_ERROR");
        expect(err.name).toBe("Error");
        expect(err.message).toBe("Stream closed with error code NGHTTP2_PROTOCOL_ERROR");
      });

      // The `response` event should not fire as the server should receive the
      // RST_STREAM frame before it ever has a chance to reply.
      req.on("response", () => {
        throw new Error("Response event should not be called");
      });

      // The `end` event should still fire as we close the readable stream by
      // pushing a `null` chunk.
      req.on("end", mustCall());

      req.resume();
      req.end();
    });
  });
});

it("http2 client.setNextStreamID validates input", async () => {
  const server = http2.createServer();

  server.on("stream", stream => {
    stream.respond();
    stream.end("ok");
  });

  const types = {
    boolean: true,
    function: () => {},
    number: 1,
    object: {},
    array: [],
    null: null,
    symbol: Symbol("test"),
  };

  return await new Promise(resolve => {
    server.listen(0, () => {
      const port = server.address().port;
      const client = http2.connect(`http://localhost:${port}`);

      client.on("connect", () => {
        // Test out of range value
        const outOfRangeNum = 2 ** 32;
        expect(() => client.setNextStreamID(outOfRangeNum)).toThrow(
          'The value of "id" is out of range.' + " It must be > 0 and <= 4294967295. Received " + outOfRangeNum,
        );

        // Test invalid types
        Object.entries(types).forEach(([type, value]) => {
          if (type === "number") {
            return;
          }

          try {
            client.setNextStreamID(value);
            // If we reach here, the function didn't throw, which is an error
            expect(false).toBe(true); // Force test failure
          } catch (err) {
            expect(err.name).toBe("TypeError");
            expect(err.code).toBe("ERR_INVALID_ARG_TYPE");
            expect(err.message).toContain('The "id" argument must be of type number');
          }
        });

        server.close();
        client.close();
        resolve();
      });
    });
  });
});

it("http2 request.destroy() with error", async () => {
  const server = http2.createServer();

  // Do not mustCall the server side callbacks, they may or may not be called
  // depending on the OS. The determination is based largely on operating
  // system specific timings
  server.on("stream", stream => {
    // Do not wrap in a must call or use common.expectsError (which now uses
    // must call). The error may or may not be reported depending on operating
    // system specific timings.
    stream.on("error", err => {
      expect(err.code).toBe("ERR_HTTP2_STREAM_ERROR");
      expect(err.message).toBe("Stream closed with error code NGHTTP2_INTERNAL_ERROR");
    });

    stream.respond();
    stream.end();
  });

  return new Promise(resolve => {
    server.listen(0, () => {
      let countdown = 2;
      function countDown() {
        countdown--;
        if (countdown === 0) {
          server.close();
          client.close();
          resolve();
        }
      }

      const port = server.address().port;
      const client = http2.connect(`http://localhost:${port}`);

      client.on("connect", () => countDown());

      const req = client.request();

      // Destroy the request with an error
      req.destroy(new Error("test"));

      // Error event should receive the provided error
      req.on("error", err => {
        expect(err.name).toBe("Error");
        expect(err.message).toBe("test");
      });

      // Close event should fire with the correct reset code
      req.on("close", () => {
        expect(req.rstCode).toBe(http2.constants.NGHTTP2_INTERNAL_ERROR);
        countDown();
      });

      // These events should not fire since the stream is destroyed
      req.on("response", () => {
        throw new Error("response event should not be called");
      });

      req.resume();

      req.on("end", () => {
        throw new Error("end event should not be called");
      });
    });
  });
});

it("http2 client.request() rejects header names longer than 4096 bytes with a catchable error", async () => {
  // A header name longer than the 4096-byte HPACK name buffer must surface as a
  // thrown ERR_INVALID_HTTP_TOKEN, not terminate the process. Run in a
  // subprocess so a crash shows up as a failed assertion instead of taking down
  // the test runner.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const http2 = require("node:http2");
      const server = http2.createServer();
      server.on("stream", stream => {
        stream.respond({ ":status": 200 });
        stream.end("ok");
      });
      server.listen(0, "127.0.0.1", () => {
        const client = http2.connect("http://127.0.0.1:" + server.address().port);
        client.on("error", () => {});
        client.on("connect", () => {
          try {
            client.request({ ":path": "/", [Buffer.alloc(5000, "x").toString()]: "1" });
            console.log("NO_ERROR");
          } catch (err) {
            console.log("CODE:" + err.code);
            console.log("NAME:" + err.name);
          }
          // A legitimate request on the same session still succeeds afterwards.
          const req = client.request({ ":path": "/" });
          req.on("response", headers => {
            console.log("STATUS:" + headers[":status"]);
          });
          req.resume();
          req.on("close", () => {
            client.close();
            server.close();
          });
          req.end();
        });
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toContain("CODE:ERR_INVALID_HTTP_TOKEN");
  expect(stdout).toContain("NAME:TypeError");
  expect(stdout).not.toContain("NO_ERROR");
  expect(stdout).toContain("STATUS:200");
  expect(exitCode).toBe(0);
});

it("http2 client.request() propagates a throwing header-value toString() instead of masking it", async () => {
  // Node calls `${value}` and lets the user's exception escape; it must not be
  // replaced with ERR_HTTP2_INVALID_HEADER_VALUE.
  const server = http2.createServer();
  server.on("stream", stream => {
    stream.respond({ ":status": 200 });
    stream.end("ok");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = http2.connect(`http://127.0.0.1:${server.address().port}`);
  client.on("error", () => {});
  await new Promise(resolve => client.once("connect", resolve));

  try {
    const boom = msg => ({
      toString() {
        throw new RangeError(msg);
      },
    });
    const describeThrow = fn => {
      try {
        fn();
        return { name: "<none>", code: "<none>", message: "<none>" };
      } catch (e) {
        return { name: e.constructor.name, code: e.code, message: e.message };
      }
    };

    expect([
      describeThrow(() => client.request({ ":path": "/", "x-a": boom("scalar") })),
      describeThrow(() => client.request({ ":path": "/", "x-a": "ok", "x-b": boom("second") })),
      describeThrow(() => client.request({ ":path": "/", "x-a": [boom("array0")] })),
      describeThrow(() => client.request({ ":path": "/", "x-a": ["ok", boom("array1")] })),
      describeThrow(() =>
        client.request({ ":path": "/", "x-a": boom("sensitive"), [http2.sensitiveHeaders]: ["x-a"] }),
      ),
    ]).toEqual([
      { name: "RangeError", code: undefined, message: "scalar" },
      { name: "RangeError", code: undefined, message: "second" },
      { name: "RangeError", code: undefined, message: "array0" },
      { name: "RangeError", code: undefined, message: "array1" },
      { name: "RangeError", code: undefined, message: "sensitive" },
    ]);
  } finally {
    client.close();
    server.close();
  }
});

it("http2 server resets streams whose request headers contain CR, LF, or NUL octets", async () => {
  // RFC 9113 Section 8.2.1: a request carrying a field value with NUL, CR, or
  // LF is malformed and must be answered with a stream error, not delivered
  // to the application. HPACK strings are length-prefixed, so a peer can put
  // raw CR/LF into a header value; if that reaches req.headers it gets
  // re-serialized into any HTTP/1.1 upstream request the application makes.
  const deliveredValues = [];
  const server = http2.createServer();
  server.on("stream", (stream, headers) => {
    deliveredValues.push(headers["x-injected"]);
    stream.respond({ ":status": 200 });
    stream.end("ok");
  });

  const { promise: listening, resolve: onListening } = Promise.withResolvers();
  server.listen(0, "127.0.0.1", onListening);
  await listening;
  const port = server.address().port;

  // HPACK string literal: 7-bit length prefix, no Huffman coding.
  const literal = str => {
    const bytes = Buffer.from(str, "latin1");
    return Buffer.concat([Buffer.from([bytes.length]), bytes]);
  };
  const headerBlock = Buffer.concat([
    Buffer.from([0x82]), // :method: GET   (static table index 2)
    Buffer.from([0x86]), // :scheme: http  (static table index 6)
    Buffer.from([0x84]), // :path: /       (static table index 4)
    Buffer.from([0x01]), // :authority     (literal without indexing, name index 1)
    literal("localhost"),
    Buffer.from([0x00]), // literal header field without indexing, new name
    literal("x-injected"),
    literal("a\r\nx-forwarded-for: 127.0.0.1"),
  ]);

  const frames = [];
  const { promise: exchanged, resolve: onExchanged, reject: onSocketError } = Promise.withResolvers();
  const socket = net.connect(port, "127.0.0.1", () => {
    socket.write(http2utils.kClientMagic);
    socket.write(new http2utils.SettingsFrame(false).data);
    // HEADERS frame on stream 1 with END_HEADERS | END_STREAM.
    socket.write(new http2utils.HeadersFrame(1, headerBlock, 0, true, true).data);
    // PING acts as a barrier: by the time its ACK (or a GOAWAY) arrives the
    // server has fully processed the HEADERS frame above.
    socket.write(new http2utils.PingFrame(false).data);
  });
  socket.on("error", onSocketError);
  let received = Buffer.alloc(0);
  socket.on("data", chunk => {
    received = Buffer.concat([received, chunk]);
    while (received.length >= 9) {
      const length = received.readUIntBE(0, 3);
      if (received.length < 9 + length) break;
      const frame = {
        type: received[3],
        flags: received[4],
        streamId: received.readUInt32BE(5) & 0x7fffffff,
        payload: Buffer.from(received.subarray(9, 9 + length)),
      };
      received = received.subarray(9 + length);
      frames.push(frame);
      if ((frame.type === 6 && (frame.flags & 1) !== 0) || frame.type === 7) {
        onExchanged();
        return;
      }
    }
  });
  socket.on("close", () => onExchanged());

  let client;
  try {
    try {
      await exchanged;
      // The malformed request never reaches the application.
      expect(deliveredValues).toEqual([]);
      // The stream is reset with PROTOCOL_ERROR instead of being answered.
      const rst = frames.find(f => f.type === 3 && f.streamId === 1);
      expect(rst).toBeDefined();
      expect(rst.payload.readUInt32BE(0)).toBe(http2.constants.NGHTTP2_PROTOCOL_ERROR);
      expect(frames.find(f => f.type === 1 && f.streamId === 1)).toBeUndefined();
    } finally {
      socket.destroy();
    }

    // A request whose header values contain no forbidden octets still reaches
    // the application and gets a response.
    client = http2.connect(`http://127.0.0.1:${port}`);
    client.on("error", () => {});
    const { promise: responded, resolve: onResponse, reject: onError } = Promise.withResolvers();
    const req = client.request({ ":path": "/", "x-injected": "clean" });
    req.on("response", onResponse);
    req.on("error", onError);
    req.resume();
    req.end();
    const headers = await responded;
    expect(headers[":status"]).toBe(200);
    expect(deliveredValues).toEqual(["clean"]);
  } finally {
    client?.close();
    server.close();
  }
});

it("http2 server rejects requests carrying connection-specific or repeated pseudo-headers", async () => {
  // RFC 9113 Section 8.2.2: connection-specific fields (transfer-encoding,
  // connection, keep-alive, ...) make an HTTP/2 request malformed, and
  // Section 8.3.1 forbids repeating pseudo-header fields. Either must be
  // answered with a stream error instead of being handed to the application,
  // otherwise a proxy that copies req.headers re-serializes them into an
  // HTTP/1.1 upstream request.
  const deliveredRequests = [];
  const server = http2.createServer();
  server.on("stream", (stream, headers) => {
    deliveredRequests.push(headers);
    stream.respond({ ":status": 200 });
    stream.end("ok");
  });

  const { promise: listening, resolve: onListening } = Promise.withResolvers();
  server.listen(0, "127.0.0.1", onListening);
  await listening;
  const port = server.address().port;

  // HPACK string literal: 7-bit length prefix, no Huffman coding.
  const literal = str => {
    const bytes = Buffer.from(str, "latin1");
    return Buffer.concat([Buffer.from([bytes.length]), bytes]);
  };
  const malformedHeaderBlocks = {
    "transfer-encoding header": Buffer.concat([
      Buffer.from([0x82]), // :method: GET   (static table index 2)
      Buffer.from([0x86]), // :scheme: http  (static table index 6)
      Buffer.from([0x84]), // :path: /       (static table index 4)
      Buffer.from([0x01]), // :authority     (literal without indexing, name index 1)
      literal("localhost"),
      Buffer.from([0x00]), // literal header field without indexing, new name
      literal("transfer-encoding"),
      literal("chunked"),
    ]),
    "connection: keep-alive header": Buffer.concat([
      Buffer.from([0x82]), // :method: GET
      Buffer.from([0x86]), // :scheme: http
      Buffer.from([0x84]), // :path: /
      Buffer.from([0x01]), // :authority
      literal("localhost"),
      Buffer.from([0x00]), // literal header field without indexing, new name
      literal("connection"),
      literal("keep-alive"),
    ]),
    "repeated :path pseudo-header": Buffer.concat([
      Buffer.from([0x82]), // :method: GET
      Buffer.from([0x86]), // :scheme: http
      Buffer.from([0x84]), // :path: /
      Buffer.from([0x84]), // :path: /   (repeated)
      Buffer.from([0x01]), // :authority
      literal("localhost"),
    ]),
  };

  async function exchange(headerBlock) {
    const frames = [];
    const { promise: exchanged, resolve: onExchanged, reject: onSocketError } = Promise.withResolvers();
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(http2utils.kClientMagic);
      socket.write(new http2utils.SettingsFrame(false).data);
      // HEADERS frame on stream 1 with END_HEADERS | END_STREAM.
      socket.write(new http2utils.HeadersFrame(1, headerBlock, 0, true, true).data);
      // PING acts as a barrier: by the time its ACK (or a GOAWAY) arrives the
      // server has fully processed the HEADERS frame above.
      socket.write(new http2utils.PingFrame(false).data);
    });
    socket.on("error", onSocketError);
    let received = Buffer.alloc(0);
    socket.on("data", chunk => {
      received = Buffer.concat([received, chunk]);
      while (received.length >= 9) {
        const length = received.readUIntBE(0, 3);
        if (received.length < 9 + length) break;
        const frame = {
          type: received[3],
          flags: received[4],
          streamId: received.readUInt32BE(5) & 0x7fffffff,
          payload: Buffer.from(received.subarray(9, 9 + length)),
        };
        received = received.subarray(9 + length);
        frames.push(frame);
        if ((frame.type === 6 && (frame.flags & 1) !== 0) || frame.type === 7) {
          onExchanged();
          return;
        }
      }
    });
    socket.on("close", () => onExchanged());
    try {
      await exchanged;
    } finally {
      socket.destroy();
    }
    return frames;
  }

  let client;
  try {
    for (const [caseName, headerBlock] of Object.entries(malformedHeaderBlocks)) {
      const frames = await exchange(headerBlock);
      // The malformed request never reaches the application.
      expect({ caseName, delivered: deliveredRequests.length }).toEqual({ caseName, delivered: 0 });
      // The stream is reset with PROTOCOL_ERROR instead of being answered.
      const rst = frames.find(f => f.type === 3 && f.streamId === 1);
      expect({ caseName, rstCode: rst?.payload?.readUInt32BE(0) }).toEqual({
        caseName,
        rstCode: http2.constants.NGHTTP2_PROTOCOL_ERROR,
      });
      expect(frames.find(f => f.type === 1 && f.streamId === 1)).toBeUndefined();
    }

    // A request without connection-specific or repeated headers still reaches
    // the application and gets a response.
    client = http2.connect(`http://127.0.0.1:${port}`);
    client.on("error", () => {});
    const { promise: responded, resolve: onResponse, reject: onError } = Promise.withResolvers();
    const req = client.request({ ":path": "/", "x-clean": "yes" });
    req.on("response", onResponse);
    req.on("error", onError);
    req.resume();
    req.end();
    const headers = await responded;
    expect(headers[":status"]).toBe(200);
    expect(deliveredRequests.length).toBe(1);
    expect(deliveredRequests[0]["x-clean"]).toBe("yes");
  } finally {
    client?.close();
    server.close();
  }
});

it("http2 client survives session teardown from a socket write while flushing queued DATA frames", async () => {
  // A flow-control-limited DATA frame sits in the native outbound queue until
  // the peer reopens the window. The flush that follows writes to the JS
  // socket (options.createConnection), and an application may tear the whole
  // session down from inside that write -- e.g. an error handler reacting to a
  // failed write. The teardown drops every queued frame, so the in-progress
  // flush must not keep using the frame it was sending. Run in a subprocess so
  // a crash shows up as a failed assertion instead of taking down the runner.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const http2 = require("node:http2");
      const { Duplex } = require("node:stream");

      function frame(type, flags, streamId, payload = Buffer.alloc(0)) {
        const header = Buffer.alloc(9);
        header.writeUIntBE(payload.length, 0, 3);
        header[3] = type;
        header[4] = flags;
        header.writeUInt32BE(streamId, 5);
        return Buffer.concat([header, payload]);
      }
      function windowUpdate(streamId, increment) {
        const payload = Buffer.alloc(4);
        payload.writeUInt32BE(increment, 0);
        return frame(8, 0, streamId, payload);
      }

      let armed = false;
      let tornDown = false;

      const socket = new Duplex({
        writableHighWaterMark: 4 * 1024 * 1024,
        read() {},
        write(chunk, encoding, callback) {
          // Once the WINDOW_UPDATE has been delivered, the first DATA frame
          // header for stream 1 is the flush of the queued DATA frame.
          // Destroy the whole session from inside that write.
          if (
            armed &&
            !tornDown &&
            chunk.length >= 9 &&
            chunk[3] === 0x00 &&
            chunk.readUIntBE(0, 3) > 0 &&
            (chunk.readUInt32BE(5) & 0x7fffffff) === 1
          ) {
            tornDown = true;
            client.destroy();
            setImmediate(() => {
              console.log("TEARDOWN_DURING_FLUSH_OK");
              process.exit(0);
            });
          }
          callback();
        },
      });

      const client = http2.connect("http://localhost", { createConnection: () => socket });
      client.on("error", () => {});
      client.on("connect", () => {
        // Server preface: empty SETTINGS plus an ACK of the client's SETTINGS.
        socket.push(Buffer.concat([frame(4, 0, 0), frame(4, 1, 0)]));
      });
      client.once("remoteSettings", () => {
        const req = client.request({ ":method": "POST", ":path": "/" });
        req.on("error", () => {});
        // 65535 bytes fit in the initial flow-control window and go out right
        // away; the remaining 32 KiB is queued natively until the window reopens.
        req.write(Buffer.alloc(65535 + 32768, "a"));
        console.log("DATA_QUEUED");
        armed = true;
        // Reopen the connection-level and stream-level windows so the queued
        // DATA frames are flushed.
        socket.push(Buffer.concat([windowUpdate(0, 1048576), windowUpdate(1, 1048576)]));
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("DATA_QUEUED");
  expect(stdout).toContain("TEARDOWN_DURING_FLUSH_OK");
  expect(exitCode).toBe(0);
});

it("http2 client keeps parsing a socket chunk whose ArrayBuffer is transferred by a frame event handler", async () => {
  // With a user-supplied connection (options.createConnection), the exact
  // Buffer handed to the socket "data" listener is fed to the native HTTP/2
  // frame parser, and per-frame events (like "ping") fire synchronously while
  // the parser is still iterating over that chunk. If a handler transfers the
  // chunk's ArrayBuffer mid-parse, the remaining frames must still be parsed
  // from the original contents rather than from memory the application now
  // owns and overwrites. Run in a subprocess so a crash shows up as a failed
  // assertion instead of taking down the test runner.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const http2 = require("node:http2");
      const { Duplex } = require("node:stream");

      function frame(type, flags, streamId, payload = Buffer.alloc(0)) {
        const header = Buffer.alloc(9);
        header.writeUIntBE(payload.length, 0, 3);
        header[3] = type;
        header[4] = flags;
        header.writeUInt32BE(streamId, 5);
        return Buffer.concat([header, payload]);
      }

      const socket = new Duplex({
        read() {},
        write(chunk, encoding, callback) {
          callback();
        },
      });

      const client = http2.connect("http://localhost", { createConnection: () => socket });
      client.on("error", () => {});

      // Two PING frames in a single chunk backed by its own ArrayBuffer. The
      // first ping's handler transfers that ArrayBuffer mid-parse; the second
      // ping must still surface its original payload.
      const ping1 = frame(6, 0, 0, Buffer.alloc(8, "A"));
      const ping2 = frame(6, 0, 0, Buffer.alloc(8, "B"));
      const chunkArrayBuffer = new ArrayBuffer(ping1.length + ping2.length);
      const pingChunk = Buffer.from(chunkArrayBuffer);
      ping1.copy(pingChunk, 0);
      ping2.copy(pingChunk, ping1.length);

      const pings = [];
      client.on("ping", payload => {
        pings.push(Buffer.from(payload).toString("hex"));
        if (pings.length === 1) {
          try {
            const moved = chunkArrayBuffer.transfer();
            new Uint8Array(moved).fill(0xff);
          } catch {
            // The runtime may refuse to detach a buffer it is still reading from.
          }
          setImmediate(() => {
            console.log("PINGS:" + JSON.stringify(pings));
            process.exit(0);
          });
        }
      });

      client.on("connect", () => {
        // Server preface (empty SETTINGS) in its own, separate chunk.
        socket.push(frame(4, 0, 0));
      });
      client.once("remoteSettings", () => {
        socket.push(pingChunk);
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain('PINGS:["4141414141414141","4242424242424242"]');
  expect(exitCode).toBe(0);
});

it("http2 server splits an oversized PUSH_PROMISE header block into CONTINUATION frames", async () => {
  // RFC 9113 6.6/6.10: a PUSH_PROMISE whose header block exceeds the peer's max frame size
  // must be continued in CONTINUATION frames rather than rejected. 40KB of "a" encodes to
  // ~25KB (Huffman) - comfortably above the default 16384-byte frame limit.
  const bigValue = Buffer.alloc(40000, "a").toString();
  const server = http2.createServer();
  server.on("stream", stream => {
    stream.pushStream({ ":path": "/pushed", "x-big": bigValue }, (err, push) => {
      if (err) {
        stream.destroy(err);
        return;
      }
      push.respond({ ":status": 200 });
      push.end("pushed");
    });
    stream.respond({ ":status": 200 });
    stream.end("ok");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

  try {
    const client = http2.connect(`http://127.0.0.1:${server.address().port}`);
    client.on("error", () => {});
    const { promise: pushedHeaders, resolve: onPush, reject: onError } = Promise.withResolvers();
    client.on("stream", (pushStream, headers) => {
      pushStream.on("error", onError);
      pushStream.resume();
      onPush(headers);
    });
    const req = client.request({ ":path": "/" });
    req.on("error", onError);
    req.resume();

    const headers = await pushedHeaders;
    expect(headers[":path"]).toBe("/pushed");
    expect(headers["x-big"]).toBe(bigValue);
    client.close();
  } finally {
    server.close();
  }
});

it("http2 option range error messages use the options. prefix", () => {
  for (const opt of ["maxSessionInvalidFrames", "maxSessionRejectedStreams", "unknownProtocolTimeout"]) {
    let error;
    try {
      http2.createServer({ [opt]: -1 });
    } catch (e) {
      error = e;
    }
    expect(error?.code).toBe("ERR_OUT_OF_RANGE");
    expect(error?.message).toContain(`"options.${opt}"`);
  }
});

it("getPackedSettings caps initialWindowSize at 2**31-1", () => {
  // The cap itself is valid.
  http2.getPackedSettings({ initialWindowSize: 2 ** 31 - 1 });

  let error;
  try {
    http2.getPackedSettings({ initialWindowSize: 2 ** 31 });
  } catch (e) {
    error = e;
  }
  expect(error?.code).toBe("ERR_HTTP2_INVALID_SETTING_VALUE");
  expect(error?.message).toBe('Invalid value for setting "initialWindowSize": 2147483648');

  error = undefined;
  try {
    http2.getUnpackedSettings(Buffer.from([0x00, 0x04, 0xff, 0xff, 0xff, 0xff]), { validate: true });
  } catch (e) {
    error = e;
  }
  expect(error?.code).toBe("ERR_HTTP2_INVALID_SETTING_VALUE");
});

it("http2 stream.respond accepts raw-headers arrays; respondWithFD/respondWithFile reject them", async () => {
  // respond() accepts the node v26 raw [name1, value1, ...] headers form (verified
  // on node v26.3.0: status/x-foo land on the wire); respondWithFD/respondWithFile
  // still reject arrays with ERR_INVALID_ARG_TYPE.
  const errors = [];
  const server = http2.createServer();
  server.on("stream", stream => {
    for (const invoke of [
      () => stream.respondWithFD(0, ["x-foo", "bar"]),
      () => stream.respondWithFile(import.meta.path, ["x-foo", "bar"]),
    ]) {
      try {
        invoke();
        errors.push(null);
      } catch (e) {
        errors.push(e);
      }
    }
    stream.respond([":status", "200", "x-raw", "yes"]);
    stream.end("ok");
  });

  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const client = http2.connect(`http://localhost:${port}`);
  client.on("error", () => {});

  try {
    const req = client.request({ ":path": "/" });
    const response = await new Promise((resolve, reject) => {
      req.on("error", reject);
      req.on("response", resolve);
      req.end();
    });
    let body = "";
    req.on("data", chunk => (body += chunk));
    await new Promise(resolve => req.on("end", resolve));

    expect(errors).toHaveLength(2);
    for (const err of errors) {
      expect(err).not.toBeNull();
      expect(err.code).toBe("ERR_INVALID_ARG_TYPE");
    }
    expect(response[":status"]).toBe(200);
    expect(response["x-raw"]).toBe("yes");
    expect(body).toBe("ok");
  } finally {
    client.close();
    server.close();
  }
});
it("http2 client.request() on a destroyed or closed session uses the right error codes", async () => {
  // Node: destroyed session -> ERR_HTTP2_INVALID_SESSION,
  // closed (GOAWAY-pending) session -> ERR_HTTP2_GOAWAY_SESSION.
  // The error may surface synchronously or on the returned stream.
  function captureRequestError(session) {
    try {
      const req = session.request({ ":path": "/" });
      return new Promise(resolve => req.on("error", resolve));
    } catch (e) {
      return Promise.resolve(e);
    }
  }

  const server = http2.createServer();
  let endHangingStream;
  server.on("stream", (stream, headers) => {
    stream.respond({ ":status": 200 });
    if (headers[":path"] === "/hang") {
      endHangingStream = () => stream.end("done");
    } else {
      stream.end("ok");
    }
  });
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // Closed session (graceful close with a stream still in flight).
    const client = http2.connect(`http://localhost:${port}`);
    client.on("error", () => {});
    await new Promise(resolve => client.on("connect", resolve));
    const inflight = client.request({ ":path": "/hang" });
    inflight.on("error", () => {});
    inflight.resume();
    await new Promise(resolve => inflight.on("response", resolve));
    client.close();
    expect(client.closed).toBe(true);
    expect(client.destroyed).toBe(false);

    const goawayError = await captureRequestError(client);
    expect(goawayError.code).toBe("ERR_HTTP2_GOAWAY_SESSION");
    expect(goawayError.message).toBe("New streams cannot be created after receiving a GOAWAY");

    endHangingStream();
    await new Promise(resolve => inflight.on("close", resolve));

    // Destroyed session.
    const client2 = http2.connect(`http://localhost:${port}`);
    client2.on("error", () => {});
    await new Promise(resolve => client2.on("connect", resolve));
    client2.destroy();

    const destroyedError = await captureRequestError(client2);
    expect(destroyedError.code).toBe("ERR_HTTP2_INVALID_SESSION");
    expect(destroyedError.message).toBe("The session has been destroyed");
  } finally {
    server.close();
  }
});

function requestOverHttp1(port, headers) {
  const { promise, resolve, reject } = Promise.withResolvers();
  const request = https.request(
    {
      host: "localhost",
      port,
      path: "/",
      agent: false,
      ca: TLS_CERT.cert,
      headers: { connection: "close", ...headers },
    },
    async response => {
      try {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", chunk => (body += chunk));
        await new Promise(done => response.on("end", done));
        resolve({
          statusCode: response.statusCode,
          statusMessage: response.statusMessage,
          headers: response.headers,
          body,
        });
      } catch (err) {
        reject(err);
      }
    },
  );
  request.on("error", reject);
  request.end();
  return promise;
}

it("http2 allowHTTP1 fallback serializes every application response header as its own name/value line", async () => {
  const server = http2.createSecureServer({ ...TLS_CERT, allowHTTP1: true }, (req, res) => {
    res.writeHead(202, "Accepted", {
      "content-type": "application/json; charset=utf-8",
      "x-custom-token": "abcdef123456",
    });
    res.end('{"ok":true}');
  });
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const response = await requestOverHttp1(server.address().port);
    expect({
      statusCode: response.statusCode,
      statusMessage: response.statusMessage,
      contentType: response.headers["content-type"],
      token: response.headers["x-custom-token"],
      body: response.body,
    }).toEqual({
      statusCode: 202,
      statusMessage: "Accepted",
      contentType: "application/json; charset=utf-8",
      token: "abcdef123456",
      body: '{"ok":true}',
    });
  } finally {
    server.close();
  }
});

it("http2 allowHTTP1 fallback rejects a statusMessage containing CR or LF", async () => {
  const thrownCodes = [];
  const server = http2.createSecureServer({ ...TLS_CERT, allowHTTP1: true }, (req, res) => {
    res.statusMessage = "Split\r\nx-extra: injected";
    try {
      res.end("nope");
    } catch (err) {
      thrownCodes.push(err.code);
      res.statusMessage = "All Good";
      res.end("body");
    }
  });
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const response = await requestOverHttp1(server.address().port);
    expect(response.headers["x-extra"]).toBeUndefined();
    expect(response.statusMessage).toBe("All Good");
    expect(response.body).toBe("body");
    expect(thrownCodes).toEqual(["ERR_INVALID_CHAR"]);
  } finally {
    server.close();
  }
});

it("http2 allowHTTP1 fallback rejects an out-of-range statusCode", async () => {
  const thrownCodes = [];
  const server = http2.createSecureServer({ ...TLS_CERT, allowHTTP1: true }, (req, res) => {
    res.statusCode = 99;
    try {
      res.end("nope");
    } catch (err) {
      thrownCodes.push(err.code);
      res.statusCode = 200;
      res.end("body");
    }
  });
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const response = await requestOverHttp1(server.address().port);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("body");
    expect(thrownCodes).toEqual(["ERR_HTTP_INVALID_STATUS_CODE"]);
  } finally {
    server.close();
  }
});

it("http2 allowHTTP1 fallback frames a HEAD response like plain HTTP/1 (no Content-Length, no Transfer-Encoding)", async () => {
  const server = http2.createSecureServer({ ...TLS_CERT, allowHTTP1: true }, (req, res) => {
    res.writeHead(200, { "x-method": req.method });
    res.end();
  });
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const { promise, resolve, reject } = Promise.withResolvers();
    const socket = tls.connect(
      { host: "localhost", port: server.address().port, ca: TLS_CERT.cert, ALPNProtocols: ["http/1.1"] },
      () => socket.write("HEAD / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"),
    );
    const chunks = [];
    socket.on("error", reject);
    socket.on("data", chunk => chunks.push(chunk));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString()));
    const raw = await promise;
    expect(raw).toStartWith("HTTP/1.1 200 OK\r\n");
    expect(raw).toEndWith("\r\n\r\n");
    expect(raw.toLowerCase()).toContain("\r\nx-method: head\r\n");
    expect(raw.toLowerCase()).not.toContain("content-length");
    expect(raw.toLowerCase()).not.toContain("transfer-encoding");
  } finally {
    server.close();
  }
});

it("http2 allowHTTP1 fallback writes a close-delimited body raw and ends the connection", async () => {
  const server = http2.createSecureServer({ ...TLS_CERT, allowHTTP1: true }, (req, res) => {
    res.removeHeader("content-length");
    res.removeHeader("transfer-encoding");
    res.write("part1");
    res.end("part2");
  });
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const { promise, resolve, reject } = Promise.withResolvers();
    const socket = tls.connect(
      { host: "localhost", port: server.address().port, ca: TLS_CERT.cert, ALPNProtocols: ["http/1.1"] },
      () => socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n"),
    );
    const chunks = [];
    socket.on("error", reject);
    socket.on("data", chunk => chunks.push(chunk));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString()));
    const raw = await promise;
    expect(raw).toStartWith("HTTP/1.1 200 OK\r\n");
    expect(raw.toLowerCase()).not.toContain("content-length");
    expect(raw.toLowerCase()).not.toContain("transfer-encoding");
    // The advertised connection state must match the close-delimited transport.
    expect(raw.slice(0, raw.indexOf("\r\n\r\n") + 4).toLowerCase()).toContain("\r\nconnection: close\r\n");
    expect(raw.slice(raw.indexOf("\r\n\r\n") + 4)).toBe("part1part2");
  } finally {
    server.close();
  }
});

it("http2 allowHTTP1 fallback writes no terminating chunk after a keep-alive HEAD with a user-set Transfer-Encoding: chunked", async () => {
  const server = http2.createSecureServer({ ...TLS_CERT, allowHTTP1: true }, (req, res) => {
    if (req.method === "HEAD") {
      res.setHeader("Transfer-Encoding", "chunked");
      res.end();
      return;
    }
    res.end("body2");
  });
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const { promise, resolve, reject } = Promise.withResolvers();
    const socket = tls.connect(
      { host: "localhost", port: server.address().port, ca: TLS_CERT.cert, ALPNProtocols: ["http/1.1"] },
      () => socket.write("HEAD / HTTP/1.1\r\nHost: localhost\r\n\r\n"),
    );
    const chunks = [];
    let sentSecond = false;
    socket.on("error", reject);
    socket.on("data", chunk => {
      chunks.push(chunk);
      if (!sentSecond && Buffer.concat(chunks).includes("\r\n\r\n")) {
        // The HEAD head arrived; reuse the connection for a second request.
        sentSecond = true;
        socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
      }
    });
    socket.on("end", () => resolve(Buffer.concat(chunks).toString()));
    const raw = await promise;
    const afterHead = raw.slice(raw.indexOf("\r\n\r\n") + 4);
    // A HEAD response has no body and no terminating chunk: the next bytes on
    // the connection must be the second response's status line.
    expect(afterHead).toStartWith("HTTP/1.1 200 ");
    expect(raw).not.toContain("0\r\n\r\n");
    expect(afterHead.slice(afterHead.indexOf("\r\n\r\n") + 4)).toBe("body2");
  } finally {
    server.close();
  }
});

it("http2 allowHTTP1 fallback omits the Connection header on a close-delimited response when the user removed it", async () => {
  const server = http2.createSecureServer({ ...TLS_CERT, allowHTTP1: true }, (req, res) => {
    res.removeHeader("content-length");
    res.removeHeader("transfer-encoding");
    res.removeHeader("connection");
    res.end("body");
  });
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const { promise, resolve, reject } = Promise.withResolvers();
    const socket = tls.connect(
      { host: "localhost", port: server.address().port, ca: TLS_CERT.cert, ALPNProtocols: ["http/1.1"] },
      () => socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n"),
    );
    const chunks = [];
    socket.on("error", reject);
    socket.on("data", chunk => chunks.push(chunk));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString()));
    const raw = await promise;
    expect(raw).toStartWith("HTTP/1.1 200 OK\r\n");
    // Node writes no Connection (and no Keep-Alive) header here at all.
    expect(raw.toLowerCase()).not.toContain("connection:");
    expect(raw.toLowerCase()).not.toContain("keep-alive");
    expect(raw.slice(raw.indexOf("\r\n\r\n") + 4)).toBe("body");
  } finally {
    server.close();
  }
});

// close() must not depend on the peer sending a SETTINGS ACK — Node's kMaybeDestroy
// waits on nghttp2_session_want_write()/want_read(), which does not track outstanding
// ACKs. A server that never ACKs a client-sent SETTINGS must not stall close().
it("close() completes when the peer never ACKs an outstanding SETTINGS", async () => {
  // Raw-socket h2 server: preface handshake + ACK the initial SETTINGS, then
  // ignore any further SETTINGS frames (never ACK the second one).
  const server = net.createServer(socket => {
    let buf = Buffer.alloc(0);
    let ackedInitial = false;
    socket.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!ackedInitial && buf.length >= 24) {
        // Send server SETTINGS + ACK the client's initial SETTINGS.
        socket.write(Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0])); // empty SETTINGS
        socket.write(Buffer.from([0, 0, 0, 4, 1, 0, 0, 0, 0])); // SETTINGS ACK
        ackedInitial = true;
      }
      // Never ACK any subsequent SETTINGS.
    });
  });
  await new Promise(resolve => server.listen(0, resolve));
  const client = http2.connect(`http://127.0.0.1:${server.address().port}`);
  await new Promise(resolve => client.once("localSettings", resolve));
  client.settings({ enablePush: false }); // second SETTINGS the server will never ACK
  expect(client.pendingSettingsAck).toBeTrue();
  const closed = new Promise(resolve => client.on("close", resolve));
  client.close();
  await closed; // hangs before this fix
  server.close();
});

// A pull-mode consumer (pause() then on('readable')/read()) must reopen the receive
// window via _read(): the 'resume' event never fires on that path, so without _read()
// clearing the paused gate the peer stalls at the initial ~64KB stream window.
it("Http2Stream pull-mode read() after pause() replenishes the receive window", async () => {
  const PAYLOAD = 200_000; // > 65535 initial stream window
  const server = http2.createServer();
  const { promise, resolve, reject } = Promise.withResolvers();
  server.on("stream", stream => {
    // Server-side stream already has an id, so pause() reaches setStreamReading().
    stream.pause();
    let received = 0;
    stream.on("readable", () => {
      let c;
      while ((c = stream.read()) !== null) received += c.length;
    });
    stream.on("end", () => {
      stream.respond({ ":status": 200 });
      stream.end();
      resolve(received);
    });
    stream.on("error", reject);
  });
  await new Promise(r => server.listen(0, r));
  const client = http2.connect(`http://127.0.0.1:${server.address().port}`);
  try {
    client.on("error", reject);
    const req = client.request({ ":path": "/", ":method": "POST" });
    req.on("error", reject);
    req.end(Buffer.alloc(PAYLOAD, "x"));
    const received = await promise;
    expect(received).toBe(PAYLOAD);
  } finally {
    client.close();
    server.close();
  }
});

// The outbound cork buffer is thread-local across every Http2Session. Interleaving
// respond()/write() across two sessions used to let the second session's corked
// HEADERS be prepended to the first session's multi-frame DATA batch and sent to
// the wrong peer: one client saw a foreign HEADERS frame, the other never saw its
// own (test/js/web/fetch/fetch-backpressure.test.ts went intermittently red on
// Windows CI once #32488 widened the interleaving window).
it("http2 server sends each session's frames to its own peer under interleaved respond()/write()", async () => {
  const BIG = Buffer.alloc(64 * 1024, 65);
  const N = 10;
  const server = http2.createSecureServer({ ...TLS_CERT, allowHTTP1: false });
  const streams = [];
  const bothStreams = Promise.withResolvers();
  server.on("error", bothStreams.reject);
  server.on("stream", stream => {
    stream.on("error", () => {});
    streams.push(stream);
    if (streams.length === 2) bothStreams.resolve();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const results = Promise.all(
      [0, 1].map(
        i =>
          new Promise(resolve => {
            let total = 0;
            let status;
            const fail = e => {
              bothStreams.reject(e);
              resolve({ i, status, total, err: String(e) });
            };
            const client = http2.connect(`https://127.0.0.1:${server.address().port}`, TLS_OPTIONS);
            client.on("error", fail);
            const req = client.request({ ":path": "/" });
            req.on("response", h => (status = h[":status"]));
            req.on("data", c => (total += c.length));
            req.on("end", () => {
              client.close();
              resolve({ i, status, total });
            });
            req.on("error", fail);
            req.end();
          }),
      ),
    );
    await bothStreams.promise;
    // A.respond() corks A's HEADERS; B.respond() force-uncorks A (to A's socket)
    // then corks B's HEADERS. A.write(64KB) takes the multi-frame DATA path,
    // which drains the thread-local cork: without the ownership check it pulls
    // B's HEADERS into A's batch.
    streams[0].respond({ ":status": 200 });
    streams[1].respond({ ":status": 200 });
    for (let k = 0; k < N; k++) {
      streams[0].write(BIG);
      streams[1].write(BIG);
    }
    streams[0].end();
    streams[1].end();
    expect(await results).toEqual([
      { i: 0, status: 200, total: BIG.length * N },
      { i: 1, status: 200, total: BIG.length * N },
    ]);
  } finally {
    server.close();
  }
});

it("fails the whole session when an outbound header block cannot be encoded", async () => {
  // A header block the HPACK encoder cannot emit is a COMPRESSION_ERROR (9) against the
  // session in node, so the session and the in-flight request both see
  // ERR_HTTP2_SESSION_ERROR rather than a per-stream error.
  const server = http2.createServer();
  try {
    const port = await new Promise(resolve => server.listen(0, () => resolve(server.address().port)));
    const client = http2.connect(`http://localhost:${port}`, { maxSendHeaderBlockLength: 100000 });
    const sessionError = new Promise(resolve => client.on("error", resolve));
    const requestError = new Promise(resolve => {
      const req = client.request({ "test-header": Buffer.alloc(90000, "A").toString() });
      req.on("error", resolve);
      req.end();
    });

    const [sessionErr, reqErr] = await Promise.all([sessionError, requestError]);
    expect(sessionErr.code).toBe("ERR_HTTP2_SESSION_ERROR");
    expect(sessionErr.message).toBe("Session closed with error code 9");
    expect(reqErr.code).toBe("ERR_HTTP2_SESSION_ERROR");
  } finally {
    server.close();
  }
});

it("delivers a session error from the event loop, not inside the call that detected it", async () => {
  // node surfaces session errors from the event loop, so the submit call that tripped one
  // still returns and its stream stays usable for the rest of the tick.
  const server = http2.createServer({ maxSendHeaderBlockLength: 100000 });
  try {
    const observed = {};
    const sessionError = new Promise(resolve => server.on("sessionError", resolve));
    server.on("stream", stream => {
      stream.on("error", () => {});
      stream.additionalHeaders({ "test-header": Buffer.alloc(90000, "A").toString() });
      observed.destroyedAfterSubmit = stream.destroyed;
      stream.respond();
      stream.end();
      observed.submitsReturned = true;
    });

    const port = await new Promise(resolve => server.listen(0, () => resolve(server.address().port)));
    const client = http2.connect(`http://localhost:${port}`);
    client.on("error", () => {});
    const req = client.request();
    req.on("error", () => {});
    req.end();

    const err = await sessionError;
    expect(err.code).toBe("ERR_HTTP2_SESSION_ERROR");
    expect(err.message).toBe("Session closed with error code 9");
    expect(observed.destroyedAfterSubmit).toBe(false);
    expect(observed.submitsReturned).toBe(true);
    client.destroy();
  } finally {
    server.close();
  }
});

it("delivers the reserved push stream and fails the session when its headers cannot be encoded", async () => {
  // Verified against node v26.3.0: pushStream's callback still receives the reserved
  // stream (so the caller can attach handlers), and the session then dies with
  // COMPRESSION_ERROR (9); the callback never sees an error.
  const server = http2.createServer({ maxSendHeaderBlockLength: 100000 });
  try {
    const sessionError = new Promise(resolve => server.on("sessionError", resolve));
    const pushCallback = Promise.withResolvers();
    server.on("stream", stream => {
      stream.on("error", () => {});
      stream.pushStream({ ":path": "/pushed", "x-big": Buffer.alloc(90000, "A").toString() }, (err, push) => {
        push?.on("error", () => {});
        pushCallback.resolve(err ?? null);
      });
      stream.respond();
      stream.end("x");
    });
    const port = await new Promise(resolve => server.listen(0, () => resolve(server.address().port)));
    const client = http2.connect(`http://localhost:${port}`);
    client.on("error", () => {});
    const req = client.request();
    req.on("error", () => {});
    req.resume();
    req.end();

    const [cbErr, err] = await Promise.all([pushCallback.promise, sessionError]);
    expect(cbErr).toBeNull();
    expect(err.code).toBe("ERR_HTTP2_SESSION_ERROR");
    expect(err.message).toBe("Session closed with error code 9");
    client.destroy();
  } finally {
    server.close();
  }
});

it("PerformanceObserver receives http2 session and stream entries", async () => {
  const entries = [];
  // Two streams (client+server) + two sessions (client+server): resolve once
  // the observer has delivered at least four entries instead of sleeping.
  const observed = Promise.withResolvers();
  const observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) entries.push(entry);
    if (entries.length >= 4) observed.resolve();
  });
  observer.observe({ type: "http2" });
  const server = http2.createServer();
  try {
    server.on("stream", stream => {
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });
    const port = await new Promise(resolve => server.listen(0, () => resolve(server.address().port)));
    const client = http2.connect(`http://localhost:${port}`);
    client.on("error", observed.reject);
    const req = client.request({ ":path": "/" });
    req.on("error", observed.reject);
    req.resume();
    await new Promise((resolve, reject) => {
      req.on("end", resolve);
      req.on("error", reject);
    });
    await new Promise(resolve => {
      client.on("close", resolve);
      client.close();
    });
    await observed.promise;

    const sessions = entries.filter(e => e.name === "Http2Session");
    const streams = entries.filter(e => e.name === "Http2Stream");
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(streams.length).toBeGreaterThanOrEqual(2);
    const clientSession = sessions.find(e => e.detail.type === "client");
    expect(clientSession.entryType).toBe("http2");
    expect(clientSession.detail.streamCount).toBe(1);
    expect(clientSession.detail.framesReceived).toBeGreaterThanOrEqual(4);
    expect(typeof clientSession.detail.framesSent).toBe("number");
    expect(typeof clientSession.detail.streamAverageDuration).toBe("number");
    const streamEntry = streams[0];
    expect(typeof streamEntry.detail.bytesRead).toBe("number");
    expect(typeof streamEntry.detail.bytesWritten).toBe("number");
    expect(typeof streamEntry.detail.timeToFirstHeader).toBe("number");
  } finally {
    observer.disconnect();
    server.close();
  }
});

it("packs END_STREAM onto the DATA frame produced by end(chunk)", async () => {
  // node sends one DATA frame with END_STREAM for stream.end(data); bun used to append a
  // separate empty END_STREAM frame after it. Counted through the client's own
  // perf_hooks frame stats (which exclude the GOAWAY, as node's do).
  const server = http2.createServer();
  try {
    server.on("stream", stream => {
      stream.respond({ ":status": 200 });
      stream.end("OK");
    });
    const port = await new Promise(resolve => server.listen(0, () => resolve(server.address().port)));

    const received = Promise.withResolvers();
    const observer = new PerformanceObserver((list, obs) => {
      for (const entry of list.getEntries()) {
        if (entry.name !== "Http2Session" || entry.detail.type !== "client") continue;
        obs.disconnect();
        received.resolve(entry.detail.framesReceived);
        return;
      }
    });
    observer.observe({ type: "http2" });

    const client = http2.connect(`http://localhost:${port}`);
    client.on("error", received.reject);
    const req = client.request({ ":path": "/" });
    req.on("error", received.reject);
    req.resume();
    req.on("end", () => client.close());
    req.end();

    // SETTINGS + SETTINGS ack + HEADERS + one DATA carrying END_STREAM.
    expect(await received.promise).toBe(4);
  } finally {
    server.close();
  }
});

it("client connects over a user Duplex that already has a 'data' listener", async () => {
  // A 'data' listener attached before connect() puts the stream in flowing mode, so the
  // peer's first frames can arrive before the connect callback has run. The preface must
  // survive that: it used to be dropped, silently stalling the session.
  const [clientSide, serverSide] = duplexPair();
  const server = http2.createServer();
  server.on("stream", stream => {
    stream.respond({ ":status": 200 });
    stream.end("ok");
  });
  server.emit("connection", serverSide);

  clientSide.on("data", () => {});
  const client = http2.connect("http://localhost", { createConnection: () => clientSide });

  const req = client.request({ ":path": "/" });
  let status = 0;
  let body = "";
  req.setEncoding("utf8");
  req.on("response", headers => {
    status = headers[":status"];
  });
  req.on("data", chunk => (body += chunk));
  await new Promise((resolve, reject) => {
    req.on("end", resolve);
    req.on("error", reject);
    client.on("error", reject);
  });
  expect(status).toBe(200);
  expect(body).toBe("ok");
  client.close();
  server.close();
});

// node's Http2Session.remoteSettings/localSettings getters return `{}` while the session is
// connecting or destroyed and a cached Settings object once the handle is live, so
// `session.remoteSettings.maxConcurrentStreams` is always a safe read. Bun previously returned
// `null` in the connect()-to-first-SETTINGS window, throwing TypeError on property access.
it("remoteSettings/localSettings are never null before the peer's SETTINGS arrives", async () => {
  const server = http2.createServer();
  server.on("stream", stream => {
    stream.respond({ ":status": 200 });
    stream.end("ok");
  });
  const { promise: serverSessionPromise, resolve: resolveServerSession } = Promise.withResolvers();
  server.on("session", resolveServerSession);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

  let client;
  try {
    client = http2.connect(`http://127.0.0.1:${server.address().port}`, {
      settings: { enablePush: false, initialWindowSize: 99999 },
    });
    const { promise: donePromise, resolve: resolveDone, reject: rejectDone } = Promise.withResolvers();
    const { promise: remotePromise, resolve: resolveRemote, reject: rejectRemote } = Promise.withResolvers();
    const { promise: localPromise, resolve: resolveLocal, reject: rejectLocal } = Promise.withResolvers();
    client.on("error", err => {
      rejectRemote(err);
      rejectLocal(err);
      rejectDone(err);
    });
    client.once("remoteSettings", resolveRemote);
    client.once("localSettings", resolveLocal);

    // Synchronously after connect(): node returns a fresh {} each read; bun used to return null.
    expect(client.remoteSettings).toEqual({});
    expect(client.localSettings).toEqual({});
    // The documented use (deciding how many requests to pipeline) must not throw.
    expect(client.remoteSettings.maxConcurrentStreams).toBeUndefined();

    const remote = await remotePromise;
    expect(typeof remote.maxConcurrentStreams).toBe("number");
    // After the peer's SETTINGS arrives the getter reports it and caches the object identity.
    expect(client.remoteSettings).toBe(remote);
    expect(client.remoteSettings).toBe(client.remoteSettings);

    const local = await localPromise;
    // localSettings reflects the ACKed values (the constructor's submitted settings), not pre-ACK.
    expect(local.enablePush).toBe(false);
    expect(local.initialWindowSize).toBe(99999);
    expect(client.localSettings).toBe(local);

    // Server side: the incoming socket is already connected, so the getter falls through to the
    // protocol defaults immediately (never `{}` on the server path).
    const serverSession = await serverSessionPromise;
    expect(typeof serverSession.remoteSettings).toBe("object");
    expect(serverSession.remoteSettings).not.toBeNull();
    expect(typeof serverSession.remoteSettings.maxConcurrentStreams).toBe("number");
    expect(typeof serverSession.localSettings).toBe("object");
    expect(serverSession.localSettings).not.toBeNull();

    client.on("close", resolveDone);
    client.destroy();
    await donePromise;
    // After destroy both getters go back to {}.
    expect(client.remoteSettings).toEqual({});
    expect(client.localSettings).toEqual({});
  } finally {
    client?.destroy();
    server.close();
  }
});

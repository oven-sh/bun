import { bunEnv, bunExe, isCI, nodeExe } from "harness";
import { createTest } from "node-harness";
import fs from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import tls from "node:tls";
import { Duplex } from "stream";
import http2utils from "./helpers";
import { nodeEchoServer, TLS_CERT, TLS_OPTIONS } from "./http2-helpers";
const { afterEach, beforeEach, describe, expect, it, createCallCheckCtx } = createTest(import.meta.path);
function invalidArgTypeHelper(input) {
  if (input === null) return " Received null";

  if (typeof input == "symbol") return ` Received type symbol`;
  if (typeof input == "object")
    return ` Received an instance of ${Object.prototype.toString.call(input).split(" ")[1]?.replace("]", "")?.replace("[", "")}`;
  if (typeof input == "string") return ` Received type string ('${input}')`;
  return ` Received type ${typeof input} (${input})`;
}
for (const nodeExecutable of [nodeExe(), bunExe()]) {
  describe(`${path.basename(nodeExecutable)}`, () => {
    let nodeEchoServer_;

    let HTTPS_SERVER;
    beforeEach(async () => {
      nodeEchoServer_ = await nodeEchoServer();
      HTTPS_SERVER = nodeEchoServer_.url;
    });
    afterEach(async () => {
      nodeEchoServer_.subprocess?.kill?.(9);
    });

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

    function doHttp2Request(url, headers, payload, options, request_options) {
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
        const result = await doHttp2Request(HTTPS_SERVER, { ":path": "/get", "test-header": "test-value" });
        let parsed;
        expect(() => (parsed = JSON.parse(result.data))).not.toThrow();
        expect(parsed.url).toBe(`${HTTPS_SERVER}/get`);
        expect(parsed.headers["test-header"]).toBe("test-value");
      });
      it("should be able to send a POST request", async () => {
        const payload = JSON.stringify({ "hello": "bun" });
        const result = await doHttp2Request(
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
          enablePush: false,
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
          await doHttp2Request(HTTPS_SERVER, { ":path": "/", "test-header": "A".repeat(90000) });
          expect("unreachable").toBe(true);
        } catch (err) {
          expect(err.code).toBe("ERR_HTTP2_STREAM_ERROR");
          expect(err.message).toBe("Stream closed with error code NGHTTP2_COMPRESSION_ERROR");
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
        const tls = TLS_CERT;
        using server = Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          tls: {
            ...tls,
            ca: TLS_CERT.ca,
          },
          fetch() {
            return new Response("hello");
          },
        });
        const url = `https://127.0.0.1:${server.port}`;
        try {
          await doHttp2Request(url, { ":path": "/" }, null, TLS_OPTIONS);
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
              doHttp2Request(`${HTTPS_SERVER}/get`, { ":path": "/get" }, null, {
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
        const promise = doHttp2Request(`${HTTPS_SERVER}/get`, { ":path": "/get" }, null, null, {
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

      it("state should work", async () => {
        const { promise, resolve, reject } = Promise.withResolvers();
        const client = http2.connect(HTTPS_SERVER, TLS_OPTIONS);
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
        req.resume();
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
        expect(client.originSet.length).toBe(1);
        expect(client.pendingSettingsAck).toBeTrue();
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
        expect(req.sentHeaders).toEqual({
          ":authority": "www.example.com",
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
        expect(client.closed).toBeTrue();
        expect(req.closed).toBeTrue();
        expect(req.destroyed).toBeTrue();
        expect(req.rstCode).toBe(http2.constants.NGHTTP2_NO_ERROR);
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
        expect(received_ping).toBeInstanceOf(Buffer);
        expect(received_ping.byteLength).toBe(8);
        expect(received_ping).toEqual(result.payload);
        expect(received_ping).toEqual(Buffer.from("12345678"));
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
        expect(received_ping).toBeInstanceOf(Buffer);
        expect(received_ping.byteLength).toBe(8);
        expect(received_ping).toEqual(result.payload);
      });
      it("ping with wrong payload length events should error", async () => {
        const { promise, resolve, reject } = Promise.withResolvers();
        const client = http2.connect(HTTPS_SERVER, TLS_OPTIONS);
        client.on("error", reject);
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
        const { promise, resolve, reject } = Promise.withResolvers();
        const client = http2.connect(HTTPS_SERVER, TLS_OPTIONS);
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
        () => {
          const { stdout, exitCode } = Bun.spawnSync({
            cmd: [bunExe(), "--smol", "run", path.join(import.meta.dir, "node-http2-memory-leak.js")],
            env: {
              ...bunEnv,
              BUN_JSC_forceRAMSize: (1024 * 1024 * 64).toString("10"),
              HTTP2_SERVER_INFO: JSON.stringify(nodeEchoServer_),
              HTTP2_SERVER_TLS: JSON.stringify(TLS_OPTIONS),
            },
            stderr: "inherit",
            stdin: "inherit",
            stdout: "inherit",
          });
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
      it("should not be able to write on socket", done => {
        const client = http2.connect(HTTPS_SERVER, TLS_OPTIONS, (session, socket) => {
          try {
            client.socket.write("hello");
            client.socket.end();
            expect().fail("unreachable");
          } catch (err) {
            try {
              expect(err.code).toBe("ERR_HTTP2_NO_SOCKET_MANIPULATION");
            } catch (err) {
              done(err);
            }
            done();
          }
        });
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
            expect(result.message).toBe("Session closed with error code NGHTTP2_FRAME_SIZE_ERROR");
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
            expect(result.message).toBe("Session closed with error code NGHTTP2_FRAME_SIZE_ERROR");
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
            expect(result.message).toBe("Session closed with error code NGHTTP2_PROTOCOL_ERROR");
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
            expect(result.message).toBe("Session closed with error code NGHTTP2_FRAME_SIZE_ERROR");
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
            expect(result.message).toBe("Session closed with error code NGHTTP2_FRAME_SIZE_ERROR");
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
          const continuationFrame = new http2utils.ContinuationFrame(
            1,
            http2utils.kFakeResponseHeaders,
            0,
            true,
            false,
          );
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
            expect(result.message).toBe("Session closed with error code NGHTTP2_PROTOCOL_ERROR");
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
            expect(result.message).toBe("Session closed with error code NGHTTP2_FRAME_SIZE_ERROR");
            done();
          } catch (err) {
            done(err);
          } finally {
            server.close();
          }
        });
      });
    });
  });
}

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
            'The "opaqueData" argument must be of type Buffer, ' + `TypedArray, or DataView.${received}`,
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
          `The value of "code" is out of range. It must be >= 0 and <= 4294967295. Received ${code}`,
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

it("http2 server with minimal maxSessionMemory handles multiple requests", async () => {
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
}, 15_000);

it("http2.createServer validates input options", () => {
  // Test invalid options passed to createServer
  const invalidOptions = [1, true, "test", null, Symbol("test")];

  invalidOptions.forEach(invalidOption => {
    expect(() => http2.createServer(invalidOption)).toThrow(
      'The "options" argument must be of type Object.' + invalidArgTypeHelper(invalidOption),
    );
  });

  // Test invalid options.settings passed to createServer
  invalidOptions.forEach(invalidSettingsOption => {
    expect(() => http2.createServer({ settings: invalidSettingsOption })).toThrow(
      'The "options.settings" property must be of type Object.' + invalidArgTypeHelper(invalidSettingsOption),
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
        'The value of "code" is out of range. It must be ' + ">= 0 and <= 4294967295. Received 4294967296",
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

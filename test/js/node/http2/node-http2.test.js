import http2 from "node:http2";

function doHttp2Request(url, headers, payload) {
  const { promise, resolve, reject: promiseReject } = Promise.withResolvers();

  const client = http2.connect(url);
  client.on("error", promiseReject);
  function reject(err) {
    promiseReject(err);
    client.close();
  }

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
    resolve({ data, headers: response_headers });
    client.destroy();
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
    client.destroy();
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
});

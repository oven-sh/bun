import { afterEach, expect, it } from "bun:test";
const { Response, Request, Headers, FormData, File, URL, AbortSignal, URLSearchParams } = globalThis;
afterEach(() => {
  globalThis.Response = Response;
  globalThis.Request = Request;
  globalThis.Headers = Headers;
  globalThis.FormData = FormData;
  globalThis.File = File;
  globalThis.URL = URL;
  globalThis.AbortSignal = AbortSignal;
  globalThis.URLSearchParams = URLSearchParams;
});

it("undici", () => {
  globalThis.Response =
    globalThis.Request =
    globalThis.Headers =
    globalThis.FormData =
    globalThis.File =
    globalThis.URL =
    globalThis.AbortSignal =
    globalThis.URLSearchParams =
      42 as any;

  const undici = require("undici");
  expect(undici).toBeDefined();
  expect(undici.Response).toBe(Response);
  expect(undici.Request).toBe(Request);
  expect(undici.Headers).toBe(Headers);
  expect(undici.FormData).toBe(FormData);
  expect(undici.File).toBe(File);

  const props = [
    "Agent",
    "BalancedPool",
    "Client",
    "CloseEvent",
    "DecoratorHandler",
    "Dispatcher",
    "Dispatcher1Wrapper",
    "EnvHttpProxyAgent",
    "ErrorEvent",
    "EventSource",
    "File",
    "FileReader",
    "FormData",
    "H2CClient",
    "Headers",
    "MessageEvent",
    "MockAgent",
    "MockCallHistory",
    "MockCallHistoryLog",
    "MockClient",
    "MockPool",
    "Pool",
    "ProxyAgent",
    "RedirectHandler",
    "Request",
    "Response",
    "RetryAgent",
    "RetryHandler",
    "RoundRobinPool",
    "SnapshotAgent",
    "Socks5ProxyAgent",
    "WebSocket",
    "WebSocketError",
    "WebSocketStream",
    "buildConnector",
    "cacheStores",
    "caches",
    "connect",
    "createRedirectInterceptor",
    "default",
    "deleteCookie",
    "errors",
    "fetch",
    "getCookies",
    "getGlobalDispatcher",
    "getGlobalOrigin",
    "getSetCookies",
    "install",
    "interceptors",
    "mockErrors",
    "parseCookie",
    "parseMIMEType",
    "ping",
    "pipeline",
    "request",
    "serializeAMimeType",
    "setCookie",
    "setGlobalDispatcher",
    "setGlobalOrigin",
    "stream",
    "upgrade",
    "util",
  ];

  for (const prop of props) {
    expect(undici).toHaveProperty(prop);
  }

  // Note: AbortSignal is not exported. It's just used internally.
});

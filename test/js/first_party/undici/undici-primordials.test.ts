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
      42;

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
    "EnvHttpProxyAgent",
    "ErrorEvent",
    "EventSource",
    "File",
    "FileReader",
    "FormData",
    "Headers",
    "MessageEvent",
    "MockAgent",
    "MockClient",
    "MockPool",
    "Pool",
    "ProxyAgent",
    "RedirectHandler",
    "Request",
    "Response",
    "RetryAgent",
    "RetryHandler",
    "WebSocket",
    "buildConnector",
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
    "interceptors",
    "mockErrors",
    "parseMIMEType",
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

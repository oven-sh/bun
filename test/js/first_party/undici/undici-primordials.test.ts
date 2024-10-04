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
  expect(undici.URL).toBe(URL);
  expect(undici.URLSearchParams).toBe(URLSearchParams);

  // Note: AbortSignal is not exported. It's just used internally.
});

import { expect, test } from "bun:test";
import { Readable } from "node:stream";

// https://github.com/oven-sh/bun/issues/28928
// `new Request(input, init)` must inherit input's body when init does not
// provide its own. Previously Bun hung forever reading the cloned body
// because the inherited stream was dropped.

function streamRequest(payload: string) {
  return new Request("http://localhost/test", {
    method: "POST",
    body: Readable.toWeb(Readable.from([Buffer.from(payload)])),
    duplex: "half",
  });
}

// Per the Fetch spec init.body must "exist and be non-null" to override,
// so missing / `undefined` / explicit `null` all inherit the input body.
test.each([
  ["{ body: undefined }", { body: undefined }],
  ["{}", {}],
  ["{ body: null }", { body: null }],
  ["{ method: 'POST' }", { method: "POST" }],
  ["undefined", undefined],
])("new Request(original, %s) inherits the source body", async (_label, init) => {
  const cloned = new Request(streamRequest("hello"), init as RequestInit | undefined);
  expect(await cloned.text()).toBe("hello");
});

test("new Request(original, init) preserves inherited headers alongside inherited body", async () => {
  const original = new Request("http://localhost/test", {
    method: "POST",
    body: Readable.toWeb(Readable.from([Buffer.from("payload")])),
    headers: { "x-custom": "value", "content-type": "application/json" },
    duplex: "half",
  });
  const cloned = new Request(original, { body: undefined });
  expect(cloned.headers.get("x-custom")).toBe("value");
  expect(cloned.headers.get("content-type")).toBe("application/json");
  expect(await cloned.text()).toBe("payload");
});

test("new Request(original, init) keeps the source readable via the tee's first branch", async () => {
  // Bun extension (mirrors `.clone()` / doClone): tee and park branch[0]
  // on the source, so both sides read the full payload. Node/undici and
  // browsers would throw on the second read per the "create a proxy for a
  // body" spec step; Bun keeps both readable for consistency with `.clone()`.
  const original = streamRequest("reads from both ends");
  const cloned = new Request(original, {});
  expect(await cloned.text()).toBe("reads from both ends");
  expect(await original.text()).toBe("reads from both ends");
});

test("new Request(original, init) keeps the source readable even if `.body` was touched first", async () => {
  // Reading `.body` pins the pre-tee stream in JSC's m_body inline cache;
  // the fix's `bodySetCached` update must refresh that cache to branch[0].
  const original = streamRequest("cache refreshed");
  expect(original.body).toBeInstanceOf(ReadableStream);
  const cloned = new Request(original, { body: undefined });
  expect(await cloned.text()).toBe("cache refreshed");
  expect(await original.text()).toBe("cache refreshed");
});

test("new Request(responseWithStream, init) inherits the Response body (Bun extension)", async () => {
  // Bun accepts a Response as the first Request-constructor argument; the
  // live stream must be tee'd out of `js.gc.stream` or the clone hangs.
  const response = new Response(Readable.toWeb(Readable.from([Buffer.from("from response")])));
  // Touching `.body` moves the stream into `js.gc.stream` via checkBodyStreamRef.
  expect(response.body).toBeInstanceOf(ReadableStream);
  const req = new Request(response, { url: "http://localhost/from-response" });
  expect(await req.text()).toBe("from response");
});

// Per Fetch spec §5.4 the unusable-input check fires for stream bodies
// (where tee would silently return `.Used`) and non-stream bodies (body
// value already `.Used`), under every init shape that leaves the body
// uninherited.
const stringRequest = (payload: string) => new Request("http://localhost/test", { method: "POST", body: payload });
test.each([
  ["stream body, { body: undefined }", streamRequest, { body: undefined } as RequestInit | undefined],
  ["stream body, no init", streamRequest, undefined],
  ["stream body, {}", streamRequest, {}],
  ["string body, no init", stringRequest, undefined],
  ["string body, {}", stringRequest, {}],
])("new Request(disturbedSource) [%s] throws TypeError", async (_label, factory, init) => {
  const original = factory("already consumed");
  await original.text();
  expect(() => new Request(original, init)).toThrow(TypeError);
});

test("new Request(consumedSource, { body: replacement }) succeeds — init supplies the body", async () => {
  // The unusable-input check only fires when the clone would inherit the
  // input body; an explicit init body bypasses it (middleware pattern).
  const original = new Request("http://localhost/test", { method: "POST", body: "original" });
  await original.text();
  const replaced = new Request(original, { body: "replacement" });
  expect(await replaced.text()).toBe("replacement");
});

test("new Request(url, consumedTemplate) throws TypeError — Request-as-init extension", async () => {
  // Bun accepts a Request as the init argument (non-standard but widely
  // used as a template). Per spec, reading the init's body through the
  // extract-a-body algorithm must throw when the source is unusable; the
  // same `throwIfSourceBodyUnusable` guard covers this role.
  const template = new Request("http://template/", { method: "POST", body: "from template" });
  await template.text();
  // @ts-expect-error Bun extension — RequestInit in the WebIDL is a dict.
  expect(() => new Request("http://other/", template)).toThrow(TypeError);
});

test("new Request(response) with no URL leaves the Response stream untouched", async () => {
  // `new Request(responseWithStream)` throws `url is required` post-loop
  // because Response bodies carry no URL. The source-body tee must be
  // deferred until after URL validation so a throw here doesn't lock the
  // Response's live stream or rotate its body cache.
  const response = new Response(Readable.toWeb(Readable.from([Buffer.from("still mine")])));
  const originalBody = response.body;
  expect(() => new Request(response)).toThrow();
  // Response body identity and lock state should be unchanged.
  expect(response.body).toBe(originalBody);
  expect(response.body!.locked).toBe(false);
  // And the stream should still be consumable through the Response.
  expect(await response.text()).toBe("still mine");
});

test("new Request(source, { url: invalid }) leaves the source stream untouched", async () => {
  // Same deferral guarantee for the Request-input path: an invalid URL
  // in init throws post-loop, so the tee must not have run yet.
  const original = streamRequest("still mine");
  const originalBody = original.body;
  expect(() => new Request(original, { url: "::not a url::" } as any)).toThrow();
  expect(original.body).toBe(originalBody);
  expect(original.body!.locked).toBe(false);
  expect(await original.text()).toBe("still mine");
});

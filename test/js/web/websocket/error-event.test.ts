import { expect, test } from "bun:test";

test("WebSocket error event snapshot", async () => {
  const ws = new WebSocket("ws://127.0.0.1:8080");
  const { promise, resolve } = Promise.withResolvers();
  ws.onerror = error => {
    resolve(error);
  };
  const error = await promise;
  expect(error).toMatchInlineSnapshot(`ErrorEvent {
  type: "error",
  message: "WebSocket connection to 'ws://127.0.0.1:8080/' failed: Failed to connect", 
  error: [Error: WebSocket connection to 'ws://127.0.0.1:8080/' failed: Failed to connect]
}`);
  expect(Bun.inspect(error)).toMatchInlineSnapshot(`
    "ErrorEvent {
      type: "error",
      message: "WebSocket connection to 'ws://127.0.0.1:8080/' failed: Failed to connect",
      error: error: WebSocket connection to 'ws://127.0.0.1:8080/' failed: Failed to connect
    ,
    }"
  `);
});

test("ErrorEvent with no message", async () => {
  const error = new ErrorEvent("error");
  expect(error.message).toBe("");
  expect(Bun.inspect(error)).toMatchInlineSnapshot(`
    "ErrorEvent {
      type: "error",
      message: "",
      error: null,
    }"
  `);
  expect(error).toMatchInlineSnapshot(`ErrorEvent {
  type: "error",
  message: "", 
  error: null
}`);
});

test("ErrorEvent message masks the URL password", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("no upgrade here", { status: 404 });
    },
  });
  const ws = new WebSocket(`ws://alice:sekret-password@127.0.0.1:${server.port}/feed?token=tok`);
  const { promise, resolve } = Promise.withResolvers<ErrorEvent>();
  ws.onerror = resolve;
  const error = await promise;
  expect(error.message).toStartWith(
    `WebSocket connection to 'ws://alice:***@127.0.0.1:${server.port}/feed?token=tok' failed`,
  );
  expect(error.message).not.toContain("sekret-password");
  expect(String(error.error)).not.toContain("sekret-password");
});

test.each([
  [
    "wrong scheme",
    "ftp://alice:sekret-password@127.0.0.1/feed",
    "Wrong url scheme for WebSocket ftp://alice:***@127.0.0.1/feed",
  ],
  [
    "fragment",
    "ws://alice:sekret-password@127.0.0.1/feed#x",
    "URL has fragment component ws://alice:***@127.0.0.1/feed#x",
  ],
  ["invalid url", "ws://alice:sekret-password@[::1", "Invalid url for WebSocket ws://alice:***@[::1"],
])("SyntaxError from the constructor masks the URL password (%s)", (_, url, message) => {
  expect(() => new WebSocket(url)).toThrow(message);
});

test("SyntaxError for an invalid proxy URL masks the password", () => {
  expect(() => new WebSocket("ws://127.0.0.1:1/", { proxy: "http://alice:sekret-password@[::1" })).toThrow(
    "Invalid proxy URL: http://alice:***@[::1",
  );
});

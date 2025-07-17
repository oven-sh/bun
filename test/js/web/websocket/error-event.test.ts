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

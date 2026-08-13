import { expect, test } from "bun:test";
import { once } from "node:events";
import net from "node:net";

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

test("event.error of a failed connection has a .stack", async () => {
  const listener = net.createServer();
  await once(listener.listen(0, "127.0.0.1"), "listening");
  const { port } = listener.address() as net.AddressInfo;
  await new Promise(resolve => listener.close(resolve));

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const { promise, resolve } = Promise.withResolvers<ErrorEvent>();
  ws.onerror = resolve;
  const { error } = await promise;

  // The error is created when the connection attempt fails, with no JS on the stack.
  expect(Object.prototype.hasOwnProperty.call(error, "stack")).toBe(true);
  expect(error.stack).toBe(`Error: ${error.message}`);
});

import { expect, test } from "bun:test";

test("WebSocket error event snapshot", async () => {
  const ws = new WebSocket("ws://127.0.0.1:8080");
  const { promise, resolve } = Promise.withResolvers();
  ws.onerror = error => {
    resolve(error);
  };
  const error = await promise;
  expect(error).toMatchSnapshot("Snapshot snapshot");
  expect(Bun.inspect(error)).toMatchSnapshot("Inspect snapshot");
});

test("ErrorEvent with no message", async () => {
  const error = new ErrorEvent("error");
  expect(error.message).toBe("");
  expect(Bun.inspect(error)).toMatchSnapshot("Inspect snapshot");
  expect(error).toMatchSnapshot("Snapshot snapshot");
});

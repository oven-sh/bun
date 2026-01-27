import { expect, test } from "bun:test";
import { MessageChannel, receiveMessageOnPort } from "node:worker_threads";

test("receiveMessageOnPort handles falsy values correctly", () => {
  const { port1, port2 } = new MessageChannel();

  const values = [0, 1, false, true, "", "hello world", null];
  for (const value of values) {
    port1.postMessage(value);
  }

  const received: unknown[] = [];
  for (let i = 0; i < values.length; i++) {
    const result = receiveMessageOnPort(port2);
    if (result !== undefined) {
      received.push(result.message);
    }
  }

  expect(received).toEqual(values);

  // Extra call should return undefined (no more messages)
  expect(receiveMessageOnPort(port2)).toBeUndefined();
});

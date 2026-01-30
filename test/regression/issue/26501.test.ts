// https://github.com/oven-sh/bun/issues/26501
// receiveMessageOnPort should not drop messages with falsy values
import { test, expect } from "bun:test";
import { MessageChannel, receiveMessageOnPort } from "node:worker_threads";

test("receiveMessageOnPort handles all value types including falsy values", () => {
  const { port1, port2 } = new MessageChannel();

  const values = [
    undefined,
    null,
    0,
    1,
    false,
    true,
    "",
    "hello world",
    [],
    {},
    NaN,
  ];

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

  // All values should be received, including falsy ones
  expect(received).toHaveLength(values.length);

  // Check each value (use JSON.stringify for NaN comparison)
  expect(received[0]).toBe(undefined);
  expect(received[1]).toBe(null);
  expect(received[2]).toBe(0);
  expect(received[3]).toBe(1);
  expect(received[4]).toBe(false);
  expect(received[5]).toBe(true);
  expect(received[6]).toBe("");
  expect(received[7]).toBe("hello world");
  expect(received[8]).toEqual([]);
  expect(received[9]).toEqual({});
  expect(Number.isNaN(received[10])).toBe(true);

  // Cleanup
  port1.close();
  port2.close();
});

test("receiveMessageOnPort returns undefined when no message available", () => {
  const { port1, port2 } = new MessageChannel();

  // No messages posted, should return undefined
  const result = receiveMessageOnPort(port2);
  expect(result).toBe(undefined);

  // Cleanup
  port1.close();
  port2.close();
});

test("receiveMessageOnPort returns { message: undefined } for undefined value", () => {
  const { port1, port2 } = new MessageChannel();

  port1.postMessage(undefined);

  const result = receiveMessageOnPort(port2);

  // Should be an object with message property, not undefined
  expect(result).not.toBe(undefined);
  expect(result).toHaveProperty("message");
  expect(result!.message).toBe(undefined);

  // Cleanup
  port1.close();
  port2.close();
});

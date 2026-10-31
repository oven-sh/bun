import { expect, test } from "bun:test";
import { once } from "node:events";
import { IncomingMessage } from "node:http";

type Message = IncomingMessage & Record<symbol, unknown> & { signal: AbortSignal };

const registered = Symbol.for("kAbortController");

function makeMessage() {
  return new IncomingMessage(null as never) as unknown as Message;
}

test("an IncomingMessage keeps its abort controller under a registered symbol", () => {
  const message = makeMessage();
  const key = Object.getOwnPropertySymbols(message).find(symbol => symbol.description === "kAbortController")!;
  expect(key).toBe(registered);
  expect(Symbol.keyFor(key)).toBe("kAbortController");
  expect(message[registered]).toBeNull();
});

test("the signal of an IncomingMessage belongs to the controller under that symbol, and a close aborts it", async () => {
  const message = makeMessage();
  const signal = message.signal;
  const controller = message[registered] as AbortController;
  expect(controller).toBeInstanceOf(AbortController);
  expect(controller.signal).toBe(signal);
  expect(message.signal).toBe(signal);
  expect(signal.aborted).toBe(false);

  const closed = once(message, "close");
  message.destroy();
  await closed;
  expect(signal.aborted).toBe(true);
  expect(message[registered]).toBe(controller);
});

test("the signal of an IncomingMessage that is already destroyed is aborted when it is first read", async () => {
  const message = makeMessage();
  const closed = once(message, "close");
  message.destroy();
  await closed;
  expect(message[registered]).toBeNull();
  expect(message.signal.aborted).toBe(true);
  expect((message[registered] as AbortController).signal).toBe(message.signal);
});

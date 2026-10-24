import { expect, test } from "bun:test";
import { IncomingMessage } from "node:http";

test("an IncomingMessage keeps its abort controller under a symbol that is not registered, like Node.js", () => {
  const message = new IncomingMessage(null as never) as unknown as Record<symbol, unknown>;
  const key = Object.getOwnPropertySymbols(message).find(symbol => symbol.description === "kAbortController")!;
  expect(Symbol.keyFor(key)).toBeUndefined();
  expect(message[key]).toBeNull();
  expect(message[Symbol.for("kAbortController")]).toBeUndefined();
});

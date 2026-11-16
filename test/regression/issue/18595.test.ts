import { expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

test("18595", () => {
  const als = new AsyncLocalStorage<{ counter: number }>();

  const server = createServer((req, res) => {
    const appStore = als.getStore();
    als.run(appStore!, async () => {
      const out = `counter: ${++als.getStore()!.counter}`;
      await new Promise(resolve => setTimeout(resolve, 10));
      res.end(out);
    });
  });

  const { promise, resolve } = Promise.withResolvers();

  als.run({ counter: 0 }, () => {
    server.listen(0, async () => {
      const response = await fetch(`http://localhost:${(server.address() as AddressInfo).port}`);
      expect(await response.text()).toBe("counter: 1");
      server.close();
      resolve();
    });
  });

  return promise;
});

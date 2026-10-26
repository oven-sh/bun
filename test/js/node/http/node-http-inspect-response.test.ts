import { expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import util from "node:util";

const internalFields = ["headerBits", "HeaderShape", "heldChunk", "isFlushScheduled"];

function expectNoInternalFields(response: http.ServerResponse) {
  for (const text of [util.inspect(response), util.inspect(response, { depth: 5 }), Bun.inspect(response)]) {
    for (const field of internalFields) expect(text).not.toContain(field);
  }
}

test("inspecting a ServerResponse that has no connection prints no internal fields", () => {
  const response = new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1 } as any);
  expectNoInternalFields(response);
  expect(util.inspect(response).split("\n").length).toBeLessThan(60);
});

test("inspecting the ServerResponse of a request prints no internal fields", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  await using server = http.createServer((_request, response) => {
    try {
      expectNoInternalFields(response);
      response.setHeader("x-a", "1");
      response.write("a");
      expectNoInternalFields(response);
      resolve();
    } catch (error) {
      reject(error);
    } finally {
      response.end();
    }
  });
  await once(server.listen(0), "listening");
  const fetched = await fetch(`http://localhost:${(server.address() as AddressInfo).port}/`);
  expect(await fetched.text()).toBe("a");
  await promise;
});

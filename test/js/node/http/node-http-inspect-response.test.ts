import { expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import util from "node:util";

const internalFields = ["headerBits", "HeaderShape", "heldChunk", "isFlushScheduled"];

const internalKeys = [
  "kExchange",
  "kAutoDestroyed",
  "fakeSocket",
  "kPipelinedResponses",
  "keepAliveTimeoutSet",
  "socketTimeoutTimer",
  "kArmedTimeout",
  "kIsOpen",
  "kIsPrepared",
  "kHasWaitingResponses",
  "kWritableMark",
  "kReadableMark",
  "kOwnReadableState",
  "kOwnWritableState",
];

function expectNoInternalFields(response: http.ServerResponse) {
  for (const text of [util.inspect(response), util.inspect(response, { depth: 5 }), Bun.inspect(response)]) {
    for (const field of internalFields) expect(text).not.toContain(field);
  }
}

function describeKeys(keys: PropertyKey[]) {
  return keys.map(key => (typeof key === "symbol" ? key.description : key));
}

function expectNoInternalKeys(object: object) {
  const seen = [
    ...describeKeys(Reflect.ownKeys(object)),
    ...describeKeys(Reflect.ownKeys({ ...object })),
    ...describeKeys(Reflect.ownKeys(Object.assign({}, object))),
    ...describeKeys(Reflect.ownKeys(Object.getOwnPropertyDescriptors(object))),
  ];
  expect(seen.filter(key => internalKeys.includes(key as string) || String(key).startsWith("$"))).toEqual([]);
  const text = util.inspect(object, { showHidden: true, depth: 0 });
  for (const key of internalKeys) expect(text).not.toContain(`Symbol(${key})`);
}

async function requestOnce(listener: http.RequestListener, init?: RequestInit) {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  await using server = http.createServer(async (request, response) => {
    try {
      await listener(request, response);
      resolve();
    } catch (error) {
      reject(error);
      if (!response.writableEnded) response.end();
    }
  });
  await once(server.listen(0), "listening");
  const fetched = await fetch(`http://localhost:${(server.address() as AddressInfo).port}/`, init);
  const text = await fetched.text();
  await promise;
  return { status: fetched.status, headers: fetched.headers, text };
}

test("inspecting a ServerResponse that has no connection prints no internal fields", () => {
  const response = new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1 } as any);
  expectNoInternalFields(response);
  expect(util.inspect(response).split("\n").length).toBeLessThan(60);
});

test("inspecting the ServerResponse of a request prints no internal fields", async () => {
  const { text } = await requestOnce((_request, response) => {
    expectNoInternalFields(response);
    response.setHeader("x-a", "1");
    response.write("a");
    expectNoInternalFields(response);
    response.end();
  });
  expect(text).toBe("a");
});

test("messages made without a connection have no internal own keys", () => {
  const request = new http.IncomingMessage(null as any);
  expectNoInternalKeys(request);
  expectNoInternalKeys(new http.OutgoingMessage());
  expectNoInternalKeys(new http.ServerResponse(request));
});

test("the request, the response and the socket of a server have no internal own keys", async () => {
  const { text } = await requestOnce(async (request, response) => {
    const socket = request.socket;
    for (const object of [request, response, socket]) expectNoInternalKeys(object);
    expect(response.socket).toBe(socket);
    socket.setTimeout(60_000);
    response.setHeader("x-a", "1");
    response.write("a");
    for await (const _chunk of request);
    for (const object of [request, response, socket]) expectNoInternalKeys(object);
    const finished = once(response, "finish");
    response.end("b");
    await finished;
    for (const object of [request, response, socket]) expectNoInternalKeys(object);
  });
  expect(text).toBe("ab");
});

test("the request and the response of a client have no internal own keys", async () => {
  await using server = http.createServer((_request, response) => response.end("ok"));
  await once(server.listen(0), "listening");
  const request = http.get({ port: (server.address() as AddressInfo).port, agent: false });
  expectNoInternalKeys(request);
  const [response] = (await once(request, "response")) as [http.IncomingMessage];
  expectNoInternalKeys(response);
  const closed = once(response, "close");
  let text = "";
  for await (const chunk of response) text += chunk;
  expect(text).toBe("ok");
  await closed;
  expectNoInternalKeys(request);
  expectNoInternalKeys(response);
});

test("a readable stream that destroyed itself has no internal own keys", async () => {
  const { Readable } = await import("node:stream");
  const stream = Readable.from(["a"]);
  for await (const _chunk of stream);
  expect(stream.destroyed).toBe(true);
  expectNoInternalKeys(stream);
});

test("a Proxy of the response answers the request", async () => {
  const trapped: PropertyKey[] = [];
  const { status, headers, text } = await requestOnce((_request, response) => {
    const proxy = new Proxy(response, {
      get(target, key, receiver) {
        trapped.push(key);
        return Reflect.get(target, key, receiver);
      },
      set(target, key, value, receiver) {
        trapped.push(key);
        return Reflect.set(target, key, value, receiver);
      },
    });
    proxy.statusCode = 201;
    proxy.setHeader("x-a", "1");
    expect(proxy.getHeader("x-a")).toBe("1");
    expect(proxy.headersSent).toBe(false);
    proxy.write("a");
    expect(proxy.headersSent).toBe(true);
    expect(proxy.socket).toBe(response.socket);
    proxy.end("b");
  });
  expect({ status, header: headers.get("x-a"), text }).toEqual({ status: 201, header: "1", text: "ab" });
  expect(describeKeys(trapped).filter(key => internalKeys.includes(key as string))).toEqual([]);
});

test("a Proxy of a Proxy of the response answers the request", async () => {
  const { text } = await requestOnce((_request, response) => {
    new Proxy(new Proxy(response, {}), {}).end("b");
  });
  expect(text).toBe("b");
});

test("a Proxy of the request reads the body", async () => {
  const { text } = await requestOnce(
    async (request, response) => {
      const proxy = new Proxy(request, {});
      let body = "";
      proxy.setEncoding("utf8");
      proxy.on("data", chunk => (body += chunk));
      await once(proxy, "end");
      response.end(`${proxy.method} ${body}`);
    },
    { method: "POST", body: "hi" },
  );
  expect(text).toBe("POST hi");
});

test("a Proxy of the socket sets a timeout", async () => {
  const { text } = await requestOnce((request, response) => {
    const proxy = new Proxy(request.socket, {});
    proxy.setTimeout(60_000);
    expect(proxy.timeout).toBe(60_000);
    proxy.setTimeout(0);
    response.end(String(proxy.timeout));
  });
  expect(text).toBe("0");
});

test("an object that inherits from the response answers the request", async () => {
  const { text } = await requestOnce((_request, response) => {
    Object.create(response).end("b");
  });
  expect(text).toBe("b");
});

test("a revoked Proxy of the response throws", async () => {
  const { text } = await requestOnce((_request, response) => {
    const { proxy, revoke } = Proxy.revocable(response, {});
    const end = proxy.end;
    revoke();
    expect(() => end.call(proxy, "a")).toThrow(TypeError);
    response.end("b");
  });
  expect(text).toBe("b");
});

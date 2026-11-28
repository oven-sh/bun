import * as grpcJs from "@grpc/grpc-js";
import { GrpcError, Status, type CallOptions } from "bun:grpc";
import { describe, expect, spyOn, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir, tls } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { deflateSync, gzipSync } from "node:zlib";
import { Echo, Message } from "./echo.proto";
import * as other from "./other.proto";

const echo = {
  unary: (request: any) => ({ text: "echo " + request.text, number: request.number + 1, blob: request.blob }),
  async *serverStream(request: any) {
    for (let number = 0; number < request.number; number++) yield { number, blob: request.blob };
  },
  async clientStream(requests: AsyncIterable<any>) {
    let number = 0;
    for await (const request of requests) number += request.number;
    return { number };
  },
  async *bidi(requests: AsyncIterable<any>) {
    for await (const request of requests) yield { text: "echo " + request.text };
  },
};

function serve(implementation: object, routesOptions?: object, serveOptions?: object) {
  const routes = Echo.routes(implementation, routesOptions);
  const server = Bun.serve({ port: 0, http2: true, routes, ...serveOptions });
  const client: any = new Echo.Client(server.url);
  return { server, client, [Symbol.asyncDispose]: () => server.stop(true) };
}

async function failure(call: Promise<unknown> | AsyncIterable<unknown>): Promise<any> {
  try {
    await (call instanceof Promise ? call : Array.fromAsync(call));
  } catch (error) {
    return error;
  }
  throw new Error("the call succeeded");
}

function aborted(signal: AbortSignal) {
  return new Promise(resolve => signal.addEventListener("abort", () => resolve(signal.reason)));
}

function frame(payload: Uint8Array, flag = 0) {
  const prefix = Buffer.alloc(5);
  prefix[0] = flag;
  prefix.writeUInt32BE(payload.length, 1);
  return Buffer.concat([prefix, payload]);
}

/** Sends the next request only after the response to the last one has arrived. */
async function pingPong(client: any) {
  let answered = Promise.withResolvers<void>();
  async function* requests() {
    for (const text of ["a", "b", "c"]) {
      yield { text };
      await answered.promise;
      answered = Promise.withResolvers();
    }
  }
  const texts: string[] = [];
  for await (const response of client.bidi(requests())) {
    texts.push(response.text);
    answered.resolve();
  }
  return texts;
}

async function expectEveryKindOfCall(client: any) {
  expect(await client.unary({ text: "é", number: -2, blob: new Uint8Array([0, 1]) })).toEqual({
    text: "echo é",
    number: -1,
    blob: new Uint8Array([0, 1]),
  });
  const streamed = await Array.fromAsync(client.serverStream({ number: 3 }));
  expect(streamed.map((message: any) => message.number)).toEqual([0, 1, 2]);
  expect(await Array.fromAsync(client.serverStream({ number: 0 }))).toEqual([]);
  expect((await client.clientStream([{ number: 1 }, { number: 2 }])).number).toBe(3);
  expect((await client.clientStream([])).number).toBe(0);
  expect(await pingPong(client)).toEqual(["echo a", "echo b", "echo c"]);
}

describe.concurrent("transports", () => {
  test("cleartext", async () => {
    await using it = serve(echo);
    await expectEveryKindOfCall(it.client);
  });

  test("TLS", async () => {
    await using it = serve(echo, {}, { tls });
    await expectEveryKindOfCall(new Echo.Client(it.server.url, { tls: { ca: tls.cert } }));
    expect(await failure(it.client.unary({}))).toMatchObject({ code: Status.UNAVAILABLE });
  });

  test.skipIf(isWindows)("Unix socket", async () => {
    using dir = tempDir("grpc", {});
    const unix = join(String(dir), "s");
    await using server = Bun.serve({ unix, http2: true, routes: Echo.routes(echo) } as any);
    await expectEveryKindOfCall(new Echo.Client("http://localhost", { unix }));
  });

  test("calls share a connection", async () => {
    await using it = serve({
      unary: (_: any, context: any) => ({ number: context.requestIP().port }),
    });
    const together = await Promise.all(Array.from({ length: 20 }, () => it.client.unary({})));
    const later = await it.client.unary({});
    expect(new Set([...together, later].map(message => message.number)).size).toBe(1);
  });

  test("beside other routes, HTTP/1.1 included", async () => {
    await using server = Bun.serve({
      port: 0,
      http2: true,
      routes: { ...Echo.routes(echo), "/health": new Response("OK") },
    });
    expect(await (await fetch(new URL("/health", server.url))).text()).toBe("OK");
    expect(await new Echo.Client(server.url).unary({ text: "a" })).toMatchObject({ text: "echo a" });
  });

  test("a URL with a path, and options.fetch", async () => {
    const routes = Object.entries(Echo.routes(echo)).map(([path, route]) => ["/api" + path, route]);
    await using server = Bun.serve({ port: 0, http2: true, routes: Object.fromEntries(routes) });
    using session = new Bun.FetchSession();
    const urls: string[] = [];
    const client = new Echo.Client(new URL("/api/", server.url), {
      fetch: (url, init) => (urls.push(url), session.fetch(url, init)),
    });
    expect(await client.unary({ text: "a" })).toMatchObject({ text: "echo a" });
    expect(urls).toEqual([`${server.url.origin}/api/test.v1.Echo/Unary`]);
  });
});

describe.concurrent("routing", () => {
  const unimplemented = { code: Status.UNIMPLEMENTED, message: "The method is not implemented" };

  test("several services on one server and one connection", async () => {
    const named = (text: string) => (_: any, context: any) => ({ text, number: context.requestIP().port });
    await using server = Bun.serve({
      port: 0,
      http2: true,
      routes: {
        ...Echo.routes({ unary: named("test.v1.Echo") }),
        ...other.Echo.routes({ unary: named("test.v2.Echo") }),
        ...other.Health.routes({ check: named("test.v2.Health") }),
      },
    });
    const responses = [
      await new Echo.Client(server.url).unary({}),
      await new other.Echo.Client(server.url).unary({}),
      await new other.Health.Client(server.url).check({}),
    ];
    expect(responses.map(it => it.text)).toEqual(["test.v1.Echo", "test.v2.Echo", "test.v2.Health"]);
    expect(new Set(responses.map(it => it.number)).size).toBe(1);
  });

  test.each([
    ["nothing", {}, undefined, 404],
    ["fetch", {}, () => new Response("fallback"), 200],
    ["a wildcard", { "/*": () => new Response("fallback") }, undefined, 200],
    ["a static wildcard", { "/*": new Response("fallback") }, undefined, 200],
    ["a wildcard for GET", { "/*": { GET: new Response() } }, () => new Response("fallback"), 200],
    ["a wildcard for POST", { "/*": { POST: () => new Response("fallback") } }, undefined, 200],
  ] as [string, object, any, number][])(
    "an unknown method with %s to fall back on",
    async (_, routes, fetch, status) => {
      await using server = Bun.serve({ port: 0, http2: true, routes: { ...routes, ...Echo.routes(echo) }, fetch });
      expect(await failure(new other.Health.Client(server.url).check({}))).toMatchObject(unimplemented);
      const response = await Bun.fetch(new URL("/test.v2.Health/Check", server.url), {
        method: "POST",
        protocol: "http2",
      });
      expect(response.status).toBe(status);
    },
  );

  test("a route for the path of a method that is not a gRPC route", async () => {
    const forbid = () => new Response(null, { headers: { "content-type": "application/grpc", "grpc-status": "7" } });
    for (const routes of [
      { "/test.v2.Health/Check": forbid },
      { "/test.v2.Health/Check": forbid() },
      { "/test.v2.Health/Check": false },
      { "/test.v2.Health/*": forbid },
      { "/test.v2.Health/:method": { POST: forbid } },
    ]) {
      await using server = Bun.serve({
        port: 0,
        http2: true,
        routes: { ...Echo.routes(echo), ...(routes as object) },
        fetch: forbid,
      });
      expect(await failure(new other.Health.Client(server.url).check({}))).toMatchObject({
        code: Status.PERMISSION_DENIED,
      });
    }
  });

  test("one route for every method", async () => {
    const routes = Echo.routes({ unary: (_, context) => ({ text: context.path }) });
    await using server = Bun.serve({ port: 0, http2: true, routes: { "/*": routes["/test.v1.Echo/Unary"] } });
    expect((await new other.Health.Client(server.url).check({})).text).toBe("/test.v2.Health/Check");
  });

  test("reload", async () => {
    const [started, release] = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    await using it = serve({
      unary: () => ({ text: "old" }),
      async clientStream() {
        started.resolve();
        await release.promise;
        return { text: "old" };
      },
    });
    const session = http2.connect(it.server.url);
    try {
      const incomplete = session.request({
        ":method": "POST",
        ":path": "/test.v1.Echo/Unary",
        "content-type": "application/grpc",
      });
      await new Promise(resolve => session.once("connect", () => session.ping(resolve)));
      const running = it.client.clientStream([]);
      await started.promise;

      it.server.reload({ routes: other.Health.routes({ check: () => ({ text: "new" }) }) });
      Bun.gc(true);
      expect(await failure(it.client.unary({}))).toMatchObject(unimplemented);
      expect((await new other.Health.Client(it.server.url).check({})).text).toBe("new");

      release.resolve();
      expect((await running).text).toBe("old");
      incomplete.end(frame(new Uint8Array()));
      expect(Message.decode(Buffer.concat(await Array.fromAsync(incomplete)).subarray(5)).text).toBe("old");
    } finally {
      session.destroy();
    }
  });

  test("a handler can reload or stop its server", async () => {
    await using it = serve({
      clientStream: (_: any, { server }: any) => (
        server.reload({ routes: Echo.routes(stopping) }),
        { text: "reloaded" }
      ),
    });
    const stopping = { clientStream: (_: any, { server }: any) => (server.stop(true), {}) };
    expect((await it.client.clientStream([])).text).toBe("reloaded");
    expect(await failure(it.client.clientStream([]))).toMatchObject({ code: Status.UNAVAILABLE });
  });

  test("stop() waits for the calls", async () => {
    const [started, release] = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    await using it = serve({ unary: () => (started.resolve(), release.promise.then(() => ({ text: "done" }))) });
    const call = it.client.unary({});
    await started.promise;
    expect(it.server.pendingRequests).toBe(1);
    const stopped = it.server.stop();
    release.resolve();
    expect((await call).text).toBe("done");
    await stopped;
    expect(it.server.pendingRequests).toBe(0);
  });

  test("handlers run in the async context of Bun.serve()", async () => {
    const storage = new AsyncLocalStorage<string>();
    await using it = storage.run("stored", () => serve({ unary: () => ({ text: storage.getStore() }) }));
    expect((await it.client.unary({})).text).toBe("stored");
  });
});

describe.concurrent("handlers", () => {
  test("can be methods of a class, and can return any iterable", async () => {
    class Service {
      #text = "private";
      unary() {
        return { text: this.#text };
      }
      async serverStream() {
        return [{ number: 1 }, { number: 2 }];
      }
    }
    await using it = serve(new Service());
    expect((await it.client.unary({})).text).toBe("private");
    expect(await Array.fromAsync(it.client.serverStream({}))).toHaveLength(2);
  });

  test("can return a thenable", async () => {
    await using it = serve({ unary: () => ({ then: (resolve: Function) => resolve({ text: "a" }) }) });
    expect((await it.client.unary({})).text).toBe("a");
  });

  test("a method that is left out is unimplemented", async () => {
    await using it = serve({});
    const calls = [it.client.unary({}), it.client.serverStream({}), it.client.clientStream([]), it.client.bidi([])];
    for (const error of await Promise.all(calls.map(failure))) {
      expect(error).toMatchObject({ code: Status.UNIMPLEMENTED });
    }
  });

  test("can answer before the last request", async () => {
    const closed = Promise.withResolvers<void>();
    await using it = serve({
      async clientStream(requests: AsyncGenerator<any>) {
        return (await requests.next()).value;
      },
    });
    function* endless() {
      try {
        while (true) yield { number: 7 };
      } finally {
        closed.resolve();
      }
    }
    expect((await it.client.clientStream(endless())).number).toBe(7);
    await closed.promise;
  });

  test("can go on after the last request", async () => {
    await using it = serve({
      async *bidi(requests: AsyncIterable<any>) {
        const all = await Array.fromAsync(requests);
        yield* all.reverse();
      },
    });
    const responses = await Array.fromAsync(it.client.bidi([{ text: "a" }, { text: "b" }]));
    expect(responses.map((message: any) => message.text)).toEqual(["b", "a"]);
  });
});

describe.concurrent("metadata", () => {
  const withMetadata = (context: any) => {
    context.responseHeaders.set("x-header", context.headers.get("x-client") + context.headers.get("x-call"));
    context.responseTrailers.set("x-trailer", "t");
    context.responseTrailers.set("grpc-status", "5");
  };

  test.each(["unary", "serverStream"])("%s", async method => {
    await using it = serve({
      unary: (_: any, context: any) => (withMetadata(context), {}),
      *serverStream(_: any, context: any) {
        withMetadata(context);
        yield {};
        context.responseTrailers.set("x-late", "l");
      },
    });
    const client: any = new Echo.Client(it.server.url, { headers: { "x-client": "a", "x-call": "overridden" } });
    const seen: object[] = [];
    const call = client[method](
      {},
      {
        headers: { "x-call": "b" },
        onHeaders: (headers: Headers) => seen.push({ header: headers.get("x-header") }),
        onTrailers: (trailers: Headers) => seen.push(trailers.toJSON()),
      },
    );
    await (method === "unary" ? call : Array.fromAsync(call));
    expect(seen).toEqual([
      { header: "ab" },
      { "grpc-status": "0", "x-trailer": "t", ...(method === "unary" ? {} : { "x-late": "l" }) },
    ]);
  });
});

describe.concurrent("a handler that calls another server", () => {
  test("can pass on the metadata it receives", async () => {
    await using backend = serve({
      async clientStream(requests: AsyncIterable<any>, context: any) {
        context.responseHeaders.set("x-header", context.headers.get("x-call"));
        context.responseTrailers.set("x-trailer", context.host);
        return echo.clientStream(requests);
      },
    });
    const copy = (from: Headers, to: Headers) => from.forEach((value, name) => to.set(name, value));
    await using front = serve({
      unary(_: any, context: any) {
        context.responseHeaders.set("content-length", "1");
        context.responseHeaders.set("grpc-status", "5");
        context.responseTrailers.set("content-length", "1");
        return backend.client.clientStream([{ number: 1 }, { number: 2 }], {
          headers: context.headers,
          onHeaders: (headers: Headers) => copy(headers, context.responseHeaders),
          onTrailers: (trailers: Headers) => copy(trailers, context.responseTrailers),
        });
      },
    });
    const seen: unknown[] = [];
    const { number } = await front.client.unary(
      {},
      {
        headers: { "x-call": "a", "content-length": "1", "grpc-encoding": "snappy" },
        onHeaders: (headers: Headers) => seen.push(headers.get("x-header")),
        onTrailers: (trailers: Headers) => seen.push(trailers.toJSON()),
      },
    );
    expect([number, ...seen]).toEqual([3, "a", { "grpc-status": "0", "x-trailer": backend.server.url.host }]);
  });

  test("passes on the status of an error, and not its trailers", async () => {
    await using backend = serve({
      unary() {
        throw new GrpcError(Status.NOT_FOUND, "gone", { trailers: { "set-cookie": "secret=1" } });
      },
    });
    await using front = serve({ unary: () => backend.client.unary({}) });
    const error = await failure(front.client.unary({}));
    expect([error.code, error.message, error.trailers.has("set-cookie")]).toEqual([Status.NOT_FOUND, "gone", false]);
  });
});

describe.concurrent("errors", () => {
  test("a long message is cut short between characters", async () => {
    await using it = serve({
      unary(request: any) {
        throw new GrpcError(Status.INVALID_ARGUMENT, request.text);
      },
    });
    const error = await failure(it.client.unary({ text: Buffer.alloc(300_000, "☃").toString() }));
    expect(error).toMatchObject({ code: Status.INVALID_ARGUMENT, message: Buffer.alloc(456 * 3, "☃") + "..." });
  });

  test("a GrpcError reaches the client", async () => {
    const message = " 100% ☃\r\n ";
    await using it = serve({
      unary(_: any, context: any) {
        context.responseTrailers.set("x-context", "1");
        throw new GrpcError(Status.NOT_FOUND, message, { trailers: { "x-error": "2" } });
      },
      *serverStream() {
        yield { number: 1 };
        throw new GrpcError(Status.ABORTED);
      },
    });
    const error = await failure(it.client.unary({}));
    expect(error).toBeInstanceOf(GrpcError);
    expect(error).toMatchObject({ name: "GrpcError", code: Status.NOT_FOUND, message });
    expect(error.trailers.toJSON()).toEqual({
      "content-type": "application/grpc",
      "grpc-accept-encoding": "identity,gzip,deflate",
      "grpc-status": "5",
      "grpc-message": "%20100%25 %E2%98%83%0D%0A%20",
      "x-context": "1",
      "x-error": "2",
    });

    const responses = it.client.serverStream({});
    expect((await responses.next()).value.number).toBe(1);
    expect(await failure(responses)).toMatchObject({ code: Status.ABORTED, message: "" });
  });

  test.serial("another error is logged and kept from the client", async () => {
    const secret = new Error("secret");
    using logged = spyOn(console, "error").mockImplementation(() => {});
    await using it = serve({
      unary: () => Promise.reject(secret),
      serverStream: () => 1,
      clientStream: () => ({ number: "1" }),
      bidi: () => Promise.reject(Object.assign(new GrpcError(Status.ABORTED), { code: 0 })),
    });
    const calls = [it.client.unary({}), it.client.serverStream({}), it.client.clientStream([]), it.client.bidi([])];
    for (const error of await Promise.all(calls.map(failure))) {
      expect(error).toMatchObject({ code: Status.UNKNOWN, message: "Unknown error" });
    }
    expect(logged.mock.calls.map(([error]) => error.name).sort()).toEqual([
      "Error",
      "RangeError",
      "TypeError",
      "TypeError",
    ]);
    expect(logged).toHaveBeenCalledWith(secret);
  });

  test.serial("an error that cannot be looked at, and onError that throws", async () => {
    using logged = spyOn(console, "error").mockImplementation(() => {});
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const implementation = { unary: () => Promise.reject(proxy), clientStream: () => Promise.reject(1) };
    await using it = serve(implementation, {
      onError() {
        throw new RangeError();
      },
    });
    expect(await failure(it.client.unary({}))).toMatchObject({ code: Status.UNKNOWN });
    expect(await failure(it.client.clientStream([]))).toMatchObject({ code: Status.UNKNOWN });
    expect(logged.mock.calls.map(([error]) => error.name)).toEqual(["TypeError", "RangeError"]);
  });

  test("onError", async () => {
    const seen: unknown[] = [];
    const implementation = {
      unary(request: any) {
        throw request.text;
      },
    };
    await using it = serve(implementation, {
      onError(error: unknown, context: any) {
        seen.push([error, context.path]);
        if (error === "mapped") return new GrpcError(Status.INVALID_ARGUMENT, "mapped");
      },
    });
    expect(await failure(it.client.unary({ text: "mapped" }))).toMatchObject({ code: Status.INVALID_ARGUMENT });
    expect(await failure(it.client.unary({ text: "other" }))).toMatchObject({ code: Status.UNKNOWN });
    expect(seen).toEqual([
      ["mapped", "/test.v1.Echo/Unary"],
      ["other", "/test.v1.Echo/Unary"],
    ]);
  });

  test("an error from the requests cancels the call and is what it rejects with", async () => {
    const serverSide = Promise.withResolvers();
    const received = Promise.withResolvers<void>();
    await using it = serve({
      async clientStream(requests: AsyncGenerator<any>) {
        await requests.next();
        received.resolve();
        serverSide.resolve(await failure(requests));
        return {};
      },
    });
    const mine = new Error("mine");
    async function* requests() {
      yield {};
      await received.promise;
      throw mine;
    }
    expect(await failure(it.client.clientStream(requests()))).toBe(mine);
    expect(await serverSide.promise).toMatchObject({ code: Status.CANCELLED });
    expect(await failure(it.client.clientStream([{ number: "1" }]))).toBeInstanceOf(TypeError);
  });

  test("nothing listens", async () => {
    const url = "http://127.0.0.1:1/";
    const error = await failure(new Echo.Client(url).unary({}));
    expect(error).toMatchObject({ code: Status.UNAVAILABLE, cause: { code: "ECONNREFUSED" } });

    const cancelled = Promise.withResolvers<void>();
    const requests = new ReadableStream<{}>({ cancel: () => cancelled.resolve() });
    expect(await failure(new Echo.Client(url).clientStream(requests))).toMatchObject({ code: Status.UNAVAILABLE });
    await cancelled.promise;
  });

  test("the server does not speak HTTP/2", async () => {
    await using server = Bun.serve({ port: 0, routes: Echo.routes(echo) });
    const error = await failure(new Echo.Client(server.url).unary({}));
    expect(error).toMatchObject({ code: Status.UNAVAILABLE, cause: { code: "HTTP2Unsupported" } });
  });

  test("the server stops in the middle of a call", async () => {
    await using it = serve({
      async *serverStream(_: any, { signal }: any) {
        yield {};
        await aborted(signal);
      },
    });
    const responses = it.client.serverStream({});
    await responses.next();
    it.server.stop(true);
    expect(await failure(responses)).toMatchObject({ code: Status.UNAVAILABLE });
  });

  test("invalid arguments", async () => {
    const invalidType = expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" });
    const outOfRange = expect.objectContaining({ code: "ERR_OUT_OF_RANGE" });
    expect(() => new Echo.Client("localhost:50051")).toThrow('must start with "http://" or "https://"');
    expect(() => new Echo.Client("http://a", { timeout: -1 })).toThrow(outOfRange);
    expect(() => new Echo.Client("http://a", { maxReceiveMessageLength: -1 })).toThrow(outOfRange);
    expect(() => new Echo.Client("http://a", { fetch: 1 as any })).toThrow(invalidType);
    expect(() => Echo.routes({}, { onError: 1 as any })).toThrow(invalidType);
    expect(() => new GrpcError(0 as any)).toThrow(outOfRange);
    const client: any = new Echo.Client("http://a");
    expect(await failure(client.clientStream({}))).toEqual(invalidType);
    expect(await failure(client.unary({}, { timeout: "1" }))).toEqual(invalidType);
    expect(await failure(client.unary({ number: 0.5 }))).toBeInstanceOf(TypeError);
  });
});

describe.concurrent("deadlines and cancellation", () => {
  test("timeout", async () => {
    const serverSide = Promise.withResolvers();
    await using it = serve({
      async unary(_: any, { signal }: any) {
        serverSide.resolve(await aborted(signal));
        return {};
      },
    });
    const client = new Echo.Client(it.server.url, { timeout: 2 ** 31 - 1 });
    expect(await failure(client.unary({}, { timeout: 200 }))).toMatchObject({ code: Status.DEADLINE_EXCEEDED });
    expect(await serverSide.promise).toBeInstanceOf(GrpcError);
  });

  test.each(["unary", "serverStream", "clientStream", "bidi"])("the server ends %s at the deadline", async method => {
    const reason = Promise.withResolvers();
    const forever = (context: any) => (aborted(context.signal).then(reason.resolve), new Promise(() => {}));
    await using it = serve({
      unary: (_: any, context: any) => forever(context),
      clientStream: (_: any, context: any) => forever(context),
      async *serverStream(_: any, context: any) {
        yield {};
        await forever(context);
      },
      async *bidi(_: any, context: any) {
        await forever(context);
      },
    });
    const call = it.client[method](Echo.methods[method].requestStream ? [{}] : {}, {
      headers: { "grpc-timeout": "20m" },
    });
    const error = await failure(call);
    expect([error.code, error.trailers.get("grpc-status")]).toEqual([Status.DEADLINE_EXCEEDED, "4"]);
    expect(await reason.promise).toMatchObject({ code: Status.DEADLINE_EXCEEDED });
  });

  test("signal", async () => {
    const started = Promise.withResolvers<void>();
    const serverSide = Promise.withResolvers();
    await using it = serve({
      async unary(_: any, { signal }: any) {
        started.resolve();
        serverSide.resolve(await aborted(signal));
        throw new Error("not logged");
      },
    });
    const controller = new AbortController();
    const call = failure(it.client.unary({}, { signal: controller.signal }));
    await started.promise;
    controller.abort("why");
    expect(await call).toMatchObject({ code: Status.CANCELLED, cause: "why" });
    expect(await serverSide.promise).toMatchObject({ name: "GrpcError", code: Status.CANCELLED });
    expect(await failure(it.client.unary({}, { signal: controller.signal }))).toMatchObject({ code: Status.CANCELLED });
  });

  // The timer of a socket ticks every 4 seconds.
  test("idleTimeout ends a silent call, unless it has a deadline or its handler says otherwise", async () => {
    const release = Promise.withResolvers<void>();
    await using it = serve(
      {
        async unary(request: any, context: any) {
          if (request.text === "lifted") context.timeout(0);
          await release.promise;
          return request;
        },
        clientStream: echo.clientStream,
      },
      {},
      { idleTimeout: 1 },
    );
    const sessions = Array.from({ length: 4 }, () => new Bun.FetchSession());
    const [a, b, c, d] = sessions.map(({ fetch }) => new Echo.Client(it.server.url, { fetch }));
    try {
      const kept = [a.unary({ text: "deadline" }, { timeout: 60_000 }), b.unary({ text: "lifted" })];
      const silence = { [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }) };
      // One after the other, so that the calls that are kept outlast two ticks.
      expect(await failure(c.unary({}))).toMatchObject({ code: Status.UNAVAILABLE });
      expect(await failure(d.clientStream(silence))).toMatchObject({ code: Status.UNAVAILABLE });
      release.resolve();
      expect((await Promise.all(kept)).map(message => message.text)).toEqual(["deadline", "lifted"]);
    } finally {
      release.resolve();
      for (const session of sessions) session.close();
    }
  }, 30_000);

  test("idleTimeout applies again to what is left to send once the call has ended", async () => {
    await using it = serve(
      { unary: (_: any, context: any) => (context.timeout(0), { blob: new Uint8Array(1 << 20) }) },
      {},
      { idleTimeout: 1 },
    );
    const session = http2.connect(it.server.url).on("error", () => {});
    try {
      const headers = { ":method": "POST", ":path": "/test.v1.Echo/Unary", "content-type": "application/grpc" };
      const neverRead = session.request(headers).on("error", () => {});
      neverRead.end(frame(new Uint8Array()));
      expect((await once(session, "goaway"))[0]).toBe(http2.constants.NGHTTP2_NO_ERROR);
    } finally {
      session.destroy();
    }
  }, 30_000);

  test("idleTimeout ends a call whose client floods it and does not read", async () => {
    await using it = serve({ bidi: (requests: AsyncIterable<any>) => requests }, {}, { idleTimeout: 1 });
    const session = http2.connect(it.server.url).on("error", () => {});
    try {
      const headers = { ":method": "POST", ":path": "/test.v1.Echo/Bidi", "content-type": "application/grpc" };
      const neverRead = session.request(headers).on("error", () => {});
      const request = frame(Message.encode({ blob: new Uint8Array(1 << 14) }));
      for (let i = 0; i < 128; i++) neverRead.write(request);
      expect((await once(session, "goaway"))[0]).toBe(http2.constants.NGHTTP2_NO_ERROR);
    } finally {
      session.destroy();
    }
  }, 30_000);

  test("an iterator that waits for its next message is closed when the call ends", async () => {
    const closed = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    const waiting = ({ resolve }: (typeof closed)[0]) => ({
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}), return: async () => (resolve(), {}) }),
    });
    await using it = serve({ bidi: () => waiting(closed[0]) });
    const call = it.client.bidi(waiting(closed[1]), { headers: { "grpc-timeout": "20m" } });
    expect(await failure(call)).toMatchObject({ code: Status.DEADLINE_EXCEEDED });
    await Promise.all(closed.map(it => it.promise));
  });

  test("the responses are closed if the call ends before the handler returns them", async () => {
    const [started, closed] = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    await using it = serve({
      async serverStream(_: any, { signal }: any) {
        started.resolve();
        await aborted(signal);
        return new ReadableStream({ cancel: () => closed.resolve() });
      },
    });
    const controller = new AbortController();
    const call = failure(it.client.serverStream({}, { signal: controller.signal }));
    await started.promise;
    controller.abort();
    expect(await call).toMatchObject({ code: Status.CANCELLED });
    await closed.promise;
  });

  test("the context once the call has ended", async () => {
    const contexts: any[] = [];
    await using it = serve({
      unary: (request: any, context: any) => (contexts.push(context), request.number ? new Promise(() => {}) : {}),
    });
    await it.client.unary({}, { headers: { "x-call": "a" } });
    await failure(it.client.unary({ number: 1 }, { headers: { "x-call": "b", "grpc-timeout": "1m" } }));
    Bun.gc(true);
    for (const context of contexts) context.timeout(1);
    expect(contexts.map(it => [it.headers.get("x-call"), it.signal.reason?.code, it.requestIP()])).toEqual([
      ["a", undefined, null],
      ["b", Status.DEADLINE_EXCEEDED, null],
    ]);
    expect(contexts[0].server).toBe(it.server);
    expect(() => contexts[0].timeout(256)).toThrow(expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }));
  });

  test("reading the requests once the handler has answered", async () => {
    const reads: Promise<any>[] = [];
    await using it = serve({
      async clientStream(requests: AsyncGenerator<any>) {
        await requests.next();
        reads.push(failure(requests.next()));
        return {};
      },
    });
    async function* oneThenSilence() {
      yield {};
      await new Promise(() => {});
    }
    await it.client.clientStream(oneThenSilence());
    expect(await reads[0]).toMatchObject({ code: Status.CANCELLED });
  });

  test("leaving the loop over the responses closes the handler", async () => {
    const closed = Promise.withResolvers<void>();
    await using it = serve({
      ...echo,
      *serverStream() {
        try {
          while (true) yield { blob: new Uint8Array(1024) };
        } finally {
          closed.resolve();
        }
      },
    });
    for await (const _ of it.client.serverStream({})) break;
    await closed.promise;
    expect((await it.client.unary({ text: "a" })).text).toBe("echo a");
  });
});

describe.concurrent("sizes", () => {
  const megabyte = new Uint8Array(1 << 20).fill(1);

  test("messages that span many frames", async () => {
    await using it = serve(echo);
    expect(Buffer.compare((await it.client.unary({ blob: megabyte })).blob, megabyte)).toBe(0);
    let total = 0;
    for await (const { blob } of it.client.serverStream({ number: 8, blob: megabyte })) total += blob.length;
    expect(total).toBe(8 << 20);
  });

  test("maxRequestBodySize limits each request, and not the stream", async () => {
    await using it = serve(echo, {}, { maxRequestBodySize: 2 << 20 });
    const requests = Array.from({ length: 4 }, () => ({ number: 1, blob: megabyte }));
    expect((await it.client.clientStream(requests)).number).toBe(4);
    const tooLong = { blob: new Uint8Array(2 << 20) };
    expect(await failure(it.client.unary(tooLong))).toMatchObject({ code: Status.RESOURCE_EXHAUSTED });
    expect(await failure(it.client.clientStream([tooLong]))).toMatchObject({ code: Status.RESOURCE_EXHAUSTED });
  });

  test("a slow handler holds the client back", async () => {
    const release = Promise.withResolvers<void>();
    await using it = serve({
      unary: echo.unary,
      async clientStream(requests: AsyncGenerator<any>) {
        await requests.next();
        await release.promise;
        return echo.clientStream(requests);
      },
    });
    let produced = 0;
    function* requests() {
      for (; produced < 64; produced++) yield { number: 1, blob: megabyte };
    }
    const call = it.client.clientStream(requests());
    let last = -1;
    while (last !== produced) {
      last = produced;
      for (let i = 0; i < 10; i++) await it.client.unary({});
    }
    expect(produced).toBeLessThan(32);
    release.resolve();
    expect((await call).number).toBe(63);
  });

  test("a slow reader holds the handler back", async () => {
    let produced = 0;
    await using it = serve({
      *serverStream() {
        for (; produced < 256; produced++) yield { blob: megabyte };
      },
      unary: () => ({ number: produced }),
    });
    const responses = it.client.serverStream({});
    await responses.next();
    let last = -1;
    while (last !== produced) {
      last = produced;
      for (let i = 0; i < 10; i++) await it.client.unary({});
    }
    expect(produced).toBeLessThan(64);
    await responses.return();
  });

  test.serial("a fast reader does not keep the server from its other work", async () => {
    const turns: number[] = [];
    let turn = 0;
    let immediate = setImmediate(function again() {
      turn++;
      immediate = setImmediate(again);
    });
    await using it = serve({
      *serverStream() {
        while (turns.push(turn) < 32) yield { blob: megabyte };
      },
    });
    // In another process, so that it reads while the server writes.
    await using reader = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const session = require("node:http2").connect(process.argv[1], { settings: { initialWindowSize: 2 ** 30 } });
        session.on("connect", () => {
          session.setLocalWindowSize(2 ** 30);
          const headers = { ":method": "POST", ":path": "/test.v1.Echo/ServerStream", "content-type": "application/grpc" };
          session.request(headers).on("end", () => session.close()).resume().end(Buffer.alloc(5));
        });`,
        it.server.url.href,
      ],
      env: bunEnv,
      stdio: ["ignore", "inherit", "inherit"],
    });
    try {
      expect(await reader.exited).toBe(0);
    } finally {
      clearImmediate(immediate);
    }
    expect(new Set(turns).size).toBeGreaterThan(12);
  });

  // Validating the values takes 3 seconds in a release build, and minutes in a debug build.
  test.serial.skipIf(isDebug || isASAN)("metadata that totals 4 GiB or more resets the stream", async () => {
    const value = Buffer.alloc(2 ** 28, "a").toString("latin1");
    const fill = (headers: Headers) => {
      for (let i = 0; i < 16; i++) headers.append("set-cookie", value);
    };
    const closed = Promise.withResolvers<void>();
    await using it = serve({
      unary: (_: any, context: any) => (fill(context.responseTrailers), {}),
      *serverStream(_: any, context: any) {
        fill(context.responseHeaders);
        try {
          while (true) yield {};
        } finally {
          closed.resolve();
        }
      },
      clientStream: echo.clientStream,
    });
    expect(await failure(it.client.unary({}))).toMatchObject({ code: Status.INTERNAL });
    expect(await failure(it.client.serverStream({}))).toMatchObject({ code: Status.INTERNAL });
    await closed.promise;
    expect((await it.client.clientStream([{ number: 1 }])).number).toBe(1);
  });

  test("maxReceiveMessageLength", async () => {
    const fits = { blob: new Uint8Array(98) };
    const tooLong = { blob: new Uint8Array(99) };
    const exhausted = { code: Status.RESOURCE_EXHAUSTED, message: "Received a message longer than 100 bytes" };
    const reflect = { unary: (request: any) => request, clientStream: echo.clientStream };
    await using strict = serve(reflect, { maxReceiveMessageLength: 100 });
    await strict.client.unary(fits);
    expect(await failure(strict.client.unary(tooLong))).toMatchObject(exhausted);
    expect(await failure(strict.client.clientStream([fits, tooLong]))).toMatchObject(exhausted);

    await using lenient = serve(reflect);
    const client = new Echo.Client(lenient.server.url, { maxReceiveMessageLength: 100 });
    await client.unary(fits);
    expect(await failure(client.unary(tooLong))).toMatchObject(exhausted);
    const overDefault = { blob: new Uint8Array(4 << 20) };
    expect(await failure(lenient.client.unary(overDefault))).toMatchObject({ code: Status.RESOURCE_EXHAUSTED });
  });
});

describe.concurrent("what the server makes of a request", () => {
  const message = Message.encode({ text: "a" });
  const zeros = Message.encode({ blob: new Uint8Array(5 << 20) });

  async function send(url: URL, headers: object, ...chunks: Uint8Array[]) {
    const session = http2.connect(url);
    try {
      const stream = session.request({
        ":method": "POST",
        ":path": "/test.v1.Echo/Unary",
        "content-type": "application/grpc",
        ...headers,
      });
      let trailers: http2.IncomingHttpHeaders | undefined;
      stream.on("trailers", received => (trailers = received));
      const [response, body] = [once(stream, "response"), Array.fromAsync(stream)];
      for (const chunk of chunks) await new Promise(resolve => stream.write(chunk, resolve));
      stream.end();
      return { headers: (await response)[0], body: Buffer.concat(await body), trailers };
    } finally {
      session.close();
    }
  }

  test("the response is headers, a message and trailers", async () => {
    await using it = serve(echo);
    const { headers, body, trailers } = await send(it.server.url, {}, frame(message));
    expect(headers).toMatchObject({ ":status": 200, "content-type": "application/grpc" });
    expect(headers).not.toContainKey("content-length");
    expect(body.toString("hex")).toBe("000000000a0a066563686f20611001");
    expect(Object.entries(trailers!)).toEqual([["grpc-status", "0"]]);
  });

  test("a failure is only trailers, unless the handler has headers to send", async () => {
    await using it = serve({
      unary(_: any, context: any) {
        if (context.headers.has("x-header")) context.responseHeaders.set("x-header", "1");
        throw new GrpcError(Status.UNAVAILABLE, "later", { trailers: { "x-trailer": "2" } });
      },
    });
    const status = { "grpc-status": "14", "grpc-message": "later", "x-trailer": "2" };
    const only = await send(it.server.url, {}, frame(message));
    expect(only.headers).toMatchObject({ ":status": 200, "content-type": "application/grpc", ...status });
    expect(only.trailers).toBeUndefined();
    const apart = await send(it.server.url, { "x-header": "1" }, frame(message));
    expect(apart.headers).toMatchObject({ ":status": 200, "x-header": "1" });
    expect(apart.headers).not.toContainKey("grpc-status");
    expect(apart.trailers).toMatchObject(status);
  });

  test("the metadata", async () => {
    await using it = serve({ unary: (_: any, context: any) => ({ text: JSON.stringify(context.headers) }) });
    const headers = { "te": "trailers", "grpc-timeout": "1H", "x-empty": "", "x-twice": ["a", "b"], "x-latin1": "é" };
    const { body } = await send(it.server.url, headers, frame(message));
    expect(JSON.parse(Message.decode(body.subarray(5)).text)).toEqual({
      "x-empty": "",
      "x-twice": "a, b",
      "x-latin1": "é",
    });
  });

  test("the deadline passes before the request is complete", async () => {
    await using it = serve(echo);
    const session = http2.connect(it.server.url);
    try {
      const stream = session.request({
        ":method": "POST",
        ":path": "/test.v1.Echo/Unary",
        "content-type": "application/grpc",
        "grpc-timeout": "1n",
      });
      expect((await once(stream, "response"))[0]["grpc-status"]).toBe("4");
    } finally {
      session.destroy();
    }
  });

  test.each([
    ["one byte at a time", {}, [...frame(message)].map(byte => new Uint8Array([byte])), "0"],
    ["an empty message", {}, [frame(new Uint8Array())], "0"],
    ["+proto", { "content-type": "application/grpc+proto" }, [frame(message)], "0"],
    ["gzip", { "grpc-encoding": "gzip" }, [frame(gzipSync(message), 1)], "0"],
    [
      "gzip in two members",
      { "grpc-encoding": "gzip" },
      [frame(Buffer.concat([gzipSync(message.subarray(0, 1)), gzipSync(message.subarray(1))]), 1)],
      "0",
    ],
    ["gzip of an empty message", { "grpc-encoding": "gzip" }, [frame(gzipSync(new Uint8Array()), 1)], "0"],
    ["a parameter of the content type", { "content-type": "Application/gRPC ; a=b" }, [frame(message)], "0"],
    ["deflate", { "grpc-encoding": "deflate" }, [frame(deflateSync(message), 1)], "0"],
    ["an encoding that is not used", { "grpc-encoding": "snappy" }, [frame(message)], "0"],
    ["a timeout longer than a timer", { "grpc-timeout": "99999999H" }, [frame(message)], "0"],
    ["an unsupported encoding", { "grpc-encoding": "snappy" }, [frame(message, 1)], "12"],
    ["compression without an encoding", {}, [frame(message, 1)], "13"],
    ["an unknown flag", { "grpc-encoding": "gzip" }, [frame(message, 2)], "13"],
    ["broken gzip", { "grpc-encoding": "gzip" }, [frame(message, 1)], "13"],
    ["half of a gzip stream", { "grpc-encoding": "gzip" }, [frame(gzipSync(message).subarray(0, 12), 1)], "13"],
    ["gzip that expands over the limit", { "grpc-encoding": "gzip" }, [frame(gzipSync(zeros), 1)], "8"],
    ["a length over the limit", {}, [Buffer.from("00ffffffff", "hex")], "8"],
    ["no message", {}, [], "12"],
    ["two messages", {}, [frame(message), frame(message)], "12"],
    ["half a prefix", {}, [Buffer.from("0000", "hex")], "13"],
    ["half a message", {}, [frame(message).subarray(0, 6)], "13"],
    ["a message and a half", {}, [frame(message), Buffer.from("00", "hex")], "12"],
    ["a malformed message", {}, [frame(new Uint8Array([0x0a]))], "13"],
    ["a timeout without a unit", { "grpc-timeout": "1" }, [frame(message)], "13"],
    ["a timeout without digits", { "grpc-timeout": "S" }, [frame(message)], "13"],
    ["a timeout of 9 digits", { "grpc-timeout": "100000000n" }, [frame(message)], "13"],
  ] as [string, object, Uint8Array[], string][])("%s", async (_, headers, chunks, status) => {
    await using it = serve(echo);
    const response = await send(it.server.url, headers, ...chunks);
    expect((response.trailers ?? response.headers)["grpc-status"]).toBe(status);
  });

  test.each([
    ["one byte at a time", {}, [...frame(message), ...frame(message)].map(byte => new Uint8Array([byte])), 2, "0"],
    ["all at once", {}, [Buffer.concat([frame(message), frame(new Uint8Array()), frame(message)])], 3, "0"],
    ["gzip or not", { "grpc-encoding": "gzip" }, [frame(gzipSync(message), 1), frame(message)], 2, "0"],
    ["a message and a half", {}, [Buffer.concat([frame(message), Buffer.from("00", "hex")])], 1, "13"],
    ["a length over the limit", {}, [Buffer.concat([frame(message), Buffer.from("00ffffffff", "hex")])], 1, "8"],
    ["broken gzip", { "grpc-encoding": "gzip" }, [frame(message), frame(message, 1)], 1, "13"],
  ] as [string, object, Uint8Array[], number, string][])(
    "a stream of requests: %s",
    async (_, headers, chunks, count, status) => {
      const seen = Promise.withResolvers();
      await using it = serve({
        async clientStream(requests: AsyncIterable<any>) {
          let read = 0;
          try {
            for await (const _ of requests) read++;
            seen.resolve([read, 0]);
          } catch (error: any) {
            seen.resolve([read, error.code]);
          }
          return {};
        },
      });
      const response = await send(it.server.url, { ":path": "/test.v1.Echo/ClientStream", ...headers }, ...chunks);
      expect((response.trailers ?? response.headers)["grpc-status"]).toBe(status);
      expect(await seen.promise).toEqual([count, Number(status)]);
    },
  );

  test("what is not gRPC", async () => {
    await using it = serve(echo);
    const url = new URL("/test.v1.Echo/Unary", it.server.url);
    const post = (type: string, protocol: "http2" | "http1.1") =>
      fetch(url, { method: "POST", headers: { "content-type": type }, body: frame(message), protocol });
    expect((await post("application/json", "http2")).status).toBe(415);
    expect((await post("application/grpc-web", "http2")).status).toBe(415);
    expect((await post("application/grpc", "http1.1")).status).toBe(505);
  });
});

describe.concurrent("what the client makes of a response", () => {
  const message = Message.encode({ text: "a" });
  const grpc = { ":status": 200, "content-type": "application/grpc" };

  async function respondWith(
    handler: (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => void,
    options?: CallOptions,
  ) {
    const server = http2.createServer().on("stream", (stream, headers) =>
      handler(
        stream.on("error", () => {}),
        headers,
      ),
    );
    await once(server.listen(0, "127.0.0.1"), "listening");
    using session = new Bun.FetchSession();
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const client = new Echo.Client(url, { fetch: session.fetch });
      return await client.unary({}, options).catch((error: unknown) => error);
    } finally {
      server.close();
    }
  }

  const withTrailers = (headers: object, body: Uint8Array, trailers: object) => (stream: http2.ServerHttp2Stream) => {
    stream.respond({ ...grpc, ...headers }, { waitForTrailers: true });
    stream.on("wantTrailers", () => stream.sendTrailers(trailers as any));
    stream.end(body);
  };
  const ok = { "grpc-status": "0" };

  test("the request", async () => {
    let seen: any;
    await respondWith((stream, headers) => ((seen = headers), stream.respond(grpc, { endStream: true })));
    expect(seen).toMatchObject({
      ":method": "POST",
      ":scheme": "http",
      ":path": "/test.v1.Echo/Unary",
      "content-type": "application/grpc",
      "te": "trailers",
      "user-agent": "grpc-bun/" + Bun.version,
    });
    expect(seen).not.toContainKey("grpc-timeout");
  });

  test.serial("a length that is only declared takes no memory", async () => {
    const server = http2.createServer().on("stream", stream => {
      stream.on("error", () => {}).respond(grpc);
      stream.write(Buffer.concat([frame(message), Buffer.from("004000000001", "hex")]));
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    using session = new Bun.FetchSession();
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const client = new Echo.Client(url, { fetch: session.fetch, maxReceiveMessageLength: 2 ** 30 });
      const controller = new AbortController();
      const responses = client.serverStream({}, { signal: controller.signal });
      await responses.next();
      const second = failure(responses.next());
      await new Promise(setImmediate);
      Bun.gc(true);
      expect(process.memoryUsage().external).toBeLessThan(2 ** 29);
      controller.abort();
      expect(await second).toMatchObject({ code: Status.CANCELLED });
    } finally {
      server.close();
    }
  });

  test.each([
    [99_999_999, "99999999m"],
    [100_000_001, "100001S"],
  ])("a timeout of %d ms", async (timeout, expected) => {
    let seen: unknown;
    await respondWith(
      (stream, headers) => ((seen = headers["grpc-timeout"]), stream.respond(grpc, { endStream: true })),
      { timeout },
    );
    expect(seen).toBe(expected);
  });

  test.each([
    ["gzip", withTrailers({ "grpc-encoding": "gzip" }, frame(gzipSync(message), 1), ok), { text: "a" }],
    ["two messages", withTrailers({}, Buffer.concat([frame(message), frame(message)]), ok), { code: 12 }],
    ["no message", withTrailers({}, new Uint8Array(), ok), { code: 12 }],
    ["half a message", withTrailers({}, frame(message).subarray(0, 6), ok), { code: 13 }],
    ["a malformed message", withTrailers({}, frame(new Uint8Array([0x0a])), ok), { code: 13 }],
    ["a message and an error", withTrailers({}, frame(message), { "grpc-status": "9" }), { code: 9 }],
    ["an unknown status", withTrailers({}, frame(message), { "grpc-status": "17" }), { code: 2 }],
    ["trailers without a status", withTrailers({}, frame(message), { other: "1" }), { code: 13 }],
    [
      "a malformed grpc-message",
      withTrailers({}, new Uint8Array(), { "grpc-status": "3", "grpc-message": "100%" }),
      { code: 3, message: "100%" },
    ],
    ["another content type", withTrailers({ "content-type": "text/html" }, frame(message), ok), { code: 2 }],
    ["a wrong content-length", withTrailers({ "content-length": "1" }, frame(message), ok), { code: 13 }],
    ["no trailers", (stream: any) => (stream.respond(grpc), stream.end(frame(message))), { code: 13 }],
    [
      "trailers only",
      (stream: any) => stream.respond({ ...grpc, "grpc-status": "7", "grpc-message": "n%6F" }, { endStream: true }),
      { code: 7, message: "no" },
    ],
    ["a reset", (stream: any) => stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR), { code: 13 }],
    ["a cancellation", (stream: any) => stream.close(http2.constants.NGHTTP2_CANCEL), { code: 1 }],
    ["too much load", (stream: any) => stream.close(http2.constants.NGHTTP2_ENHANCE_YOUR_CALM), { code: 8 }],
    ["weak TLS", (stream: any) => stream.close(http2.constants.NGHTTP2_INADEQUATE_SECURITY), { code: 7 }],
    ["a refusal", (stream: any) => stream.close(http2.constants.NGHTTP2_REFUSED_STREAM), { code: 14 }],
  ] as [string, any, object][])("%s", async (_, handler, expected) => {
    expect(await respondWith(handler)).toMatchObject(expected);
  });

  test.each([
    ["8", frame(message), { code: 10 }],
    ["0", new Uint8Array(), { code: 10 }],
  ])("trailers that come long after content-length: %s is complete", async (length, body, expected) => {
    const result = await respondWith(stream => {
      stream.respond({ ...grpc, "content-length": length }, { waitForTrailers: true });
      stream.on("wantTrailers", () => {
        // The answer to a PING shows that the client has read what came before it.
        stream.session!.ping(() => stream.sendTrailers({ "grpc-status": "10" }));
      });
      stream.end(body);
    });
    expect(result).toMatchObject(expected);
  });

  test.each([
    [302, 2],
    [400, 13],
    [401, 16],
    [403, 7],
    [404, 12],
    [429, 14],
    [500, 2],
    [502, 14],
    [503, 14],
    [504, 14],
  ])("the HTTP status %d", async (status, code) => {
    const result = await respondWith(stream =>
      stream.respond({ ":status": status, location: "/" }, { endStream: true }),
    );
    expect(result).toMatchObject({ code });
  });
});

describe.concurrent("@grpc/grpc-js", () => {
  const definition = Object.fromEntries(
    Object.entries(Echo.methods).map(([name, method]: [string, any]) => [
      name,
      {
        ...method,
        requestSerialize: (message: object) => Buffer.from(Message.encode(message)),
        responseSerialize: (message: object) => Buffer.from(Message.encode(message)),
        requestDeserialize: Message.decode,
        responseDeserialize: Message.decode,
      },
    ]),
  );

  test("as the server", async () => {
    const server = new grpcJs.Server();
    server.addService(definition, {
      unary(call: any, callback: any) {
        if (call.request.text === "fail") return callback({ code: grpcJs.status.NOT_FOUND, details: "100% ☃" });
        callback(null, echo.unary(call.request));
      },
      async serverStream(call: any) {
        for await (const message of echo.serverStream(call.request)) call.write(message);
        call.end();
      },
      clientStream: async (call: any, callback: any) => callback(null, await echo.clientStream(call)),
      bidi(call: any) {
        call.on("data", (request: any) => call.write({ text: "echo " + request.text })).on("end", () => call.end());
      },
    });
    const bound = Promise.withResolvers<number>();
    server.bindAsync("127.0.0.1:0", grpcJs.ServerCredentials.createInsecure(), (error, port) =>
      error ? bound.reject(error) : bound.resolve(port),
    );
    try {
      const client = new Echo.Client(`http://127.0.0.1:${await bound.promise}`);
      await expectEveryKindOfCall(client);
      expect(await failure(client.unary({ text: "fail" }))).toMatchObject({ code: 5, message: "100% ☃" });
    } finally {
      server.forceShutdown();
    }
  });

  test("as the client", async () => {
    await using it = serve(
      {
        ...echo,
        unary(request: any, context: any) {
          context.responseTrailers.set("x-trailer", context.headers.get("x-header"));
          if (request.text === "fail") throw new GrpcError(Status.NOT_FOUND, "100% ☃");
          return echo.unary(request);
        },
      },
      {},
      { hostname: "127.0.0.1" },
    );
    const Client = grpcJs.makeGenericClientConstructor(definition, "Echo");
    const client: any = new Client(it.server.url.host, grpcJs.credentials.createInsecure(), {
      "grpc.default_compression_algorithm": grpcJs.compressionAlgorithms.gzip,
      "grpc.enable_http_proxy": 0,
    });
    const metadata = new grpcJs.Metadata();
    metadata.set("x-header", "h");
    const unary = (text: string) =>
      new Promise<any>(resolve =>
        client.unary({ text }, metadata, (error: any, value: any) => resolve(error ?? value)),
      );
    try {
      expect(await unary("a")).toMatchObject({ text: "echo a" });
      const error = await unary("fail");
      expect([error.code, error.details, error.metadata.get("x-trailer")]).toEqual([5, "100% ☃", ["h"]]);
      expect(await Array.fromAsync(client.serverStream({ number: 3 }))).toHaveLength(3);

      const sum = Promise.withResolvers<any>();
      const upload = client.clientStream((error: any, value: any) => sum.resolve(error ?? value));
      upload.write({ number: 1 });
      upload.end({ number: 2 });
      expect(await sum.promise).toMatchObject({ number: 3 });

      const chat = client.bidi();
      chat.write({ text: "a" });
      expect((await once(chat, "data"))[0].text).toBe("echo a");
      chat.end();
      expect((await once(chat, "status"))[0].code).toBe(0);
    } finally {
      client.close();
    }
  });
});

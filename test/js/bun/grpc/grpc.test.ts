import * as grpcJs from "@grpc/grpc-js";
import { GrpcError, Status } from "bun:grpc";
import { describe, expect, spyOn, test } from "bun:test";
import { isWindows, tempDir, tls } from "harness";
import { once } from "node:events";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { deflateSync, gzipSync } from "node:zlib";
import { Echo, Message } from "./echo.proto";

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
      unary: (_: any, { server, request }: any) => ({ number: server.requestIP(request).port }),
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
        context.responseTrailers.set("x-trailer", context.request.headers.get("host"));
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
    expect(error.trailers.toJSON()).toEqual({ "grpc-status": "5", "grpc-message": "gone" });
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
    });
    const calls = [it.client.unary({}), it.client.serverStream({}), it.client.clientStream([])];
    for (const error of await Promise.all(calls.map(failure))) {
      expect(error).toMatchObject({ code: Status.UNKNOWN, message: "Unknown error" });
    }
    expect(logged.mock.calls.map(([error]) => error.name).sort()).toEqual(["Error", "TypeError", "TypeError"]);
    expect(logged).toHaveBeenCalledWith(secret);
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
        seen.push([error, new URL(context.request.url).pathname]);
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
    const server = Bun.serve({ port: 0, fetch: () => new Response() });
    const { url } = server;
    await server.stop(true);
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
      async unary(_: any, { request, signal }: any) {
        const timeout = request.headers.get("grpc-timeout");
        await aborted(signal);
        serverSide.resolve(timeout);
        return {};
      },
    });
    const client = new Echo.Client(it.server.url, { timeout: 2 ** 31 - 1 });
    expect(await failure(client.unary({}, { timeout: 200 }))).toMatchObject({ code: Status.DEADLINE_EXCEEDED });
    expect(await serverSide.promise).toBe("200m");
  });

  test("a timeout of more than 8 digits is sent in seconds", async () => {
    await using it = serve({ unary: (_: any, { request }: any) => ({ text: request.headers.get("grpc-timeout") }) });
    expect((await it.client.unary({}, { timeout: 100_000_001 })).text).toBe("100001S");
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
    await serverSide.promise;
    expect(await failure(it.client.unary({}, { signal: controller.signal }))).toMatchObject({ code: Status.CANCELLED });
  });

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

  test("the handler is closed if the client cancels before the response starts", async () => {
    const [responded, closed] = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    const { POST } = Echo.routes({
      *serverStream() {
        try {
          yield {};
        } finally {
          closed.resolve();
        }
      },
    })["/test.v1.Echo/ServerStream"];
    await using server = Bun.serve({
      port: 0,
      http2: true,
      async fetch(request, server) {
        const response = await POST(request, server);
        responded.resolve();
        await aborted(request.signal);
        return response;
      },
    });
    const controller = new AbortController();
    const call = failure(new Echo.Client(server.url).serverStream({}, { signal: controller.signal }));
    await responded.promise;
    controller.abort();
    expect(await call).toMatchObject({ code: Status.CANCELLED });
    await closed.promise;
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

  test("a stream of requests can be longer than maxRequestBodySize", async () => {
    await using it = serve(echo, {}, { maxRequestBodySize: 1 << 20 });
    const requests = Array.from({ length: 4 }, () => ({ number: 1, blob: megabyte }));
    expect((await it.client.clientStream(requests)).number).toBe(4);
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
      const [response, trailers, body] = [once(stream, "response"), once(stream, "trailers"), Array.fromAsync(stream)];
      for (const chunk of chunks) await new Promise(resolve => stream.write(chunk, resolve));
      stream.end();
      return { headers: (await response)[0], trailers: (await trailers)[0], body: Buffer.concat(await body) };
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
    expect(Object.entries(trailers)).toEqual([["grpc-status", "0"]]);
  });

  test.each([
    ["one byte at a time", {}, [...frame(message)].map(byte => new Uint8Array([byte])), "0"],
    ["an empty message", {}, [frame(new Uint8Array())], "0"],
    ["+proto", { "content-type": "application/grpc+proto" }, [frame(message)], "0"],
    ["gzip", { "grpc-encoding": "gzip" }, [frame(gzipSync(message), 1)], "0"],
    ["deflate", { "grpc-encoding": "deflate" }, [frame(deflateSync(message), 1)], "0"],
    ["an encoding that is not used", { "grpc-encoding": "snappy" }, [frame(message)], "0"],
    ["a timeout longer than a timer", { "grpc-timeout": "99999999H" }, [frame(message)], "0"],
    ["an unsupported encoding", { "grpc-encoding": "snappy" }, [frame(message, 1)], "12"],
    ["compression without an encoding", {}, [frame(message, 1)], "13"],
    ["an unknown flag", { "grpc-encoding": "gzip" }, [frame(message, 2)], "13"],
    ["broken gzip", { "grpc-encoding": "gzip" }, [frame(message, 1)], "13"],
    ["gzip that expands over the limit", { "grpc-encoding": "gzip" }, [frame(gzipSync(zeros), 1)], "8"],
    ["a length over the limit", {}, [Buffer.from("00ffffffff", "hex")], "8"],
    ["no message", {}, [], "12"],
    ["two messages", {}, [frame(message), frame(message)], "12"],
    ["half a prefix", {}, [Buffer.from("0000", "hex")], "13"],
    ["half a message", {}, [frame(message).subarray(0, 6)], "13"],
    ["a message and a half", {}, [frame(message), Buffer.from("00", "hex")], "13"],
    ["a malformed message", {}, [frame(new Uint8Array([0x0a]))], "13"],
    ["a malformed timeout", { "grpc-timeout": "1" }, [frame(message)], "13"],
  ] as [string, object, Uint8Array[], string][])("%s", async (_, headers, chunks, status) => {
    await using it = serve(echo);
    expect((await send(it.server.url, headers, ...chunks)).trailers["grpc-status"]).toBe(status);
  });

  test.serial("a length that is only declared takes no memory", async () => {
    let read = Promise.withResolvers<void>();
    await using it = serve(
      {
        async clientStream(requests: AsyncGenerator<any>) {
          await requests.next();
          const second = requests.next();
          read.resolve();
          return (await second).value;
        },
      },
      { maxReceiveMessageLength: 2 ** 30 },
    );
    const session = http2.connect(it.server.url);
    try {
      const before = process.memoryUsage().arrayBuffers;
      const stream = session.request({
        ":method": "POST",
        ":path": "/test.v1.Echo/ClientStream",
        "content-type": "application/grpc",
      });
      stream.on("error", () => {}).write(Buffer.concat([frame(message), Buffer.from("004000000001", "hex")]));
      await read.promise;
      await it.client.unary({}).catch(() => {});
      Bun.gc(true);
      expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(2 ** 29);
    } finally {
      session.destroy();
    }
  });

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

  async function respondWith(handler: (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => void) {
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
      return await new Echo.Client(url, { fetch: session.fetch }).unary({}).catch((error: unknown) => error);
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

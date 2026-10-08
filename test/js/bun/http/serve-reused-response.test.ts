import { serve } from "bun";
import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { describe, expect, it, jest } from "bun:test";
import { bunEnv, bunExe } from "harness";
import net from "node:net";
import { connectH2, request as h2Request } from "./serve-http2-helpers";

// A fetch handler that returns a Response whose body has already been used
// (most often the same Response object returned for every request) must invoke
// the error handler instead of silently sending a 200 with an empty body.
describe("returning a Response with an already-used body", () => {
  const alreadyUsedError = {
    code: "ERR_BODY_ALREADY_USED",
    name: "TypeError",
    message:
      "Response body already used. A Response body can only be sent once; create a new Response for each request.",
  };

  const reusedBodies = {
    string: () => new Response("cached-route-body"),
    "Uint8Array": () => new Response(new TextEncoder().encode("cached-route-body")),
    stream: () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("cached-route-body"));
            controller.close();
          },
        }),
      ),
  };

  it.each(Object.keys(reusedBodies) as (keyof typeof reusedBodies)[])(
    "returning the same %s-bodied Response twice calls the error handler",
    async kind => {
      const cached = reusedBodies[kind]();
      const errors: unknown[] = [];
      await using server = serve({
        port: 0,
        fetch() {
          return cached;
        },
        error(err: any) {
          errors.push({ code: err.code, name: err.constructor.name, message: err.message });
          return new Response("handled", { status: 500 });
        },
      });

      // The first response sends the body and disturbs it.
      const first = await fetch(server.url);
      expect(await first.text()).toBe("cached-route-body");
      expect(first.status).toBe(200);
      expect(cached.bodyUsed).toBe(true);

      // Returning the disturbed Response again must surface an error, not an empty 200.
      const second = await fetch(server.url);
      expect(await second.text()).toBe("handled");
      expect(second.status).toBe(500);
      const third = await fetch(server.url);
      expect(await third.text()).toBe("handled");
      expect(third.status).toBe(500);

      expect(errors).toEqual([alreadyUsedError, alreadyUsedError]);
    },
  );

  // Several Responses can adopt one stream while nothing has read it. Sending the first Response
  // uses the stream up, so the next Response around it has no body left to send.
  const sharedStreams = {
    "a ReadableStream": () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("cached-route-body"));
          controller.close();
        },
      }),
    'a type: "direct" ReadableStream': () =>
      new ReadableStream({
        type: "direct",
        pull(controller) {
          controller.write("cached-route-body");
          controller.close();
        },
      }),
  };

  it.each(Object.keys(sharedStreams) as (keyof typeof sharedStreams)[])(
    "returning another Response around %s that was already sent calls the error handler",
    async kind => {
      const stream = sharedStreams[kind]();
      const responses = [new Response(stream), new Response(stream), new Response(stream)];
      const errors: unknown[] = [];
      await using server = serve({
        port: 0,
        fetch() {
          return responses.shift()!;
        },
        error(err: any) {
          errors.push({ code: err.code, name: err.constructor.name, message: err.message });
          return new Response("handled", { status: 500 });
        },
      });

      const first = await fetch(server.url);
      expect(await first.text()).toBe("cached-route-body");
      expect(first.status).toBe(200);

      const second = await fetch(server.url);
      expect(await second.text()).toBe("handled");
      expect(second.status).toBe(500);
      const third = await fetch(server.url);
      expect(await third.text()).toBe("handled");
      expect(third.status).toBe(500);

      const streamUsedError = {
        code: "ERR_STREAM_CANNOT_PIPE",
        name: "Error",
        message: "Stream already used, please create a new one",
      };
      expect(errors).toEqual([streamUsedError, streamUsedError]);
    },
  );

  it("returning a Response whose body was consumed before returning calls the error handler", async () => {
    const errors: unknown[] = [];
    await using server = serve({
      port: 0,
      async fetch() {
        const response = new Response("consumed before returning");
        await response.text();
        return response;
      },
      error(err: any) {
        errors.push({ code: err.code, name: err.constructor.name, message: err.message });
        return new Response("handled", { status: 500 });
      },
    });

    const response = await fetch(server.url);
    expect(await response.text()).toBe("handled");
    expect(response.status).toBe(500);
    expect(errors).toEqual([alreadyUsedError]);
  });

  // The upstream body arrives after the handler returns, so the consumer is still waiting on it.
  it.concurrent.each([
    ["GET", { status: 500, body: "handled", errors: [alreadyUsedError] }],
    // HEAD sends no body, so it has nothing to refuse.
    ["HEAD", { status: 200, body: "", errors: [] }],
  ])("%s for a fetch() Response that a pending text() reads leaves the body to text()", async (method, expected) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { createServer } = require("node:net");
        const { once } = require("node:events");
        const sendBody = Promise.withResolvers();
        const upstream = createServer(socket => {
          socket.once("data", async () => {
            socket.write("HTTP/1.1 200 OK\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n");
            await sendBody.promise;
            socket.end("5\\r\\nhello\\r\\n0\\r\\n\\r\\n");
          });
        }).listen(0, "127.0.0.1");
        await once(upstream, "listening");
        let consumed;
        const errors = [];
        const server = Bun.serve({
          port: 0,
          async fetch() {
            const response = await fetch("http://127.0.0.1:" + upstream.address().port);
            consumed = response.text();
            return response;
          },
          error(err) {
            errors.push({ code: err.code, name: err.constructor.name, message: err.message });
            return new Response("handled", { status: 500 });
          },
        });
        const response = await fetch(server.url, { method: ${JSON.stringify(method)} });
        const body = await response.text();
        sendBody.resolve();
        console.log(JSON.stringify({ status: response.status, body, errors, consumed: await consumed }));
        await server.stop(true);
        upstream.close();
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ ...expected, consumed: "hello" });
    expect(exitCode).toBe(0);
  });

  it("a Response that is not reused keeps working", async () => {
    const error = jest.fn();
    await using server = serve({
      port: 0,
      fetch() {
        return new Response("fresh");
      },
      error,
    });

    for (let i = 0; i < 3; i++) {
      const response = await fetch(server.url);
      expect(await response.text()).toBe("fresh");
      expect(response.status).toBe(200);
    }
    expect(error).not.toHaveBeenCalled();
  });

  it("a Response reused through a static route keeps working", async () => {
    // Static routes snapshot the body at registration, so reuse is allowed there.
    await using server = serve({
      port: 0,
      routes: {
        "/static": new Response("static-body"),
      },
      fetch() {
        return new Response("fallback");
      },
    });

    for (let i = 0; i < 3; i++) {
      const response = await fetch(new URL("/static", server.url));
      expect(await response.text()).toBe("static-body");
      expect(response.status).toBe(200);
    }
  });

  it("without an error handler, logs the error and responds with 500", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const cached = new Response("cached-route-body");
        const server = Bun.serve({
          port: 0,
          development: false,
          fetch() {
            return cached;
          },
        });
        const first = await fetch(server.url);
        console.log(first.status, JSON.stringify(await first.text()));
        const second = await fetch(server.url);
        console.log(second.status, JSON.stringify(await second.text()));
        server.stop(true);`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe('200 "cached-route-body"\n500 "Something went wrong!"\n');
    expect(stderr).toContain("Response body already used");
    // The error is reported like any other unhandled error thrown from the fetch handler.
    expect(exitCode).toBe(1);
  });
});

// A Response without a body has nothing that a send uses up, so a handler can keep one and return
// it for every request. The server reads its headers. It does not take or edit them.
describe("returning the same Response without a body for every request", () => {
  type Answer = { status: number; headers: Record<string, string> };

  async function answer(url: string | URL, method = "GET"): Promise<Answer> {
    const res = await fetch(url, { method, redirect: "manual" });
    await res.arrayBuffer();
    const headers = Object.fromEntries(res.headers);
    delete headers.date;
    return { status: res.status, headers };
  }

  async function threeAnswers(url: string | URL, method = "GET") {
    return [await answer(url, method), await answer(url, method), await answer(url, method)];
  }

  const cors = {
    "access-control-allow-origin": "https://app.example",
    "access-control-allow-headers": "authorization",
  };
  const challenge = { "www-authenticate": 'Basic realm="shop"', "cache-control": "no-store" };
  const kept: Record<string, { make: () => Response; status: number; headers: Record<string, string> }> = {
    "a redirect": { make: () => Response.redirect("/login", 302), status: 302, headers: { location: "/login" } },
    "a 204 with CORS headers": {
      make: () => new Response(null, { status: 204, headers: cors }),
      status: 204,
      headers: cors,
    },
    "a 401": { make: () => new Response(null, { status: 401, headers: challenge }), status: 401, headers: challenge },
    "a 304 with an ETag and a Content-Length": {
      make: () => new Response(null, { status: 304, headers: new Headers({ etag: '"v1"', "content-length": "42" }) }),
      status: 304,
      headers: { etag: '"v1"', "content-length": "42" },
    },
    "an undefined body": {
      make: () => new Response(undefined, { headers: { "x-kept": "1" } }),
      status: 200,
      headers: { "x-kept": "1" },
    },
    "an empty string body": {
      make: () => new Response("", { headers: { "x-kept": "1" } }),
      status: 200,
      headers: { "x-kept": "1" },
    },
    "headers that were read before the first send": {
      make: () => {
        const response = new Response(null, { status: 204, headers: cors });
        response.headers.get("access-control-allow-origin");
        return response;
      },
      status: 204,
      headers: cors,
    },
  };

  // Each way a handler can hand a Response to the server, given the kept Response of each path.
  const doors: Record<string, (responses: Record<string, Response>) => Partial<Bun.Serve.Options<undefined>>> = {
    "the fetch handler": responses => ({ fetch: req => responses[new URL(req.url).pathname] }),
    "a fetch handler that resolves later": responses => ({
      async fetch(req) {
        await new Promise(resolve => setImmediate(resolve));
        return responses[new URL(req.url).pathname];
      },
    }),
    "a route function": responses => ({
      routes: Object.fromEntries(Object.keys(responses).map(path => [path, () => responses[path]])),
    }),
    "the error handler": responses => ({
      fetch(req) {
        throw Object.assign(new Error("handler failed"), { path: new URL(req.url).pathname });
      },
      error: (err: any) => responses[err.path],
    }),
  };

  it.each(Object.keys(doors))("through %s, every answer has the headers of the first answer", async door => {
    const cases = ["GET", "HEAD"].flatMap(method =>
      Object.entries(kept).map(([name, shape], i) => ({
        name: `${method} ${name}`,
        path: `/${method}/${i}`,
        method,
        shape,
        response: shape.make(),
      })),
    );
    await using server = serve({
      port: 0,
      ...doors[door](Object.fromEntries(cases.map(c => [c.path, c.response]))),
    } as Bun.Serve.Options<undefined>);

    const seen: Record<string, Answer[]> = {};
    const expected: Record<string, unknown[]> = {};
    for (const { name, path, method, shape } of cases) {
      const answers = await threeAnswers(new URL(path, server.url), method);
      seen[name] = answers;
      expected[name] = [
        { status: shape.status, headers: expect.objectContaining(shape.headers) },
        answers[0],
        answers[0],
      ];
    }
    expect(seen).toEqual(expected);
  });

  // HEAD on a Response without a body sends the handler's framing header as GET would (#15355).
  it.each([
    ["Content-Length", { "content-length": "1234" }],
    ["Transfer-Encoding", { "transfer-encoding": "chunked" }],
  ])("every HEAD answer has the handler's %s", async (_name, framing) => {
    const response = new Response(null, { headers: { ...framing, "x-kept": "1" } });
    await using server = serve({ port: 0, fetch: () => response });

    const answers = await threeAnswers(server.url, "HEAD");
    expect(answers).toEqual([
      { status: 200, headers: expect.objectContaining({ ...framing, "x-kept": "1" }) },
      answers[0],
      answers[0],
    ]);
  });

  // HEAD sends no body, and it does not refuse a Response whose body it has sized before.
  it("every HEAD answer has the headers of a kept Response with a body", async () => {
    const response = new Response("abc", { headers: { "x-kept": "1" } });
    await using server = serve({ port: 0, fetch: () => response });

    const answers = await threeAnswers(server.url, "HEAD");
    expect(answers.map(({ status, headers }) => ({ status, kept: headers["x-kept"] }))).toEqual([
      { status: 200, kept: "1" },
      { status: 200, kept: "1" },
      { status: 200, kept: "1" },
    ]);
  });

  it.each([
    ["were read before the first send", true],
    ["were not read before the first send", false],
  ])("a send leaves the Response as it was when its headers %s", async (_name, readFirst) => {
    const headers = { "cache-control": "no-store", "content-length": "0", "x-kept": "1" };
    const response = new Response(null, { status: 204, headers });
    if (readFirst) expect(Object.fromEntries(response.headers)).toEqual(headers);
    await using server = serve({ port: 0, fetch: () => response });

    expect((await answer(server.url)).status).toBe(204);
    expect({
      bodyUsed: response.bodyUsed,
      headers: Object.fromEntries(response.headers),
      clone: Object.fromEntries(response.clone().headers),
      asInit: Object.fromEntries(new Response(null, response).headers),
    }).toEqual({ bodyUsed: false, headers, clone: headers, asInit: headers });
  });

  it("a header that changes between two answers is in the next answer", async () => {
    const response = new Response(null, { status: 204, headers: { "x-kept": "1", "x-count": "1" } });
    await using server = serve({ port: 0, fetch: () => response });

    const first = await answer(server.url);
    response.headers.set("x-count", "2");
    const second = await answer(server.url);
    response.headers.delete("x-count");
    const third = await answer(server.url);

    expect(
      [first, second, third].map(({ headers }) => ({ kept: headers["x-kept"], count: headers["x-count"] })),
    ).toEqual([
      { kept: "1", count: "1" },
      { kept: "1", count: "2" },
      { kept: "1", count: undefined },
    ]);
  });

  it("two requests in flight get the same headers", async () => {
    const response = new Response(null, { status: 204, headers: { "x-kept": "1" } });
    const bothStarted = Promise.withResolvers<void>();
    let started = 0;
    await using server = serve({
      port: 0,
      async fetch() {
        if (++started === 2) bothStarted.resolve();
        await bothStarted.promise;
        return response;
      },
    });

    const answers = await Promise.all([answer(server.url), answer(server.url)]);
    expect(answers.map(({ status, headers }) => ({ status, kept: headers["x-kept"] }))).toEqual([
      { status: 204, kept: "1" },
      { status: 204, kept: "1" },
    ]);
  });

  // HTTP/2 frames the body itself: the handler's Content-Length and Transfer-Encoding stay on the
  // Response and are not sent.
  it("over HTTP/2, every answer has the headers of the first answer", async () => {
    const response = new Response(null, {
      headers: { "content-length": "5", "transfer-encoding": "chunked", "x-kept": "1" },
    });
    await using server = serve({ port: 0, http2: true, fetch: () => response });
    const session = await connectH2(server.port!, false);
    try {
      const answers: unknown[] = [];
      for (let i = 0; i < 3; i++) {
        const { status, headers } = await h2Request(session, { ":method": "GET", ":path": "/" });
        answers.push({
          status,
          kept: headers["x-kept"],
          contentLength: headers["content-length"],
          transferEncoding: headers["transfer-encoding"],
        });
      }
      const each = { status: 200, kept: "1", contentLength: "0", transferEncoding: undefined };
      expect(answers).toEqual([each, each, each]);
    } finally {
      session.close();
    }
    expect(Object.fromEntries(response.headers)).toEqual({
      "content-length": "5",
      "transfer-encoding": "chunked",
      "x-kept": "1",
    });
  });

  // The Response owns its header list until it is collected, so the list counts in the size
  // that the Response reports to the garbage collector.
  it("the size estimate of a Response includes its headers", () => {
    const value = Buffer.alloc(1024, "v").toString();
    const headers: Record<string, string> = {};
    for (let i = 0; i < 64; i++) headers[`x-header-${i}`] = value;

    expect(estimateShallowMemoryUsageOf(new Response(null, { headers }))).toBeGreaterThan(
      estimateShallowMemoryUsageOf(new Response(null)) + 64 * 1024,
    );
    // Response.redirect() makes its Location header natively.
    expect(estimateShallowMemoryUsageOf(Response.redirect("https://example.com/" + value))).toBeGreaterThanOrEqual(
      estimateShallowMemoryUsageOf(Response.redirect("https://example.com/")) + 1024,
    );
  });

  // The server drops the Response of a request that it does not answer: the client left, the
  // request became a WebSocket, or the server stopped. Only a stream body is cancelled then. A
  // Response without a body stays as it was, so the handler can return it again.
  describe("a request that the server does not answer leaves the Response unused", () => {
    const shapes = [
      { make: () => new Response(null, { status: 401, headers: challenge }), status: 401, headers: challenge },
      { make: () => new Response("", { headers: { "x-kept": "1" } }), status: 200, headers: { "x-kept": "1" } },
      { make: () => new Response(null, { status: 204, headers: cors }), status: 204, headers: cors },
    ];
    type Drop = (req: Request, server: Bun.Server<undefined>, response: Response, i: number) => unknown;

    // `/<i>` answers with kept Response i. `/drop/<i>` is the request that `drop` leaves without an answer.
    function setup(drop: Drop) {
      const kept = shapes.map(shape => shape.make());
      const errors: unknown[] = [];
      const options = {
        port: 0,
        fetch(req: Request, server: Bun.Server<undefined>) {
          const [, first, second] = new URL(req.url).pathname.split("/");
          return first === "drop" ? drop(req, server, kept[+second], +second) : kept[+first];
        },
        websocket: { message() {} },
        error(err: any) {
          errors.push(err.code);
          return new Response("handled", { status: 500 });
        },
      } as unknown as Bun.Serve.Options<undefined>;
      return { kept, errors, options };
    }

    async function expectUnused(url: URL, kept: Response[], errors: unknown[]) {
      const seen: Answer[][] = [];
      for (const i of shapes.keys()) seen.push(await threeAnswers(new URL(`/${i}`, url)));
      expect({ seen, bodyUsed: kept.map(response => response.bodyUsed), errors }).toEqual({
        seen: shapes.map(({ status, headers }, i) => [
          { status, headers: expect.objectContaining(headers) },
          seen[i][0],
          seen[i][0],
        ]),
        bodyUsed: shapes.map(() => false),
        errors: [],
      });
    }

    it.each(["close", "reset"] as const)("the client leaves by a %s while the handler awaits", async how => {
      const started = shapes.map(() => Promise.withResolvers<void>());
      const returned = shapes.map(() => Promise.withResolvers<void>());
      const { kept, errors, options } = setup(async (req, _server, response, i) => {
        const aborted = Promise.withResolvers<void>();
        req.signal.addEventListener("abort", () => aborted.resolve());
        started[i].resolve();
        await aborted.promise;
        returned[i].resolve();
        return response;
      });
      await using server = serve(options);

      for (const i of shapes.keys()) {
        const socket = net.connect(server.port!, "127.0.0.1");
        socket.on("error", err => started[i].reject(err));
        socket.write(`GET /drop/${i} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
        await started[i].promise;
        if (how === "reset") socket.resetAndDestroy();
        else socket.destroy();
        await returned[i].promise;
      }
      await expectUnused(server.url, kept, errors);
    });

    it.each([
      ["a handler", (response: Response) => response],
      ["an async handler", async (response: Response) => response],
    ] as const)("%s returns the Response behind server.upgrade()", async (_name, give) => {
      const { kept, errors, options } = setup((req, server, response) => {
        server.upgrade(req);
        return give(response);
      });
      await using server = serve(options);

      for (const i of shapes.keys()) {
        const url = new URL(`/drop/${i}`, server.url);
        url.protocol = "ws:";
        const closed = Promise.withResolvers<void>();
        const ws = new WebSocket(url);
        ws.onopen = () => ws.close();
        ws.onerror = () => closed.reject(new Error("the WebSocket did not open"));
        ws.onclose = () => closed.resolve();
        await closed.promise;
      }
      await expectUnused(server.url, kept, errors);
    });

    it("server.stop(true) closes the request while the handler awaits", async () => {
      const started = shapes.map(() => Promise.withResolvers<void>());
      const returned = shapes.map(() => Promise.withResolvers<void>());
      const release = Promise.withResolvers<void>();
      const { kept, errors, options } = setup(async (_req, _server, response, i) => {
        started[i].resolve();
        await release.promise;
        returned[i].resolve();
        return response;
      });
      {
        await using server = serve(options);
        const closed = [...shapes.keys()].map(i => {
          const { promise, resolve } = Promise.withResolvers<void>();
          const socket = net.connect(server.port!, "127.0.0.1");
          // The server closes this connection: a reset is as good as a close here.
          socket.on("error", () => resolve());
          socket.on("close", () => resolve());
          socket.write(`GET /drop/${i} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
          return promise;
        });
        await Promise.all(started.map(({ promise }) => promise));
        await server.stop(true);
        await Promise.all(closed);
        release.resolve();
        await Promise.all(returned.map(({ promise }) => promise));
      }

      // A new server over the same Response objects.
      await using next = serve(options);
      await expectUnused(next.url, kept, errors);
    });
  });
});

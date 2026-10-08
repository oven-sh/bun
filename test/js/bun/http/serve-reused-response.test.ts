import { serve } from "bun";
import { describe, expect, it, jest } from "bun:test";
import { bunEnv, bunExe } from "harness";
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
});

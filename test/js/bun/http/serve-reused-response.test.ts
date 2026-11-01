import { serve } from "bun";
import { describe, expect, it, jest } from "bun:test";
import { bunEnv, bunExe } from "harness";

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

// The server drops the Response of a request that it does not answer: the client left, the
// request became a WebSocket, or the server stopped. A Response without a body stays unused
// then, so a handler that keeps one can return it again.
describe("a request that the server does not answer", () => {
  const bodiless = [
    { make: () => new Response(null, { status: 404 }), status: 404 },
    { make: () => new Response(""), status: 200 },
    { make: () => new Response(null, { status: 204 }), status: 204 },
  ];
  type Drop = (req: Request, server: any, response: Response, i: number) => unknown;

  // `/<i>` answers with kept Response i. `/drop/<i>` is the request that `drop` leaves unanswered.
  function setup(drop: Drop) {
    const kept = bodiless.map(shape => shape.make());
    const errors: unknown[] = [];
    const options: any = {
      port: 0,
      fetch(req: Request, server: any) {
        const [, first, second] = new URL(req.url).pathname.split("/");
        return first === "drop" ? drop(req, server, kept[+second], +second) : kept[+first];
      },
      websocket: { message() {} },
      error(err: any) {
        errors.push(err.code);
        return new Response("handled", { status: 500 });
      },
    };
    return { kept, errors, options };
  }

  async function expectUnused(url: URL, kept: Response[], errors: unknown[]) {
    const statuses: number[][] = [];
    for (const i of bodiless.keys()) {
      const row: number[] = [];
      for (let n = 0; n < 3; n++) {
        const res = await fetch(new URL(`/${i}`, url));
        await res.arrayBuffer();
        row.push(res.status);
      }
      statuses.push(row);
    }
    expect({ statuses, bodyUsed: kept.map(response => response.bodyUsed), errors }).toEqual({
      statuses: bodiless.map(({ status }) => [status, status, status]),
      bodyUsed: bodiless.map(() => false),
      errors: [],
    });
  }

  it("leaves a Response without a body unused when the client aborts", async () => {
    const started = bodiless.map(() => Promise.withResolvers<void>());
    const returned = bodiless.map(() => Promise.withResolvers<void>());
    const { kept, errors, options } = setup(async (req, _server, response, i) => {
      const aborted = Promise.withResolvers<void>();
      req.signal.addEventListener("abort", () => aborted.resolve());
      started[i].resolve();
      await aborted.promise;
      returned[i].resolve();
      return response;
    });
    await using server = serve(options);

    for (const i of bodiless.keys()) {
      const controller = new AbortController();
      const request = fetch(new URL(`/drop/${i}`, server.url), { signal: controller.signal });
      await started[i].promise;
      controller.abort();
      await expect(request).rejects.toMatchObject({ name: "AbortError" });
      await returned[i].promise;
    }
    await expectUnused(server.url, kept, errors);
  });

  it.each([
    ["a handler", (response: Response) => response],
    ["an async handler", async (response: Response) => response],
  ] as const)("leaves it unused when %s returns it behind server.upgrade()", async (_name, give) => {
    const { kept, errors, options } = setup((req, server, response) => {
      server.upgrade(req);
      return give(response);
    });
    await using server = serve(options);

    for (const i of bodiless.keys()) {
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

  it("leaves it unused when server.stop(true) closes the request while the handler awaits", async () => {
    const started = bodiless.map(() => Promise.withResolvers<void>());
    const returned = bodiless.map(() => Promise.withResolvers<void>());
    const release = Promise.withResolvers<void>();
    const { kept, errors, options } = setup(async (_req, _server, response, i) => {
      started[i].resolve();
      await release.promise;
      returned[i].resolve();
      return response;
    });
    {
      await using server = serve(options);
      // The server closes these connections, so each request ends in a rejection.
      const closed = [...bodiless.keys()].map(i =>
        fetch(new URL(`/drop/${i}`, server.url)).then(
          res => res.status,
          () => "closed",
        ),
      );
      await Promise.all(started.map(({ promise }) => promise));
      await server.stop(true);
      expect(await Promise.all(closed)).toEqual(bodiless.map(() => "closed"));
      release.resolve();
      await Promise.all(returned.map(({ promise }) => promise));
    }

    // A new server over the same Response objects.
    await using next = serve(options);
    await expectUnused(next.url, kept, errors);
  });

  // Unchanged: a body that has bytes, and a stream, are still given up when the request is dropped.
  it("still marks a body with content used", async () => {
    let cancelled = 0;
    const withBody = [
      new Response("kept-body"),
      new Response(new TextEncoder().encode("kept-body")),
      new Response(
        new ReadableStream({
          cancel() {
            cancelled++;
          },
        }),
      ),
    ];
    const started = withBody.map(() => Promise.withResolvers<void>());
    const returned = withBody.map(() => Promise.withResolvers<void>());
    await using server = serve({
      port: 0,
      async fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/turn") return new Response(null, { status: 204 });
        const i = +path.slice(1);
        const aborted = Promise.withResolvers<void>();
        req.signal.addEventListener("abort", () => aborted.resolve());
        started[i].resolve();
        await aborted.promise;
        returned[i].resolve();
        return withBody[i];
      },
    });

    for (const i of withBody.keys()) {
      const controller = new AbortController();
      const request = fetch(new URL(`/${i}`, server.url), { signal: controller.signal });
      await started[i].promise;
      controller.abort();
      await expect(request).rejects.toMatchObject({ name: "AbortError" });
      await returned[i].promise;
    }
    // The server drops a Response after its handler returns it. One more request waits for that.
    expect((await fetch(new URL("/turn", server.url))).status).toBe(204);
    expect({ bodyUsed: withBody.map(response => response.bodyUsed), cancelled }).toEqual({
      bodyUsed: [true, true, true],
      cancelled: 1,
    });
  });
});

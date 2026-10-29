import { serve } from "bun";
import { describe, expect, it, jest } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A fetch handler that returns a Response whose body has already been used
// (most often the same Response object returned for every request) must invoke
// the error handler instead of silently sending a 200 with an empty body.
describe.concurrent("returning a Response with an already-used body", () => {
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

  // getReader() starts a native-backed stream, which sets bodyUsed before anything is read.
  it.each([
    ["string", () => new Response("whole body")],
    ["Blob", () => new Response(new Blob(["whole body"]))],
    ["fetch()", (upstream: string) => fetch(upstream)],
  ])("a %s body is sent whole after getReader() and releaseLock()", async (_, makeResponse) => {
    const error = jest.fn();
    await using upstream = serve({ port: 0, fetch: () => new Response("whole body") });
    await using server = serve({
      port: 0,
      async fetch() {
        const response = await makeResponse(`http://127.0.0.1:${upstream.port}/`);
        response.body!.getReader().releaseLock();
        return response;
      },
      error,
    });

    const response = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(await response.text()).toBe("whole body");
    expect(response.status).toBe(200);
    expect(error).not.toHaveBeenCalled();
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
    const error = jest.fn();
    await using server = serve({
      port: 0,
      routes: {
        "/static": new Response("static-body"),
      },
      fetch() {
        return new Response("fallback");
      },
      error,
    });

    for (let i = 0; i < 3; i++) {
      const response = await fetch(new URL("/static", server.url));
      expect(await response.text()).toBe("static-body");
      expect(response.status).toBe(200);
    }
    expect(error).not.toHaveBeenCalled();
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

describe.concurrent("a Response without a body returned for a request the server dropped", () => {
  const bodiless = {
    "null body": () => new Response(null, { status: 404 }),
    "empty string body": () => new Response(""),
  };
  const kinds = Object.keys(bodiless) as (keyof typeof bodiless)[];

  async function expectReusable(url: URL, kept: Response) {
    const res = await fetch(url);
    expect({ status: res.status, body: await res.text(), bodyUsed: kept.bodyUsed }).toEqual({
      status: kept.status,
      body: "",
      bodyUsed: false,
    });
  }

  it.each(kinds)("%s can be returned again after the client aborted", async kind => {
    const kept = bodiless[kind]();
    const started = Promise.withResolvers<void>();
    const returned = Promise.withResolvers<void>();
    await using server = serve({
      port: 0,
      async fetch(req) {
        if (!req.url.endsWith("/drop")) return kept;
        const aborted = Promise.withResolvers<void>();
        req.signal.addEventListener("abort", () => aborted.resolve());
        started.resolve();
        await aborted.promise;
        returned.resolve();
        return kept;
      },
      error: (err: any) => new Response(err.code, { status: 500 }),
    });

    const controller = new AbortController();
    const dropped = fetch(new URL("/drop", server.url), { signal: controller.signal });
    await started.promise;
    controller.abort();
    await expect(dropped).rejects.toMatchObject({ name: "AbortError" });
    await returned.promise;
    await expectReusable(server.url, kept);
  });

  it.each(kinds)("%s can be returned again after server.upgrade()", async kind => {
    const kept = bodiless[kind]();
    await using server = serve({
      port: 0,
      fetch(req, server) {
        server.upgrade(req);
        return kept;
      },
      websocket: { message() {} },
      error: (err: any) => new Response(err.code, { status: 500 }),
    });

    const closed = Promise.withResolvers<void>();
    const ws = new WebSocket(server.url.href.replace("http:", "ws:"));
    ws.onopen = () => ws.close();
    ws.onerror = () => closed.reject(new Error("the WebSocket did not open"));
    ws.onclose = () => closed.resolve();
    await closed.promise;
    await expectReusable(server.url, kept);
  });
});

describe.concurrent("a Response around a stream that a reader holds", () => {
  it("HEAD does not cancel a stream that another response is sending", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = jest.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        c.enqueue(new TextEncoder().encode("part1;"));
      },
      cancel,
    });
    const responses: Record<string, Response> = { "/a": new Response(stream), "/b": new Response(stream) };
    await using server = serve({
      port: 0,
      fetch: req => responses[new URL(req.url).pathname],
    });

    const download = await fetch(new URL("/a", server.url));
    const reader = download.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("part1;");

    const head = await fetch(new URL("/b", server.url), { method: "HEAD" });
    expect(head.status).toBe(200);

    controller.enqueue(new TextEncoder().encode("part2;"));
    controller.close();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("part2;");
    expect((await reader.read()).done).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("refusing the Response leaves the stream open for its reader", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const encoder = new TextEncoder();
        let controller;
        const upstream = Bun.serve({
          port: 0,
          fetch: () => new Response(new ReadableStream({ start(c) { controller = c; c.enqueue(encoder.encode("one;")); } })),
        });
        const text = Promise.withResolvers();
        const server = Bun.serve({
          port: 0,
          development: false,
          async fetch() {
            const response = await fetch(upstream.url);
            text.resolve(new Response(response.body).text());
            return response;
          },
        });
        console.log((await fetch(server.url)).status);
        controller.enqueue(encoder.encode("two;"));
        controller.close();
        console.log(await text.promise);
        upstream.stop(true);
        server.stop(true);`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("ERR_STREAM_CANNOT_PIPE");
    expect(stdout).toBe("500\none;two;\n");
    expect(exitCode).toBe(1);
  });
});

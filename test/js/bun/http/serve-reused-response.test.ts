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

// The response sink drives the source of a native body stream itself only while no consumer has started the stream.
// After that the stream's controller drives the source, and its queue can hold bytes the source no longer has.
describe("returning a Response whose native body stream a consumer already started sends the rest of it", () => {
  // A period (a prime) that does not divide a pull view, so bytes from the wrong offset cannot pass for the right ones.
  const period = Buffer.alloc(4093);
  for (let i = 0; i < period.length; i++) period[i] = 97 + (i % 26);
  const payload = Buffer.alloc(400_000, period);

  const tick = () => new Promise(resolve => setImmediate(resolve));
  // An HTMLRewriter emits the output of one input chunk in one piece, some turns later, while nothing reads it.
  const turns = async () => {
    for (let i = 0; i < 8; i++) await tick();
  };
  const rewritten = () => {
    let input!: ReadableStreamDefaultController;
    const res = new HTMLRewriter()
      .on("nothing", { element() {} })
      .transform(new Response(new ReadableStream({ start: c => void (input = c) })));
    return { res, input };
  };

  // [what the handler did, the handler, what the client gets]. `afterFirstChunk` runs once the response has started.
  const cases: [string, () => Promise<{ res: Response; expected: Buffer; afterFirstChunk?: () => void }>][] = [
    [
      "getReader() + releaseLock(), body complete",
      async () => {
        const { res, input } = rewritten();
        // The first pull waits. The output fills its view, which sits in the stream's queue; the rest stays behind.
        res.body!.getReader().releaseLock();
        input.enqueue(payload);
        await turns();
        input.close();
        await turns();
        return { res, expected: payload };
      },
    ],
    [
      "getReader() + releaseLock(), body still streaming",
      async () => {
        const { res, input } = rewritten();
        res.body!.getReader().releaseLock();
        input.enqueue(payload);
        await turns();
        return { res, expected: payload, afterFirstChunk: () => input.close() };
      },
    ],
    [
      "one read(), body complete",
      async () => {
        const { res, input } = rewritten();
        const reader = res.body!.getReader();
        input.enqueue(payload);
        const head = (await reader.read()).value!;
        reader.releaseLock();
        input.close();
        await turns();
        return { res, expected: payload.subarray(head.length) };
      },
    ],
  ];

  it.each(cases)("after %s", async (_, handler) => {
    let expected!: Buffer;
    let afterFirstChunk: (() => void) | undefined;
    using server = serve({
      port: 0,
      async fetch() {
        const handled = await handler();
        ({ expected, afterFirstChunk } = handled);
        return handled.res;
      },
    });

    const res = await fetch(server.url);
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.body!) {
      chunks.push(chunk);
      afterFirstChunk?.();
      afterFirstChunk = undefined;
    }
    const got = Buffer.concat(chunks);
    expect({ status: res.status, bytes: got.length, intact: got.equals(expected) }).toEqual({
      status: 200,
      bytes: expected.length,
      intact: true,
    });
  });
});

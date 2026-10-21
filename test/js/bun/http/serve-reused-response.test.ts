import { serve } from "bun";
import { describe, expect, it, jest } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { isDisturbed } from "node:stream";

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

// Bun.serve sends an empty string or buffer without using it up, so a handler can return the same
// Response for every request. A read of `.body` does not change that.
describe("returning the same Response with an empty string or buffer as its body", () => {
  const emptyBodies = {
    string: () => "",
    Uint8Array: () => new Uint8Array(0),
    ArrayBuffer: () => new ArrayBuffer(0),
  };
  const kinds = Object.keys(emptyBodies) as (keyof typeof emptyBodies)[];

  async function answers(url: URL, methods: string[]) {
    const answers: unknown[] = [];
    for (const method of methods) {
      const response = await fetch(url, { method });
      answers.push({
        status: response.status,
        contentLength: response.headers.get("content-length"),
        transferEncoding: response.headers.get("transfer-encoding"),
        body: await response.text(),
      });
    }
    return answers;
  }
  const emptyAnswer = (status: number) => ({ status, contentLength: "0", transferEncoding: null, body: "" });

  const handlers = {
    "a handler": (kept: Response) => ({ fetch: () => kept }),
    // Its promise is still pending when the handler returns, which is a separate path into the renderer.
    "a handler that settles later": (kept: Response) => ({
      async fetch() {
        await new Promise(resolve => setImmediate(resolve));
        return kept;
      },
    }),
  };

  describe.each(kinds)("%s", kind => {
    describe.each([true, false])("with .body read: %p", readBody => {
      describe.each(Object.keys(handlers) as (keyof typeof handlers)[])("from %s", handler => {
        it.each([
          ["GET", "GET", "GET", "GET"],
          ["HEAD", "GET", "HEAD", "GET"],
        ])("answers %s, %s, %s, %s", async (...methods) => {
          const kept = new Response(emptyBodies[kind]());
          const stream = readBody ? kept.body! : undefined;
          const error = jest.fn(() => new Response("handled", { status: 500 }));
          await using server = serve({ port: 0, ...handlers[handler](kept), error });

          expect(await answers(server.url, methods)).toEqual(methods.map(() => emptyAnswer(200)));
          expect(error).not.toHaveBeenCalled();
          expect({
            bodyUsed: kept.bodyUsed,
            sameStream: !readBody || kept.body === stream,
            locked: kept.body!.locked,
          }).toEqual({ bodyUsed: false, sameStream: true, locked: false });
        });
      });
    });
  });

  it.each(kinds)("%s: answers every request when the handler reads .body and keeps a clone()", async kind => {
    const kept = new Response(emptyBodies[kind]());
    const clones: Response[] = [];
    const error = jest.fn(() => new Response("handled", { status: 500 }));
    await using server = serve({
      port: 0,
      fetch() {
        if (kept.body) clones.push(kept.clone());
        return kept;
      },
      error,
    });

    const methods = ["GET", "GET", "HEAD", "GET"];
    expect(await answers(server.url, methods)).toEqual(methods.map(() => emptyAnswer(200)));
    expect(error).not.toHaveBeenCalled();
    expect(kept.bodyUsed).toBe(false);
    expect(await Promise.all(clones.map(clone => clone.text()))).toEqual(["", "", "", ""]);
  });

  it("answers every request from error() after a read of .body", async () => {
    const kept = new Response("", { status: 503 });
    const stream = kept.body!;
    await using server = serve({
      port: 0,
      fetch() {
        throw new Error("to error()");
      },
      error: () => kept,
    });

    expect(await answers(server.url, ["GET", "HEAD", "GET"])).toEqual([
      emptyAnswer(503),
      emptyAnswer(503),
      emptyAnswer(503),
    ]);
    expect({ bodyUsed: kept.bodyUsed, locked: stream.locked }).toEqual({ bodyUsed: false, locked: false });
  });

  // A status without content takes its own path through the renderer.
  describe.each([204, 304])("with status %d", status => {
    it.each(Object.keys(handlers) as (keyof typeof handlers)[])("from %s after a read of .body", async handler => {
      const kept = new Response("", { status });
      const stream = kept.body!;
      await using server = serve({ port: 0, ...handlers[handler](kept) });

      const methods = ["GET", "HEAD", "GET"];
      expect(await answers(server.url, methods)).toEqual(
        methods.map(() => ({ ...emptyAnswer(status), contentLength: null })),
      );
      expect({ bodyUsed: kept.bodyUsed, locked: stream.locked }).toEqual({ bodyUsed: false, locked: false });
    });
  });

  it.each(kinds)("%s: a send leaves the body and its stream unread, and a later read uses them up", async kind => {
    const kept = new Response(emptyBodies[kind]());
    const stream = kept.body!;
    const codes: string[] = [];
    await using server = serve({
      port: 0,
      fetch: () => kept,
      error(err: any) {
        codes.push(err.code);
        return new Response("handled", { status: 500 });
      },
    });
    const state = () => ({ bodyUsed: kept.bodyUsed, disturbed: isDisturbed(stream), locked: stream.locked });

    expect(await answers(server.url, ["GET"])).toEqual([emptyAnswer(200)]);
    expect(state()).toEqual({ bodyUsed: false, disturbed: false, locked: false });

    expect(await kept.text()).toBe("");
    expect(state()).toEqual({ bodyUsed: true, disturbed: true, locked: true });
    expect((await fetch(server.url)).status).toBe(500);
    expect(codes).toEqual(["ERR_STREAM_CANNOT_PIPE"]);
  });

  // The stream stays the body after a send: once something holds it, the body is in use like any other.
  it("is refused once a reader holds .body", async () => {
    const kept = new Response("");
    const stream = kept.body!;
    const codes: string[] = [];
    await using server = serve({
      port: 0,
      fetch: () => kept,
      error(err: any) {
        codes.push(err.code);
        return new Response("handled", { status: 500 });
      },
    });

    expect(await answers(server.url, ["GET"])).toEqual([emptyAnswer(200)]);
    stream.getReader();
    expect((await fetch(server.url)).status).toBe(500);
    expect(codes).toEqual(["ERR_STREAM_CANNOT_PIPE"]);
  });

  // Only a Response without content leaves the handler's Content-Length on a HEAD answer.
  it("HEAD keeps the handler's Content-Length after a read of .body", async () => {
    await using server = serve({
      port: 0,
      fetch() {
        const response = new Response("", { headers: { "Content-Length": "123" } });
        response.body;
        return response;
      },
    });

    expect(await answers(server.url, ["HEAD"])).toEqual([{ ...emptyAnswer(200), contentLength: "123" }]);
  });
});

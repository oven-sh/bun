import { serve } from "bun";
import { describe, expect, it, jest } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { once } from "node:events";
import http2 from "node:http2";

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
  const streamUsedError = {
    code: "ERR_STREAM_CANNOT_PIPE",
    name: "Error",
    message: "Stream already used, please create a new one",
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

      // HEAD reports the status GET reports (RFC 9110 §9.3.2), not an empty 200.
      const head = await fetch(server.url, { method: "HEAD" });
      expect(await head.text()).toBe("");
      expect(head.status).toBe(500);

      expect(errors).toEqual([alreadyUsedError, alreadyUsedError, alreadyUsedError]);
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

      expect(errors).toEqual([streamUsedError, streamUsedError]);
    },
  );

  // The server cannot send a stream that another reader holds. GET and HEAD report that through
  // error() before any header is written (RFC 9110 §9.3.2), and both leave the stream to its reader.
  describe("a stream body that a reader already holds", () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    async function readToEnd(reader: ReadableStreamDefaultReader<Uint8Array>) {
      let text = "";
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        text += decoder.decode(chunk.value, { stream: true });
      }
      return text;
    }

    const sources = {
      start: (cancel: () => void) =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("body"));
            controller.close();
          },
          cancel,
        }),
      pull: (cancel: () => void) =>
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(encoder.encode("body"));
            controller.close();
          },
          cancel,
        }),
      direct: (cancel: () => void) =>
        new ReadableStream<Uint8Array>({
          type: "direct",
          pull(controller) {
            controller.write("body");
            controller.close();
          },
          cancel,
        }),
    };

    // `rest()` is what the holder of the lock reads from the stream once the request is over.
    type Held = { response: Response; rest(): Promise<string> };
    const viaBodyReader = (response: Response): Held => {
      const reader = response.body!.getReader();
      return { response, rest: () => readToEnd(reader) };
    };
    const shapes: Record<string, (cancel: () => void) => Held | Promise<Held>> = {
      "body.getReader() on a start() source": cancel => viaBodyReader(new Response(sources.start(cancel))),
      "body.getReader() on a pull() source": cancel => viaBodyReader(new Response(sources.pull(cancel))),
      'body.getReader() on a type: "direct" source': cancel => viaBodyReader(new Response(sources.direct(cancel))),
      "body.getReader() and a Content-Length header": cancel =>
        viaBodyReader(new Response(sources.start(cancel), { headers: { "Content-Length": "4" } })),
      "stream.getReader() without touching .body": cancel => {
        const stream = sources.start(cancel);
        const response = new Response(stream);
        const reader = stream.getReader();
        return { response, rest: () => readToEnd(reader) };
      },
      "body.tee()": cancel => {
        const response = new Response(sources.start(cancel));
        const [branch] = response.body!.tee();
        return { response, rest: () => readToEnd(branch.getReader()) };
      },
      "await response.text()": async cancel => {
        const response = new Response(sources.start(cancel));
        const text = await response.text();
        return { response, rest: async () => text };
      },
      "another Response around the same stream was read": async cancel => {
        const stream = sources.start(cancel);
        const [first, response] = [new Response(stream), new Response(stream)];
        const text = await first.text();
        return { response, rest: async () => text };
      },
    };

    const deliveries: Record<string, (response: Response) => () => Response | Promise<Response>> = {
      "a Response": response => () => response,
      "a fulfilled promise": response => () => Promise.resolve(response),
      "a pending promise": response => async () => {
        await new Promise(resolve => setImmediate(resolve));
        return response;
      },
    };

    async function request(url: URL | string, method: string) {
      const response = await fetch(url, { method });
      return {
        status: response.status,
        contentLength: response.headers.get("Content-Length"),
        transferEncoding: response.headers.get("Transfer-Encoding"),
        body: await response.text(),
      };
    }
    const handled = { status: 500, contentLength: "7", transferEncoding: null, body: "handled" };

    // Each case pins what GET does, and asserts that HEAD does the same with no body.
    describe.each(Object.keys(shapes))("%s", shape => {
      it.each(Object.keys(deliveries))("returned as %s: HEAD reports what GET reports", async delivery => {
        async function outcome(method: string) {
          let cancels = 0;
          const held = await shapes[shape](() => void cancels++);
          const errors: unknown[] = [];
          await using server = serve({
            port: 0,
            fetch: deliveries[delivery](held.response),
            error(err: any) {
              errors.push({ code: err.code, name: err.constructor.name, message: err.message });
              return new Response("handled", { status: 500 });
            },
          });
          const response = await request(server.url, method);
          // `rest` and `cancels`: the server neither ended the stream nor cancelled it under its reader.
          return { ...response, errors, rest: await held.rest(), cancels };
        }

        const get = await outcome("GET");
        expect(get).toEqual({ ...handled, errors: [streamUsedError], rest: "body", cancels: 0 });
        expect(await outcome("HEAD")).toEqual({ ...get, body: "" });
      });
    });

    const routeShapes: Record<string, (handler: () => Response) => Bun.Serve.Routes<undefined, string>> = {
      "an any-method route": handler => ({ "/": handler }),
      "a HEAD route": handler => ({ "/": { GET: handler, HEAD: handler } }),
      "a HEAD derived from a GET route": handler => ({ "/": { GET: handler } }),
    };
    it.each(Object.keys(routeShapes))("%s: HEAD reports what GET reports", async routeShape => {
      const errors: unknown[] = [];
      await using server = serve({
        port: 0,
        routes: routeShapes[routeShape](() => viaBodyReader(new Response(sources.start(() => {}))).response),
        error(err: any) {
          errors.push({ code: err.code, name: err.constructor.name, message: err.message });
          return new Response("handled", { status: 500 });
        },
      });

      const get = await request(server.url, "GET");
      expect(get).toEqual(handled);
      expect(await request(server.url, "HEAD")).toEqual({ ...get, body: "" });
      expect(errors).toEqual([streamUsedError, streamUsedError]);
    });

    it("over HTTP/2, HEAD reports what GET reports", async () => {
      const errors: unknown[] = [];
      await using server = serve({
        port: 0,
        http2: true,
        fetch: () => viaBodyReader(new Response(sources.start(() => {}))).response,
        error(err: any) {
          errors.push({ code: err.code, name: err.constructor.name, message: err.message });
          return new Response("handled", { status: 500 });
        },
      });

      const session = http2.connect(`http://127.0.0.1:${server.port}`);
      try {
        async function h2(method: string) {
          const stream = session.request({ ":path": "/", ":method": method });
          const [headers] = await once(stream, "response");
          let body = "";
          for await (const chunk of stream.setEncoding("utf8")) body += chunk;
          return { status: headers[":status"], contentLength: headers["content-length"], body };
        }
        const get = await h2("GET");
        expect(get).toEqual({ status: 500, contentLength: "7", body: "handled" });
        expect(await h2("HEAD")).toEqual({ ...get, body: "" });
        expect(errors).toEqual([streamUsedError, streamUsedError]);
      } finally {
        session.close();
      }
    });

    // The refusal uses the body up, as a sent body is: the next request gets the already-used error.
    it.each([
      ["GET", "GET"],
      ["HEAD", "HEAD"],
      ["HEAD", "GET"],
      ["GET", "HEAD"],
    ])("the same Response returned for %s and then %s", async (first, second) => {
      const { response } = viaBodyReader(new Response(sources.start(() => {})));
      const errors: unknown[] = [];
      await using server = serve({
        port: 0,
        fetch: () => response,
        error(err: any) {
          errors.push({ code: err.code, name: err.constructor.name, message: err.message });
          return new Response("handled", { status: 500 });
        },
      });

      const bodyFor = (method: string) => (method === "HEAD" ? "" : "handled");
      expect([await request(server.url, first), await request(server.url, second)]).toEqual([
        { ...handled, body: bodyFor(first) },
        { ...handled, body: bodyFor(second) },
      ]);
      expect(errors).toEqual([streamUsedError, alreadyUsedError]);
    });
  });

  // The second input leaves a Content-Length on the used Response: it must not frame a HEAD 200.
  const leftoverContentLength = { headers: { "Content-Length": "24" } };
  it.each([
    ["GET", "no headers", undefined],
    ["HEAD", "no headers", undefined],
    ["GET", "a leftover Content-Length", leftoverContentLength],
    ["HEAD", "a leftover Content-Length", leftoverContentLength],
  ] as const)(
    "returning a Response whose body was consumed before returning calls the error handler (%s, %s)",
    async (method, _label, init) => {
      const errors: unknown[] = [];
      await using server = serve({
        port: 0,
        async fetch() {
          const response = new Response("consumed before returning", init);
          await response.text();
          return response;
        },
        error(err: any) {
          errors.push({ code: err.code, name: err.constructor.name, message: err.message });
          return new Response("handled", { status: 500 });
        },
      });

      const response = await fetch(server.url, { method });
      expect(await response.text()).toBe(method === "HEAD" ? "" : "handled");
      expect({ status: response.status, contentLength: response.headers.get("Content-Length") }).toEqual({
        status: 500,
        contentLength: "7",
      });
      expect(errors).toEqual([alreadyUsedError]);
    },
  );

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

  // The server refuses a stream body that another reader holds. The stream stays with that reader:
  // the teardown of the refused request must not end it. The default 500 reports the refusal as an
  // unhandled error, so each case runs in its own process.
  describe.concurrent("a fetch() body that another reader holds", () => {
    const streamUsed = "Stream already used, please create a new one";
    async function run(script: string) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { ...JSON.parse(stdout), reports: stderr.split(streamUsed).length - 1, exitCode };
    }

    const whole = "chunk1;chunk2;chunk3;chunk4;chunk5;chunk6;";
    it.each([
      ["GET", { status: 500, read: whole, reports: 1, exitCode: 1 }],
      ["HEAD", { status: 500, read: whole, reports: 1, exitCode: 1 }],
    ] as const)("%s: the handler's reader still reads the whole body", async (method, expected) => {
      const result = await run(`
        const release = Promise.withResolvers();
        const upstream = Bun.serve({
          port: 0,
          idleTimeout: 0,
          fetch() {
            let sent = 0;
            return new Response(
              new ReadableStream({
                async pull(controller) {
                  if (sent === 1) await release.promise;
                  controller.enqueue(new TextEncoder().encode("chunk" + ++sent + ";"));
                  if (sent === 6) controller.close();
                },
              }),
            );
          },
        });
        let reader;
        let read = "";
        const decoder = new TextDecoder();
        const server = Bun.serve({
          port: 0,
          idleTimeout: 0,
          development: false,
          // The handler reads the upstream body itself and still returns the upstream Response.
          async fetch() {
            const upstreamResponse = await fetch(upstream.url);
            reader = upstreamResponse.body.getReader();
            read += decoder.decode((await reader.read()).value, { stream: true });
            return upstreamResponse;
          },
        });
        const response = await fetch(server.url, { method: ${JSON.stringify(method)} });
        await response.text();
        // The request is over and torn down. The upstream sends the rest only now.
        release.resolve();
        for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
          read += decoder.decode(chunk.value, { stream: true });
        }
        console.log(JSON.stringify({ status: response.status, read }));
        await server.stop(true);
        await upstream.stop(true);
      `);
      expect(result).toEqual(expected);
    });

    // error() has run already, so the refusal of its own Response gets the default 500.
    it.each(["GET", "HEAD"])(
      "%s: an error() Response whose stream a reader holds gets the default 500",
      async method => {
        const result = await run(`
        const held = () => {
          const response = new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("body"));
                controller.close();
              },
            }),
            { status: 418 },
          );
          response.body.getReader();
          return response;
        };
        const errorHandlers = [
          () => held(),
          () => Promise.resolve(held()),
          async () => {
            await new Promise(resolve => setImmediate(resolve));
            return held();
          },
        ];
        const responses = [];
        for (const error of errorHandlers) {
          const server = Bun.serve({
            port: 0,
            development: false,
            fetch() {
              throw new Error("boom");
            },
            error,
          });
          const response = await fetch(server.url, { method: ${JSON.stringify(method)} });
          responses.push([
            response.status,
            response.headers.get("Content-Length"),
            response.headers.get("Transfer-Encoding"),
            await response.text(),
          ]);
          await server.stop(true);
        }
        console.log(JSON.stringify({ responses }));
      `);
        const response = [500, "21", null, method === "HEAD" ? "" : "Something went wrong!"];
        expect(result).toEqual({ responses: [response, response, response], reports: 3, exitCode: 1 });
      },
    );

    it("GET: another client's download of the same body completes", async () => {
      const result = await run(`
        const release = Promise.withResolvers();
        const upstream = Bun.serve({
          port: 0,
          idleTimeout: 0,
          fetch: () =>
            new Response(
              new ReadableStream({
                async start(controller) {
                  controller.enqueue(new TextEncoder().encode("part1;"));
                  await release.promise;
                  controller.enqueue(new TextEncoder().encode("part2;"));
                  controller.close();
                },
              }),
            ),
        });
        // Both adopt the body while nothing has read it.
        const { body } = await fetch(upstream.url);
        const responses = { "/sent": new Response(body), "/refused": new Response(body) };
        const server = Bun.serve({
          port: 0,
          idleTimeout: 0,
          development: false,
          fetch: req => responses[new URL(req.url).pathname],
        });
        const inFlight = await fetch(new URL("/sent", server.url));
        const reader = inFlight.body.getReader();
        const decoder = new TextDecoder();
        let read = decoder.decode((await reader.read()).value, { stream: true });
        const refused = await fetch(new URL("/refused", server.url));
        await refused.text();
        release.resolve();
        try {
          for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
            read += decoder.decode(chunk.value, { stream: true });
          }
        } catch (error) {
          read += "<" + error.code + ">";
        }
        console.log(JSON.stringify({ status: refused.status, read }));
        await server.stop(true);
        await upstream.stop(true);
      `);
      expect(result).toEqual({ status: 500, read: "part1;part2;", reports: 1, exitCode: 1 });
    });
  });
});

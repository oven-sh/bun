import { serve } from "bun";
import { describe, expect, it, jest } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

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

  // The server refuses a stream body that another consumer holds, or whose Response was already
  // sent. It never attached to that stream, so the teardown of the refused request must not end
  // it. The default 500 reports the refusal as an unhandled error, so each case runs in its own
  // process.
  describe.concurrent("a body stream that the refused request never attached", () => {
    const refusals = ["Stream already used, please create a new one", "Response body already used"];
    async function run(script: string, args: string[] = []) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script, ...args],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const reports = refusals.reduce((count, refusal) => count + stderr.split(refusal).length - 1, 0);
      return { ...JSON.parse(stdout), reports, exitCode };
    }

    const whole = "chunk1;chunk2;chunk3;chunk4;chunk5;chunk6;";
    it.each([
      ["GET", { status: 500, read: whole, reports: 1, exitCode: 1 }],
      // HEAD sends no body, so the server has nothing to refuse.
      ["HEAD", { status: 200, read: whole, reports: 0, exitCode: 0 }],
    ] as const)("%s: the reader the handler holds on a fetch() body reads the whole body", async (method, expected) => {
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

    it("GET: the reader the handler holds on a file stream reads the whole file", async () => {
      const size = 4 * 1024 * 1024;
      using dir = tempDir("serve-refused-file-stream", { "body.bin": Buffer.alloc(size, "a") });
      const result = await run(
        `
        let reader;
        const server = Bun.serve({
          port: 0,
          idleTimeout: 0,
          development: false,
          fetch() {
            const stream = Bun.file(process.argv[1]).stream();
            const response = new Response(stream);
            reader = stream.getReader();
            return response;
          },
        });
        const response = await fetch(server.url);
        await response.text();
        let read = 0;
        for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) read += chunk.value.byteLength;
        console.log(JSON.stringify({ status: response.status, read }));
        await server.stop(true);
      `,
        [join(String(dir), "body.bin")],
      );
      expect(result).toEqual({ status: 500, read: size, reports: 1, exitCode: 1 });
    });

    it("GET: another client's download of the same fetch() body completes", async () => {
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

    it.each([
      ["GET", { status: 500, read: "part1;part2;", reports: 1, exitCode: 1 }],
      ["HEAD", { status: 200, read: "part1;part2;", reports: 0, exitCode: 0 }],
    ] as const)(
      "%s for a fetch() Response that is already being sent leaves that download alone",
      async (method, expected) => {
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
          const cached = await fetch(upstream.url);
          // From here on the Response holds its body stream, and each request that returns it finds that stream.
          cached.body;
          const server = Bun.serve({ port: 0, idleTimeout: 0, development: false, fetch: () => cached });
          const inFlight = await fetch(server.url);
          const reader = inFlight.body.getReader();
          const decoder = new TextDecoder();
          let read = decoder.decode((await reader.read()).value, { stream: true });
          const again = await fetch(server.url, { method: ${JSON.stringify(method)} });
          await again.text();
          release.resolve();
          try {
            for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
              read += decoder.decode(chunk.value, { stream: true });
            }
          } catch (error) {
            read += "<" + error.code + ">";
          }
          console.log(JSON.stringify({ status: again.status, read }));
          await server.stop(true);
          await upstream.stop(true);
        `);
        expect(result).toEqual(expected);
      },
    );
  });

  // The refusal reaches error(), which has not answered yet when the client goes away. The abort
  // of that request must leave the stream with the reader that holds it.
  it("a client abort during error() for a refused stream leaves the stream with its reader", async () => {
    const cancels: unknown[] = [];
    const errors: unknown[] = [];
    let sent = 0;
    let reader!: ReadableStreamDefaultReader<Uint8Array>;
    const { promise: errorEntered, resolve: enterError } = Promise.withResolvers<void>();
    const { promise: abortObserved, resolve: observeAbort } = Promise.withResolvers<void>();
    const { promise: gate, resolve: openGate } = Promise.withResolvers<void>();
    await using server = serve({
      port: 0,
      idleTimeout: 0,
      fetch(request) {
        request.signal.addEventListener("abort", () => observeAbort(), { once: true });
        const stream = new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              if (sent === 5) return controller.close();
              controller.enqueue(new TextEncoder().encode(`chunk${++sent};`));
            },
            cancel(reason) {
              cancels.push(reason);
            },
          },
          { highWaterMark: 0 },
        );
        const response = new Response(stream);
        reader = stream.getReader();
        return response;
      },
      async error(err: any) {
        errors.push(err.code);
        enterError();
        await gate;
        return new Response("handled", { status: 500 });
      },
    });

    const controller = new AbortController();
    const aborted = fetch(server.url, { signal: controller.signal }).catch(() => {});
    await errorEntered;
    controller.abort();
    await aborted;
    await abortObserved;

    const decoder = new TextDecoder();
    let read = "";
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      read += decoder.decode(chunk.value, { stream: true });
    }
    expect({ read, cancels, errors }).toEqual({
      read: "chunk1;chunk2;chunk3;chunk4;chunk5;",
      cancels: [],
      errors: ["ERR_STREAM_CANNOT_PIPE"],
    });
    openGate();
  });
});

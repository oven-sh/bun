import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { once } from "node:events";
import net from "node:net";
import { join } from "node:path";

// In CI these files run under `bun test --parallel --isolate`, where one
// worker process runs several test files against the same JSC VM. heapStats()
// is VM-wide, so assert on the delta rather than an absolute count to avoid
// counting objects left over from the previous file in this worker.
const countOf = (name: string) => (heapStats().objectTypeCounts[name] as number) || 0;

describe("FetchTasklet cyclic reference", () => {
  test("fetch with request body stream should not leak with cyclic reference", async () => {
    const baselineRequest = countOf("Request");
    const baselineStream = countOf("ReadableStream");
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.text();
        return new Response(`received: ${body}`);
      },
    });

    const url = `http://localhost:${server.port}/`;

    async function leak() {
      const requestBody = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("request body"));
          controller.close();
        },
      });

      const request = new Request(url, {
        method: "POST",
        body: requestBody,
      });

      // Create cyclic reference
      // @ts-ignore
      requestBody.request = request;
      // @ts-ignore
      request.bodyStream = requestBody;

      const response = await fetch(request);
      return await response.text();
    }

    for (let i = 0; i < 500; i++) {
      await leak();
    }

    await Bun.sleep(10);
    Bun.gc(true);
    await Bun.sleep(10);
    Bun.gc(true);

    expect(countOf("Request") - baselineRequest).toBeLessThanOrEqual(100);
    expect(countOf("ReadableStream") - baselineStream).toBeLessThanOrEqual(100);
  });

  test("fetch with ReadableStream body should not leak streams", async () => {
    const baselineStream = countOf("ReadableStream");
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.text();
        return new Response(`received: ${body}`);
      },
    });

    const url = `http://localhost:${server.port}/`;

    async function leak() {
      const requestBody = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("request body"));
          controller.close();
        },
      });

      // Use ReadableStream directly with fetch, no Request object, no cyclic reference
      const response = await fetch(url, {
        method: "POST",
        body: requestBody,
      });
      return await response.text();
    }

    for (let i = 0; i < 500; i++) {
      await leak();
    }

    await Bun.sleep(10);
    Bun.gc(true);
    await Bun.sleep(10);
    Bun.gc(true);

    // This currently fails with ~502 streams leaked
    expect(countOf("ReadableStream") - baselineStream).toBeLessThanOrEqual(100);
  });
});

// A failed body keeps its error until something reads it. The body held a JS
// error by a Strong, which is a GC root, so an error that references the
// Response closed a cycle through the root. The error now sits in a visited
// slot of the Response's wrapper, and a read takes it out of the body.
describe("an error that references the Response whose body it failed", () => {
  const N = 60;

  async function leakedResponses(leak: () => Promise<void>) {
    for (let i = 0; i < 10; i++) await leak();
    Bun.gc(true);
    const baseline = countOf("Response");
    for (let i = 0; i < N; i++) await leak();

    // A server's own Response of each request goes once it sees the connection close.
    let leaked = Infinity;
    for (let turn = 0; turn < 50 && leaked >= N / 4; turn++) {
      await new Promise(resolve => setImmediate(resolve));
      Bun.gc(true);
      leaked = countOf("Response") - baseline;
    }
    return leaked;
  }

  // The headers and a first chunk arrive. The body never ends.
  const serveOpenBody = () =>
    Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("x"));
            },
          }),
        );
      },
    });

  test("an abort reason, while nothing reads the body", async () => {
    await using server = serveOpenBody();
    const leaked = await leakedResponses(async () => {
      const controller = new AbortController();
      const response = await fetch(server.url, { signal: controller.signal });
      controller.abort(Object.assign(new Error("aborted"), { response }));
    });
    // Unfixed: the N Responses that fetch() resolved with.
    expect(leaked).toBeLessThan(N / 4);
  });

  // The abort rejects the read and uses the body up. fetch then reported the
  // same abort to that used body, which kept it.
  test("the AbortError of a pending read", async () => {
    await using server = serveOpenBody();
    const leaked = await leakedResponses(async () => {
      const controller = new AbortController();
      const response = await fetch(server.url, { signal: controller.signal });
      const read = response.text();
      controller.abort();
      await read.catch(error => void (error.response = response));
    });
    expect(leaked).toBeLessThan(N / 4);
  });

  // The whole response arrives at once and its body does not decode, so the
  // Response is made with the failure in hand, as a native error. The first
  // reader makes the JS error from it, which script can then point at the
  // Response. These readers left that error in the body, by a Strong.
  describe("the error that a reader other than the body mixin surfaces", () => {
    async function withUndecodableBodyServer(fn: (url: string) => Promise<void>) {
      const server = net.createServer(socket => {
        socket.resume();
        socket.end(
          "HTTP/1.1 200 OK\r\nContent-Type: application/wasm\r\nContent-Encoding: gzip\r\nContent-Length: 16\r\nConnection: close\r\n\r\nthis is not gzip",
        );
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      try {
        await fn(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}/`);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    }

    const readers: Record<string, (response: Response, dir: string) => unknown> = {
      "HTMLRewriter.transform()": response => new HTMLRewriter().transform(response),
      "WebAssembly.compileStreaming()": response => WebAssembly.compileStreaming(response),
      "Bun.spawn() stdin": response => Bun.spawn({ cmd: [bunExe(), "--version"], env: bunEnv, stdin: response }),
      "Bun.write()": (response, dir) => Bun.write(join(dir, "out"), response),
    };

    test.each(Object.entries(readers))("%s", async (_, read) => {
      using dir = tempDir("fetch-cyclic-reference", {});
      await withUndecodableBodyServer(async url => {
        let surfaced = 0;
        const leaked = await leakedResponses(async () => {
          const response = await fetch(url);
          try {
            await read(response, String(dir));
          } catch (error: any) {
            error.response = response;
            surfaced++;
          }
        });
        // The premise: the reader found the body failed, and threw or rejected with its error.
        expect(surfaced).toBeGreaterThan(N / 2);
        expect(leaked).toBeLessThan(N / 4);
      });
    });

    // Bun.serve() reads the body of the Response that its handler returns, and gives the error to error().
    test("Bun.serve()", async () => {
      let current: Response | undefined;
      let surfaced = 0;
      await using failing = Bun.serve({
        port: 0,
        fetch: () => current!,
        error(error: any) {
          error.response = current;
          surfaced++;
          return new Response("failed", { status: 500 });
        },
      });
      await withUndecodableBodyServer(async url => {
        const leaked = await leakedResponses(async () => {
          current = await fetch(url);
          await (await fetch(failing.url)).text();
          current = undefined;
        });
        expect(surfaced).toBeGreaterThan(N / 2);
        expect(leaked).toBeLessThan(N / 4);
      });
    });
  });
});

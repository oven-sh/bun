import { expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { join } from "path";

// pipeReadableStreamToBlob has a pre-existing assertion failure on Windows
// in the stream signal handling path when readStreamIntoSink completes
// synchronously. Tracked in #28090.
test.skipIf(isWindows)("Bun.write with new Response(req.body) does not hang (#28090)", async () => {
  using dir = tempDir("issue-13237-", {});
  const outFile = join(String(dir), "test.txt");

  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      await Bun.write(outFile, new Response(req.body));
      return new Response("ok");
    },
  });

  const res = await fetch(`http://localhost:${server.port}/`, {
    method: "POST",
    body: "hello from request body",
  });

  expect(await res.text()).toBe("ok");
  expect(await Bun.file(outFile).text()).toBe("hello from request body");
});

test.skipIf(isWindows)("Bun.write with new Response(ReadableStream) does not hang (#28090)", async () => {
  using dir = tempDir("issue-13237-", {});
  const outFile = join(String(dir), "test.txt");

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("hello from stream"));
      controller.close();
    },
  });

  await Bun.write(outFile, new Response(stream));
  expect(await Bun.file(outFile).text()).toBe("hello from stream");
});

test.skipIf(isWindows)(
  "Bun.write with new Response(req.body) after accessing req.body does not hang (#28090)",
  async () => {
    using dir = tempDir("issue-13237-", {});
    const outFile = join(String(dir), "test.txt");

    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        // Accessing req.body before wrapping it in a new Response
        if (!req.body) {
          return new Response("no body", { status: 400 });
        }
        await Bun.write(outFile, new Response(req.body));
        return new Response("ok");
      },
    });

    const res = await fetch(`http://localhost:${server.port}/`, {
      method: "POST",
      body: "body after access check",
    });

    expect(await res.text()).toBe("ok");
    expect(await Bun.file(outFile).text()).toBe("body after access check");
  },
);

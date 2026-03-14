import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

test("Bun.write with new Response(req.body) does not hang", async () => {
  using dir = tempDir("issue-13237-", {});
  const outFile = join(String(dir), "test.txt");

  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const written = await Bun.write(outFile, new Response(req.body));
      return new Response(String(written));
    },
  });

  const res = await fetch(`http://localhost:${server.port}/`, {
    method: "POST",
    body: "hello from request body",
  });

  expect(await res.text()).toBe(String("hello from request body".length));
  expect(await Bun.file(outFile).text()).toBe("hello from request body");
});

test("Bun.write with new Response(ReadableStream) does not hang", async () => {
  using dir = tempDir("issue-13237-", {});
  const outFile = join(String(dir), "test.txt");

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("hello from stream"));
      controller.close();
    },
  });

  const written = await Bun.write(outFile, new Response(stream));
  expect(written).toBe("hello from stream".length);
  expect(await Bun.file(outFile).text()).toBe("hello from stream");
});

test("Bun.write with new Response(req.body) after accessing req.body does not hang", async () => {
  using dir = tempDir("issue-13237-", {});
  const outFile = join(String(dir), "test.txt");

  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      // Accessing req.body before wrapping it in a new Response
      if (!req.body) {
        return new Response("no body", { status: 400 });
      }
      const written = await Bun.write(outFile, new Response(req.body));
      return new Response(String(written));
    },
  });

  const res = await fetch(`http://localhost:${server.port}/`, {
    method: "POST",
    body: "body after access check",
  });

  expect(await res.text()).toBe(String("body after access check".length));
  expect(await Bun.file(outFile).text()).toBe("body after access check");
});

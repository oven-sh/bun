import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

test("Bun.write with new Response(req.body) does not hang", async () => {
  using dir = tempDir("issue-28090-", {});
  const outFile = join(String(dir), "test.txt");

  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const bytesWritten = await Bun.write(outFile, new Response(req.body));
      expect(bytesWritten).toBe(23);
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

test("Bun.write with new Response(ReadableStream) does not hang", async () => {
  using dir = tempDir("issue-28090-", {});
  const outFile = join(String(dir), "test.txt");

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("hello from stream"));
      controller.close();
    },
  });

  const bytesWritten = await Bun.write(outFile, new Response(stream));
  expect(bytesWritten).toBe(17);
  expect(await Bun.file(outFile).text()).toBe("hello from stream");
});

test("Bun.write with new Response(req.body) after accessing req.body does not hang", async () => {
  using dir = tempDir("issue-28090-", {});
  const outFile = join(String(dir), "test.txt");

  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      // Accessing req.body before wrapping it in a new Response
      if (!req.body) {
        return new Response("no body", { status: 400 });
      }
      const bytesWritten = await Bun.write(outFile, new Response(req.body));
      expect(bytesWritten).toBe(23);
      return new Response("ok");
    },
  });

  const res = await fetch(`http://localhost:${server.port}/`, {
    method: "POST",
    body: "body after access check",
  });

  expect(await res.text()).toBe("ok");
  expect(await Bun.file(outFile).text()).toBe("body after access check");
});

import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

test("Bun.write with new Response(req.body) should not hang", async () => {
  using dir = tempDir("issue-13237", {});
  const outputPath = join(String(dir), "output.txt");
  const body = "hello from issue 13237";

  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      await Bun.write(outputPath, new Response(req.body));
      return new Response("ok");
    },
  });

  const resp = await fetch(server.url, {
    method: "POST",
    body,
  });

  expect(await resp.text()).toBe("ok");
  expect(await Bun.file(outputPath).text()).toBe(body);
});

test("Bun.write with new Response(req.body) works for large bodies", async () => {
  using dir = tempDir("issue-13237-large", {});
  const outputPath = join(String(dir), "output.txt");
  const body = "x".repeat(1024 * 1024); // 1MB

  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      await Bun.write(outputPath, new Response(req.body));
      return new Response("ok");
    },
  });

  const resp = await fetch(server.url, {
    method: "POST",
    body,
  });

  expect(await resp.text()).toBe("ok");
  expect(await Bun.file(outputPath).text()).toBe(body);
});

test("Bun.write with new Response(stream) from a custom ReadableStream", async () => {
  using dir = tempDir("issue-13237-custom", {});
  const outputPath = join(String(dir), "output.txt");

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("custom stream data"));
      controller.close();
    },
  });

  await Bun.write(outputPath, new Response(stream));
  expect(await Bun.file(outputPath).text()).toBe("custom stream data");
});

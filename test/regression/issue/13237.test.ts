import { expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function makeTempDir() {
  return mkdtempSync(join(realpathSync.native(tmpdir()), "issue-13237-"));
}

test("Bun.write with new Response(req.body) does not hang", async () => {
  const dir = makeTempDir();
  const outFile = join(dir, "test.txt");

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

test("Bun.write with new Response(ReadableStream) does not hang", async () => {
  const dir = makeTempDir();
  const outFile = join(dir, "test.txt");

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("hello from stream"));
      controller.close();
    },
  });

  await Bun.write(outFile, new Response(stream));
  expect(await Bun.file(outFile).text()).toBe("hello from stream");
});

test("Bun.write with new Response(req.body) after accessing req.body does not hang", async () => {
  const dir = makeTempDir();
  const outFile = join(dir, "test.txt");

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
});

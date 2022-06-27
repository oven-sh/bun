import { file, serve } from "bun";
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

var port = 40000;

describe("streaming", () => {
  it("text from JS, one chunk", async () => {
    const relative = new URL("./fetch.js.txt", import.meta.url);
    const textToExpect = readFileSync(relative, "utf-8");

    const server = serve({
      port: port++,
      fetch(req) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(textToExpect);
              controller.close();
            },
          })
        );
      },
    });

    const response = await fetch(`http://localhost:${server.port}`);
    const text = await response.text();
    expect(text.length).toBe(textToExpect.length);
    expect(text).toBe(textToExpect);
    server.stop();
  });
  it("text from JS, two chunks", async () => {
    const fixture = resolve(import.meta.dir, "./fetch.js.txt");
    const textToExpect = readFileSync(fixture, "utf-8");

    const server = serve({
      port: port++,
      fetch(req) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(textToExpect.substring(0, 100));
              controller.enqueue(textToExpect.substring(100));
              controller.close();
            },
          })
        );
      },
    });
    const response = await fetch(`http://localhost:${server.port}`);
    expect(await response.text()).toBe(textToExpect);
    server.stop();
  });

  it("text from JS, 2 chunks, with delay", async () => {
    const fixture = resolve(import.meta.dir, "./fetch.js.txt");
    const textToExpect = readFileSync(fixture, "utf-8");

    const server = serve({
      port: port++,
      fetch(req) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(textToExpect.substring(0, 100));
              queueMicrotask(() => {
                controller.enqueue(textToExpect.substring(100));
                controller.close();
              });
            },
          })
        );
      },
    });
    const response = await fetch(`http://localhost:${server.port}`);
    expect(await response.text()).toBe(textToExpect);
    server.stop();
  });

  it("text from JS, 1 chunk via pull()", async () => {
    const fixture = resolve(import.meta.dir, "./fetch.js.txt");
    const textToExpect = readFileSync(fixture, "utf-8");

    const server = serve({
      port: port++,
      fetch(req) {
        return new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(textToExpect);
              controller.close();
            },
          })
        );
      },
    });
    const response = await fetch(`http://localhost:${server.port}`);
    const text = await response.text();
    expect(text).toBe(textToExpect);
    server.stop();
  });

  it("text from JS, 2 chunks, with delay in pull", async () => {
    const fixture = resolve(import.meta.dir, "./fetch.js.txt");
    const textToExpect = readFileSync(fixture, "utf-8");

    const server = serve({
      port: port++,
      fetch(req) {
        return new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(textToExpect.substring(0, 100));
              queueMicrotask(() => {
                controller.enqueue(textToExpect.substring(100));
                controller.close();
              });
            },
          })
        );
      },
    });
    const response = await fetch(`http://localhost:${server.port}`);
    expect(await response.text()).toBe(textToExpect);
    server.stop();
  });

  it("text from JS, 2 chunks, with async pull", async () => {
    const fixture = resolve(import.meta.dir, "./fetch.js.txt");
    const textToExpect = readFileSync(fixture, "utf-8");

    const server = serve({
      port: port++,
      fetch(req) {
        return new Response(
          new ReadableStream({
            async pull(controller) {
              controller.enqueue(textToExpect.substring(0, 100));
              await Promise.resolve();
              controller.enqueue(textToExpect.substring(100));
              await Promise.resolve();
              controller.close();
            },
          })
        );
      },
    });
    const response = await fetch(`http://localhost:${server.port}`);
    expect(await response.text()).toBe(textToExpect);
    server.stop();
  });

  it("text from JS, 10 chunks, with async pull", async () => {
    const fixture = resolve(import.meta.dir, "./fetch.js.txt");
    const textToExpect = readFileSync(fixture, "utf-8");

    const server = serve({
      port: port++,
      fetch(req) {
        return new Response(
          new ReadableStream({
            async pull(controller) {
              var remain = textToExpect;
              for (let i = 0; i < 10 && remain.length > 0; i++) {
                controller.enqueue(remain.substring(0, 100));
                remain = remain.substring(100);
                await new Promise((resolve) => queueMicrotask(resolve));
              }

              controller.enqueue(remain);
              controller.close();
            },
          })
        );
      },
    });
    const response = await fetch(`http://localhost:${server.port}`);
    expect(await response.text()).toBe(textToExpect);
    server.stop();
  });
});

it("should work for a hello world", async () => {
  const server = serve({
    port: port++,
    fetch(req) {
      return new Response(`Hello, world!`);
    },
  });
  const response = await fetch(`http://localhost:${server.port}`);
  expect(await response.text()).toBe("Hello, world!");
  server.stop();
});

it("should work for a file", async () => {
  const fixture = resolve(import.meta.dir, "./fetch.js.txt");
  const textToExpect = readFileSync(fixture, "utf-8");

  const server = serve({
    port: port++,
    fetch(req) {
      return new Response(file(fixture));
    },
  });
  const response = await fetch(`http://localhost:${server.port}`);
  expect(await response.text()).toBe(textToExpect);
  server.stop();
});

it("fetch should work with headers", async () => {
  const fixture = resolve(import.meta.dir, "./fetch.js.txt");

  const server = serve({
    port: port++,
    fetch(req) {
      if (req.headers.get("X-Foo") !== "bar") {
        return new Response("X-Foo header not set", { status: 500 });
      }
      return new Response(file(fixture), {
        headers: { "X-Both-Ways": "1" },
      });
    },
  });
  const response = await fetch(`http://localhost:${server.port}`, {
    headers: {
      "X-Foo": "bar",
    },
  });

  expect(response.status).toBe(200);
  expect(response.headers.get("X-Both-Ways")).toBe("1");
  server.stop();
});

var count = 200;
it(`should work for a file ${count} times`, async () => {
  const fixture = resolve(import.meta.dir, "./fetch.js.txt");
  const textToExpect = readFileSync(fixture, "utf-8");
  var ran = 0;
  const server = serve({
    port: port++,
    async fetch(req) {
      return new Response(file(fixture));
    },
  });

  // this gets stuck if run about 200 times awaiting all the promises
  // when the promises are run altogether, instead of one at a time
  // it's hard to say if this only happens here due to some weird stuff with the test runner
  // or if it's "real" issue
  for (let i = 0; i < count; i++) {
    const response = await fetch(`http://localhost:${server.port}`);
    expect(await response.text()).toBe(textToExpect);
  }

  server.stop();
});

import { test, expect, describe } from "bun:test";
import got from "got";
import { Readable } from "stream";

describe("got", () => {
  test("should work", async () => {
    const server = Bun.serve({
      fetch(request, server) {
        return new Response("Hello World!");
      },
    });

    const response = await got(`http://${server.hostname}:${server.port}/`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("Hello World!");
    expect(response.headers["content-length"]).toBe("12");
    expect(response.url).toBe(`http://${server.hostname}:${server.port}/`);

    server.stop();
  });

  test("json response", async () => {
    const server = Bun.serve({
      async fetch(request, server) {
        expect(request.method).toBe("POST");
        const data = await request.json();
        expect(data).toEqual({ hello: "world" });

        return new Response("Hello world");
      },
    });

    const stream = await got.post(`http://${server.hostname}:${server.port}/`, { json: { hello: "world" } });
    expect(stream.body).toBe("Hello World!");

    server.stop();
  });
});

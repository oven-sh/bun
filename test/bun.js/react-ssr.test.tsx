import { serve } from "bun";
import { describe } from "bun:test";
import { it, expect } from "bun:test";
import { gc } from "./gc";
import { renderToReadableStream } from "./reactdom-bun";

describe("react-ssr", () => {
  var port = 8908;

  it("to text", async () => {
    const stream = await renderToReadableStream(<div>Hello</div>);
    gc();
    const response = new Response(stream);
    gc();
    const text = await response.text();
    gc();
    expect(text).toBe("<div>Hello</div>");
  });
  it("http server, 1 request", async () => {
    try {
      const server = serve({
        port: port++,
        async fetch(req) {
          return new Response(await renderToReadableStream(<div>Hello</div>));
        },
      });
      const resp = await fetch("http://localhost:" + server.port + "/");
      expect(await resp.text()).toBe("<div>Hello</div>");
      server.stop();
    } catch (e) {
      console.error(e);
    }
  });

  it("http server, 100 requests", async () => {
    const server = serve({
      port: port++,
      async fetch(req) {
        return new Response(await renderToReadableStream(<div>Hello</div>));
      },
    });
    var total = 0;
    gc();
    while (total < 100) {
      var buffer = new Array(4);
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] = fetch("http://localhost:" + server.port + "/");
      }
      gc();
      const responses = await Promise.all(buffer);
      for (let i = 0; i < buffer.length; i++) {
        expect(await responses[i].text()).toBe("<div>Hello</div>");
      }
      total += buffer.length;
      gc();
    }

    server.stop();
  });
});

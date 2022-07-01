import {
  concatArrayBuffers,
  readableStreamToArray,
  readableStreamToArrayBuffer,
  readableStreamToBlob,
  readableStreamToText,
  serve,
} from "bun";
import { describe, expect, it } from "bun:test";
import { renderToReadableStream as renderToReadableStreamBrowser } from "react-dom/server.browser";
import { gc } from "./gc";
import { renderToReadableStream as renderToReadableStreamBun } from "./reactdom-bun";

Object.defineProperty(renderToReadableStreamBrowser, "name", {
  value: "server.browser",
});
Object.defineProperty(renderToReadableStreamBun, "name", {
  value: "server.bun",
});
var port = 8908;

describe("ReactDOM", () => {
  for (let renderToReadableStream of [
    renderToReadableStreamBun,
    renderToReadableStreamBrowser,
  ]) {
    for (let [inputString, reactElement] of [
      // Needs at least six variations
      // - < 8 chars, latin1
      // - 8+ chars, latin1
      // - 16+ chars, latin1
      // - < 8 chars, utf16
      // - 8+ chars, utf16
      // - 16+ chars, utf16
      ["<a>b</a>", <a>b</a>],
      ["<span>Hello World!</span>", <span>Hello World!</span>],
      ["<a></a>", <a />],
      ["<span>😋</span>", <span>😋</span>],
      ["<a>😋</a>", <a>😋</a>],
      ["<span>Hello World! 😋</span>", <span>Hello World! 😋</span>],
      [
        "<span>Hello World!</span>😋",
        <>
          <span>Hello World!</span>😋
        </>,
      ],
      [
        "<span>😋Hello World!</span>",
        <>
          <span>😋Hello World!</span>
        </>,
      ],
      ["😋", <>😋</>],
      ["l😋l", <>l😋l</>],
      ["lo😋", <>lo😋</>],
      ["😋lo", <>😋lo</>],
      [
        "😋<span>Hello World!</span>",
        <>
          😋
          <span>Hello World!</span>
        </>,
      ],
      [
        "😋😋😋😋<span>Hello World!</span>",
        <>
          😋😋😋😋
          <span>Hello World!</span>
        </>,
      ],
      ["<span>Hello😋😋😋😋World!</span>", <span>Hello😋😋😋😋World!</span>],
      [
        "<span>Hello World!</span>😋😋😋😋",
        <>
          <span>Hello World!</span>
          😋😋😋😋
        </>,
      ],
      [
        "😋L😋l😋L😋<span>Alternating latin1 &amp; utf16</span>",
        <>
          😋L😋l😋L😋<span>Alternating latin1 &amp; utf16</span>
        </>,
      ],
      [
        "<span>Hello😋L😋l😋L😋World!</span>",
        <span>Hello😋L😋l😋L😋World!</span>,
      ],
      [
        "<span>Hello World!</span>😋L😋l😋L😋",
        <>
          <span>Hello World!</span>
          😋L😋l😋L😋
        </>,
      ],
    ])
      describe(`${renderToReadableStream.name}(${inputString})`, () => {
        it.only("http server, 1 request", async () => {
          var server;
          try {
            server = serve({
              port: port++,
              async fetch(req) {
                return new Response(await renderToReadableStream(reactElement));
              },
            });
            const resp = await fetch("http://localhost:" + server.port + "/");
            expect((await resp.text()).replaceAll("<!-- -->", "")).toBe(
              inputString
            );
            gc();
          } catch (e) {
            throw e;
          } finally {
            server?.stop();
            gc();
          }
        });

        it("Response.text()", async () => {
          const stream = await renderToReadableStream(reactElement);
          gc();
          const response = new Response(stream);
          gc();
          try {
            const text = await response.text();
            gc();
            expect(text.replaceAll("<!-- -->", "")).toBe(inputString);
            gc();
          } catch (e) {
            console.log(e.stack);
            throw e;
          }
        });

        it("Response.arrayBuffer()", async () => {
          const stream = await renderToReadableStream(reactElement);
          gc();
          const response = new Response(stream);
          gc();
          const text = new TextDecoder().decode(await response.arrayBuffer());
          gc();
          expect(text.replaceAll("<!-- -->", "")).toBe(inputString);
          gc();
        });

        it("Response.blob()", async () => {
          const stream = await renderToReadableStream(reactElement);
          gc();
          const response = new Response(stream);
          gc();
          const text = await (await response.blob()).text();
          gc();
          expect(text.replaceAll("<!-- -->", "")).toBe(inputString);
          gc();
        });

        it("readableStreamToText(stream)", async () => {
          const stream = await renderToReadableStream(reactElement);
          gc();
          const text = await readableStreamToText(stream);
          gc();
          expect(text.replaceAll("<!-- -->", "")).toBe(inputString);
          gc();
        });

        it("readableStreamToBlob(stream)", async () => {
          try {
            const stream = await renderToReadableStream(reactElement);
            gc();
            const blob = await readableStreamToBlob(stream);
            const text = await blob.text();
            gc();
            expect(text.replaceAll("<!-- -->", "")).toBe(inputString);
            gc();
          } catch (e) {
            console.error(e.message);
            console.error(e.stack);
            throw e;
          }
        });

        it("readableStreamToArray(stream)", async () => {
          const stream = await renderToReadableStream(reactElement);
          gc();
          const array = await readableStreamToArray(stream);
          const text =
            renderToReadableStream === renderToReadableStreamBun
              ? array.join("")
              : new TextDecoder().decode(concatArrayBuffers(array));
          gc();
          expect(text.replaceAll("<!-- -->", "")).toBe(inputString);
          gc();
        });

        it("readableStreamToArrayBuffer(stream)", async () => {
          const stream = await renderToReadableStream(reactElement);
          gc();
          const arrayBuffer = await readableStreamToArrayBuffer(stream);
          const text = new TextDecoder().decode(arrayBuffer);
          gc();
          expect(text.replaceAll("<!-- -->", "")).toBe(inputString);
          gc();
        });

        // it("http server, 100 requests", async () => {
        //   var server;
        //   try {
        //     server = serve({
        //       port: port++,
        //       async fetch(req) {
        //         return new Response(await renderToReadableStream(reactElement));
        //       },
        //     });
        //     var total = 0;
        //     gc();
        //     while (total++ < 100) {
        //       var attempt = total;
        //       const response = await fetch(
        //         "http://localhost:" + server.port + "/"
        //       );
        //       gc();
        //       const result = await response.text();
        //       try {
        //         expect(result.replaceAll("<!-- -->", "")).toBe(inputString);
        //       } catch (e) {
        //         e.message += "\nAttempt: " + attempt;
        //         throw e;
        //       }

        //       gc();
        //     }
        //   } catch (e) {
        //     throw e;
        //   } finally {
        //     server.stop();
        //   }
        // });
      });
  }
});

import {
  concatArrayBuffers,
  readableStreamToArray,
  readableStreamToBytes,
  readableStreamToArrayBuffer,
  readableStreamToBlob,
  readableStreamToText,
  serve,
  Server,
} from "bun";
import { describe, expect, it } from "bun:test";
import { expectMaxObjectTypeCount, gc } from "harness";
// @ts-ignore
import { renderToReadableStream as renderToReadableStreamBrowser } from "react-dom/server.browser";
import * as ReactDOM from "react-dom/server";
import * as React from "react";

Object.defineProperty(renderToReadableStreamBrowser, "name", {
  value: "server.browser",
});

const renderToReadableStreamBun = ReactDOM.renderToReadableStreamBun || {};
if (typeof renderToReadableStreamBun !== "function" && parseInt(ReactDOM.version.split(".")[0], 10) > 18) {
  if (!import.meta.resolveSync("react-dom/server").includes(".bun.")) {
    throw new Error(
      "react-dom/server.bun is not the correct version:\n  " + import.meta.resolveSync("react-dom/server"),
    );
  }
}

Object.defineProperty(renderToReadableStreamBun, "name", {
  value: "server.bun",
});

const fixtures = [
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
      😋<span>Hello World!</span>
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
  ["<span>Hello😋L😋l😋L😋World!</span>", <span>Hello😋L😋l😋L😋World!</span>],
  [
    "<span>Hello World!</span>😋L😋l😋L😋",
    <>
      <span>Hello World!</span>
      😋L😋l😋L😋
    </>,
  ],
] as const;

describe("React", () => {
  it("React.createContext works", () => {
    expect(typeof React.createContext).toBe("function");
    const pleaseDontThrow = React.createContext({ foo: true });
    expect((pleaseDontThrow as any).$$typeof.description).toBe("react.context");

    const pleaseDontThrow2 = (React as any).default.createContext({
      foo: true,
    });
    expect(pleaseDontThrow2.$$typeof.description).toBe("react.context");
  });
});

describe("ReactDOM", () => {
  for (let renderToReadableStream of [renderToReadableStreamBun, renderToReadableStreamBrowser]) {
    for (let [inputString, reactElement] of fixtures) {
      describe.skipIf(typeof renderToReadableStream !== "function")(
        `${renderToReadableStream?.name || "renderToReadableStream"}(${inputString})`,
        () => {
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
            } catch (e: any) {
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
            } catch (e: any) {
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
                : new TextDecoder().decode(concatArrayBuffers(array as any[]));
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
          it("readableStreamToBytes(stream)", async () => {
            const stream = await renderToReadableStream(reactElement);
            gc();
            const uint8 = await readableStreamToBytes(stream);
            const text = new TextDecoder().decode(uint8);
            gc();
            expect(text.replaceAll("<!-- -->", "")).toBe(inputString);
            gc();
          });
          it("for await (chunk of stream)", async () => {
            const stream = await renderToReadableStream(reactElement);
            gc();
            const chunks: any = [];
            for await (let chunk of stream) {
              chunks.push(chunk);
            }
            const text = await new Response(chunks).text();
            gc();
            expect(text.replaceAll("<!-- -->", "")).toBe(inputString);
            gc();
          });

          it("for await (chunk of stream) (arrayBuffer)", async () => {
            const stream = await renderToReadableStream(reactElement);
            gc();
            const chunks: any[] = [];
            for await (let chunk of stream) {
              chunks.push(chunk);
            }
            const text = new TextDecoder().decode(await new Response(chunks as any).arrayBuffer());
            gc();
            expect(text.replaceAll("<!-- -->", "")).toBe(inputString);
            gc();
          });
        },
      );
    }
  }
  for (let renderToReadableStream of [renderToReadableStreamBun, renderToReadableStreamBrowser]) {
    // there is an event loop bug that causes deadlocks
    // the bug is with `fetch`, not with the HTTP server
    for (let [inputString, reactElement] of fixtures) {
      describe.skipIf(typeof renderToReadableStream !== "function")(
        `${renderToReadableStream.name}(${inputString})`,
        () => {
          it("http server, 1 request", async () => {
            await (async () => {
              var server;
              try {
                server = serve({
                  port: 0,
                  async fetch(req) {
                    return new Response(await renderToReadableStream(reactElement), {
                      headers: {
                        "X-React": "1",
                      },
                    });
                  },
                });
                const response = await fetch("http://localhost:" + server.port + "/");
                const result = await response.text();
                expect(result.replaceAll("<!-- -->", "")).toBe(inputString);
                expect(response.headers.get("X-React")).toBe("1");
              } finally {
                server?.stop(true);
              }
            })();
            await expectMaxObjectTypeCount(expect, "ReadableHTTPResponseSinkController", 2);
          });
          const count = 4;
          it(`http server, ${count} requests`, async () => {
            var remain = count;
            await (async () => {
              let server!: Server;
              try {
                server = serve({
                  port: 0,
                  async fetch(req) {
                    return new Response(await renderToReadableStream(reactElement));
                  },
                });
                while (remain--) {
                  var attempt = remain + 1;
                  const response = await fetch("http://localhost:" + server.port + "/");
                  const result = await response.text();
                  try {
                    expect(result.replaceAll("<!-- -->", "")).toBe(inputString);
                  } catch (e: any) {
                    e.message += "\nAttempt: " + attempt;
                    throw e;
                  }
                }
              } finally {
                server?.stop(true);
              }
            })();
            expect(remain).toBe(-1);
            await expectMaxObjectTypeCount(expect, "ReadableHTTPResponseSinkController", 3);
          });
        },
      );
    }
  }
});

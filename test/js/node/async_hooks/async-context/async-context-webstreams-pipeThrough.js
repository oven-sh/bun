process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const assert = require("assert");
const http = require("http");

const storage = new AsyncLocalStorage();
const store = () => storage.getStore() ?? "no store";

// The server sends the next piece, and then the end of the body, only after the client has
// seen the piece before it. So the end of the body arrives in an event of its own.
let seenByClient;
const server = http.createServer(async (request, response) => {
  for (let piece = 0; piece < 3; piece++) {
    const seen = new Promise(resolve => (seenByClient = resolve));
    response.write("piece");
    await seen;
  }
  response.end();
});

// Over a fetch() body, flush() and close() run in the context that transform() and write() run in.
async function main() {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const seen = { pipeThrough: [], pipeTo: [] };

  {
    const response = await fetch(url);
    const reader = storage
      .run("pipeThrough", () =>
        response.body.pipeThrough(
          new TransformStream({
            transform(chunk, controller) {
              seen.pipeThrough.push("transform: " + store());
              controller.enqueue(chunk);
              seenByClient();
            },
            flush() {
              seen.pipeThrough.push("flush: " + store());
            },
          }),
        ),
      )
      .getReader();
    while (!(await reader.read()).done);
  }
  {
    const response = await fetch(url);
    await storage.run("pipeTo", () =>
      response.body.pipeTo(
        new WritableStream({
          write() {
            seen.pipeTo.push("write: " + store());
            seenByClient();
          },
          close() {
            seen.pipeTo.push("close: " + store());
          },
        }),
      ),
    );
  }

  assert.deepStrictEqual(seen, {
    pipeThrough: ["transform: pipeThrough", "transform: pipeThrough", "transform: pipeThrough", "flush: pipeThrough"],
    pipeTo: ["write: pipeTo", "write: pipeTo", "write: pipeTo", "close: pipeTo"],
  });
  process.exit(0);
}

main();

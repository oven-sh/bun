import { test } from "bun:test";
import { once } from "node:events";
import { createServer } from "node:http";
test.todo("abort the request on the other side if the stream is canceled", async () => {
  const { promise: abort, resolve: resolveAbort } = Promise.withResolvers();
  await using server = createServer((req, res) => {
    res.writeHead(200);
    res.write("hello");
    req.on("aborted", resolveAbort);
    // Let's not end the response on purpose
  }).listen(0);
  await once(server, "listening");

  const url = new URL(`http://127.0.0.1:${server.address().port}`);

  const response = await fetch(url);

  const reader = response.body.getReader();

  try {
    await reader.read();
  } finally {
    reader.releaseLock();
    await response.body.cancel();
  }

  await abort;
});

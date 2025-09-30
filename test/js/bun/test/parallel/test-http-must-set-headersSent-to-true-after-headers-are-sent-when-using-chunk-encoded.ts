import { createTest } from "node-harness";
import { once } from "node:events";
import { createServer } from "node:http";
const { expect } = createTest(import.meta.path);

const server = createServer().listen(0);
try {
  await once(server, "listening");
  fetch(`http://localhost:${server.address().port}`).then(res => res.text());
  const [req, res] = await once(server, "request");
  expect(res.headersSent).toBe(false);
  const { promise, resolve } = Promise.withResolvers();
  res.write("first", () => {
    res.write("second", () => {
      res.end("OK", resolve);
    });
  });
  await promise;
  expect(res.headersSent).toBe(true);
} finally {
  server.close();
}

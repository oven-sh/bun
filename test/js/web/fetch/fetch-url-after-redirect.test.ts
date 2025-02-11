import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { promisify } from "node:util";

test("after redirecting the url of the response is set to the target url", async () => {
  // redirect-1 -> redirect-2 -> target
  await using server = createServer((req, res) => {
    switch (res.req.url) {
      case "/redirect-1":
        res.writeHead(302, undefined, { Location: "/redirect-2" });
        res.end();
        break;
      case "/redirect-2":
        res.writeHead(302, undefined, { Location: "/redirect-3" });
        res.end();
        break;
      case "/redirect-3":
        res.writeHead(302, undefined, { Location: "/target" });
        res.end();
        break;
      case "/target":
        res.writeHead(200, "dummy", { "Content-Type": "text/plain" });
        res.end();
        break;
    }
  });

  const listenAsync = promisify(server.listen.bind(server));
  await listenAsync(0);
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/redirect-1`);

  expect(response.url).toBe(`http://127.0.0.1:${port}/target`);
});

test("location header with non-ASCII character redirects to a properly encoded url", async () => {
  // redirect -> %EC%95%88%EB%85%95 (안녕), not %C3%AC%C2%95%C2%88%C3%AB%C2%85%C2%95
  await using server = createServer((req, res) => {
    if (res.req.url.endsWith("/redirect")) {
      res.writeHead(302, undefined, { Location: `/${Buffer.from("안녕").toString("binary")}` });
      res.end();
    } else {
      res.writeHead(200, "dummy", { "Content-Type": "text/plain" });
      res.end();
    }
  });

  const listenAsync = promisify(server.listen.bind(server));
  await listenAsync(0);
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/redirect`);

  expect(response.url).toBe(`http://127.0.0.1:${port}/${encodeURIComponent("안녕")}`);
});

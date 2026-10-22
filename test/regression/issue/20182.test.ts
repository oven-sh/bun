import { expect, test } from "bun:test";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// https://github.com/oven-sh/bun/issues/20182
// server.reload() on the server behind a node:http server cleared node:http's
// request handler whenever the options did not name it, so a reload that only
// added static routes made every other request answer 404.
test("server.reload() with static routes keeps the request handler of a node:http server", async () => {
  const httpServer = createServer((request, response) => response.end("node:http handler"));
  await once(httpServer.listen(0, "127.0.0.1"), "listening");
  try {
    const { port } = httpServer.address() as AddressInfo;
    const ask = async (path: string) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      return `${response.status} ${await response.text()}`;
    };
    expect(await ask("/")).toBe("200 node:http handler");

    const server = (httpServer as any)[Symbol.for("::bunternal::")] as Bun.Server<undefined>;
    server.reload({ static: { "/api/time": new Response("static route") } } as any);

    expect({ "/": await ask("/"), "/api/time": await ask("/api/time") }).toEqual({
      "/": "200 node:http handler",
      "/api/time": "200 static route",
    });
  } finally {
    httpServer.closeAllConnections();
    httpServer.close();
  }
});

// This test also runs in Node.js. Do not add Bun-only assertions.
import { expect, test } from "bun:test";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";

// Node's implicit header path is _implicitHeader() -> writeHead(this.statusCode),
// and writeHead coerces via |= 0 and range-checks. So `res.statusCode = '404'`
// reaches the wire as 404 with the body intact, '204' still drops the body,
// and a non-numeric string throws ERR_HTTP_INVALID_STATUS_CODE from end().
test("statusCode assigned as a numeric string is coerced like writeHead()", async () => {
  const { promise: typesP, resolve: typesR } = Promise.withResolvers<[string, string]>();
  const { promise: errP, resolve: errR } = Promise.withResolvers<unknown>();
  const server = createServer((req, res) => {
    if (req.url === "/404") {
      res.statusCode = "404" as never;
      const before = typeof (res.statusCode as unknown);
      res.end("not found");
      typesR([before, typeof (res.statusCode as unknown)]);
    } else if (req.url === "/204") {
      res.statusCode = "204" as never;
      res.end("dropped");
    } else if (req.url === "/204w") {
      res.statusCode = "204" as never;
      res.write("dropped");
      res.end();
    } else {
      res.statusCode = "abc" as never;
      try {
        res.end("x");
        errR(undefined);
      } catch (e) {
        errR(e);
      }
      res.destroy();
    }
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const wire = (path: string) =>
      new Promise<string>(resolve => {
        const socket = connect(port, "127.0.0.1");
        let data = "";
        socket.on("data", chunk => (data += chunk));
        socket.on("error", () => {});
        socket.on("close", () => resolve(data));
        socket.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
      });

    const out404 = await wire("/404");
    expect(out404).toStartWith("HTTP/1.1 404 Not Found\r\n");
    expect(out404).toEndWith("not found");
    expect(await typesP).toEqual(["string", "number"]);

    for (const p of ["/204", "/204w"]) {
      const out204 = await wire(p);
      expect(out204).toStartWith("HTTP/1.1 204 No Content\r\n");
      expect(out204).not.toContain("dropped");
      expect(out204).not.toContain("Transfer-Encoding");
      expect(out204).toEndWith("\r\n\r\n");
    }

    const outBad = await wire("/bad");
    const err = (await errP) as NodeJS.ErrnoException;
    expect(err).toBeInstanceOf(RangeError);
    expect(err?.code).toBe("ERR_HTTP_INVALID_STATUS_CODE");
    expect(outBad).toBe("");
  } finally {
    server.close();
  }
});

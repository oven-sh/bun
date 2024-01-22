import { test, expect, mock, afterAll } from "bun:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createServer } from "node:http";
import { reject } from "lodash";

let server: Server;

test("can set statusCode and statusMessage on IncomingMessage", async () => {
  const fn = mock((req, res) => {
    req.statusCode = 404;
    expect(req.statusCode).toBe(404);
    req.statusMessage = "Who dis?";
    expect(req.statusMessage).toBe("Who dis?");
    res.end();
  });
  server = createServer(fn).listen(0);
  const url = await new Promise<string>(resolve => {
    server.on("listening", async () => {
      const { address, port, family } = server.address() as AddressInfo;
      resolve(`http://${family === "IPv6" ? `[${address}]` : address}:${port}/`);
    });
    server.on("error", reject);
  });
  expect(fetch(url)).resolves.toBeInstanceOf(Response);
  expect(fn).toHaveBeenCalledTimes(1);
});

afterAll(() => {
  server?.close();
});

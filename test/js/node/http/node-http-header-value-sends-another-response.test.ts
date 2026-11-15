import { expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";

function request(port: number, path: string): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const socket = net.connect(port, "127.0.0.1", () => socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\n\r\n`));
  let received = "";
  socket.setEncoding("latin1");
  socket.on("data", chunk => {
    received += chunk;
    const head = received.indexOf("\r\n\r\n");
    const length = /^content-length: (\d+)$/im.exec(received)?.[1];
    if (head !== -1 && length !== undefined && received.length >= head + 4 + Number(length)) {
      socket.destroy();
      resolve(received);
    }
  });
  socket.on("error", reject);
  socket.on("end", () => resolve(received));
  return promise;
}

const headerNames = (response: string) =>
  response
    .slice(0, response.indexOf("\r\n\r\n"))
    .split("\r\n")
    .slice(1)
    .filter(line => !/^date:/i.test(line))
    .sort();

test("a header value whose toString() ends another response does not change this response's own headers", async () => {
  let waiting: http.ServerResponse | undefined;
  const isWaiting = Promise.withResolvers<void>();
  const server = http.createServer((req, res) => {
    if (req.url === "/waiting") {
      waiting = res;
      isWaiting.resolve();
      return;
    }
    let isSet = false;
    const value = {
      toString() {
        if (isSet && waiting) {
          const other = waiting;
          waiting = undefined;
          other.setHeader("Connection", "close");
          other.end("waited");
        }
        return "value";
      },
    };
    res.setHeader("X-List", [value as unknown as string]);
    isSet = true;
    res.end("asked");
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const waited = request(port, "/waiting");
    await isWaiting.promise;
    const asked = await request(port, "/asking");
    expect({ asked: headerNames(asked), waited: headerNames(await waited) }).toEqual({
      asked: ["Connection: keep-alive", "Content-Length: 5", "Keep-Alive: timeout=5", "X-List: value"],
      waited: ["Connection: close", "Content-Length: 6"],
    });
  } finally {
    server.close();
    server.closeAllConnections();
  }
});

test("a body of other than ASCII that is too large to be written with its head arrives whole", async () => {
  const body = "café 你好 ".repeat(4_000);
  const server = http.createServer((_, res) => res.end(body));
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength(body)));
    expect(await response.text()).toBe(body);
  } finally {
    server.close();
    server.closeAllConnections();
  }
});

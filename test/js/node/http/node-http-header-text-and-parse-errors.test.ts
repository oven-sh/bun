import { expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";

async function exchange(listener: net.Server, write: (client: net.Socket) => Promise<void> | void) {
  await once(listener.listen(0, "127.0.0.1"), "listening");
  try {
    const client = net.connect((listener.address() as net.AddressInfo).port, "127.0.0.1");
    let wire = "";
    client.setEncoding("latin1").on("data", text => (wire += text));
    client.on("error", () => {});
    const closed = once(client, "close");
    await write(client);
    await closed;
    return wire;
  } finally {
    listener.close();
  }
}

test.each(["value", "name"])("a header %s that cannot become a string leaves the response unsent", async part => {
  const unprintable = {
    toString() {
      throw new Error("no text");
    },
  };
  const server = http.createServer((req, res) => {
    const values = ["a=1", "b=2"];
    res.setHeader("x-first", "1");
    res.setHeader("cookie", values);
    if (part === "value") values.join = () => unprintable as any;
    else (res as any)._headerNames = { cookie: unprintable };
    try {
      res.end("first");
    } catch {
      res.removeHeader("cookie");
      res.statusCode = 500;
      res.end("second");
    }
  });
  const wire = await exchange(server, client => {
    client.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
  });
  expect(wire).toStartWith("HTTP/1.1 500 ");
  expect(wire.match(/x-first/g)).toHaveLength(1);
  expect(wire).toEndWith("second");
});

test('emit("connection"): a parse error does not write into a response that has started', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Length": "30" });
    res.write("0123456789");
  });
  const wire = await exchange(
    net.createServer(socket => server.emit("connection", socket)),
    async client => {
      client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
      let seen = "";
      while (!seen.endsWith("0123456789")) seen += (await once(client, "data"))[0];
      client.write("this is not http\r\n\r\n");
    },
  );
  expect(wire).toEndWith("\r\n\r\n0123456789");
});

test('emit("connection"): clientError fires once when its listener destroys with the error', async () => {
  const codes: string[] = [];
  const server = http.createServer(() => {});
  server.on("clientError", (error: NodeJS.ErrnoException, socket) => {
    codes.push(error.code!);
    socket.destroy(error);
  });
  const { promise: closed, resolve } = Promise.withResolvers<void>();
  await exchange(
    net.createServer(socket => {
      socket.on("close", () => resolve());
      server.emit("connection", socket);
    }),
    client => {
      client.write("this is not http\r\n\r\n");
    },
  );
  await closed;
  expect(codes).toEqual(["HPE_INVALID_METHOD"]);
});

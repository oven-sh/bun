// @ts-nocheck
// can't use @types/express or @types/body-parser because they
// depend on @types/node which conflicts with bun-types
import { json } from "body-parser";
import { expect, test } from "bun:test";
import express, { Application, Request, Response } from "express";
import net from "net";
// Express uses iconv-lite
test("iconv works", () => {
  var iconv = require("iconv-lite");

  // Convert from an encoded buffer to a js string.
  var str = iconv.decode(Buffer.from([0x68, 0x65, 0x6c, 0x6c, 0x6f]), "win1251");

  // Convert from a js string to an encoded buffer.
  var buf = iconv.encode("Sample input string", "win1251");
  expect(str).toBe("hello");
  expect(iconv.decode(buf, "win1251")).toBe("Sample input string");

  // Check if encoding is supported
  expect(iconv.encodingExists("us-ascii")).toBe(true);
});

// https://github.com/oven-sh/bun/issues/1913
test("httpServer", async () => {
  // Constants
  const PORT = 8412;

  // App handlers
  const app: Application = express();
  const httpServer = require("http").createServer(app);

  app.on("error", err => {
    console.error(err);
  });
  app.use(json());

  let closeCount = 0;
  let responseCloseCount = 0;
  var reached = false;
  // This throws a TypeError since it uses body-parser.json
  app.post("/ping", (request: Request, response: Response) => {
    request.on("close", () => {
      if (closeCount++ === 1) {
        throw new Error("request Close called multiple times");
      }
    });
    response.on("close", () => {
      if (responseCloseCount++ === 1) {
        throw new Error("response Close called multiple times");
      }
    });
    expect(request.body).toEqual({ hello: "world" });
    expect(request.query).toStrictEqual({
      hello: "123",
      hi: "",
    });
    reached = true;
    response.status(200).send("POST - pong");
    httpServer.close();
  });

  httpServer.listen(PORT);
  const resp = await fetch(`http://localhost:${PORT}/ping?hello=123&hi`, {
    method: "POST",
    body: JSON.stringify({ hello: "world" }),
    headers: {
      "Content-Type": "application/json",
    },
  });
  expect(await resp.text()).toBe("POST - pong");
  expect(resp.status).toBe(200);

  expect(reached).toBe(true);
});

test("GET with body-parser", async () => {
  const app = express();

  app.use(express.json());
  app.get("/", (req, res) => {
    expect(req.body).toEqual({ "name": "John Doe", "email": "john.doe@example.com" });
    req.res.send("Hello World!");
  });

  function doGet(hostname, port) {
    const { promise, resolve, reject } = Promise.withResolvers();
    const socket = net.createConnection(port, hostname);
    const payload = Buffer.from(JSON.stringify({ "name": "John Doe", "email": "john.doe@example.com" }));
    socket.write(`GET / HTTP/1.1\r\n`);
    socket.write(`Host: ${hostname}\r\n`);
    socket.write(`Content-Length: ${payload.byteLength}\r\n`);
    socket.write(`Content-Type: application/json\r\n`);
    socket.write(`Connection: close\r\n`);
    socket.write(`\r\n`);
    socket.write(payload);
    const body = [];
    socket.on("data", data => {
      body.push(data);
    });
    socket.on("end", () => {
      const response = Buffer.concat(body).toString();

      const parts = response.split("\r\n\r\n");
      const headers = parts[0]
        ?.trim()
        ?.split("\r\n")
        ?.reduce((acc, line, index) => {
          if (index === 0) {
            acc["status"] = Number(line.split(" ")[1]);
          } else {
            const [key, value] = line.split(": ");
            acc[key?.toLowerCase()] = value;
          }
          return acc;
        }, {});

      resolve({ headers, body: parts[1] });
      socket.end();
    });
    socket.on("error", reject);
    return promise;
  }

  const { promise: listening, resolve, reject } = Promise.withResolvers();

  const server = app.listen(0, async (...args) => {
    const [err, hostname, port] = args;
    if (err) {
      reject(err);
      return;
    }
    resolve({ hostname, port });
  });

  try {
    const { hostname, port } = await listening;

    const { headers, body } = await doGet(hostname, port);
    expect(headers["status"]).toBe(200);
    expect(headers["content-length"]).toBe("12");
    expect(body).toBe("Hello World!");
  } finally {
    server.close();
  }
});

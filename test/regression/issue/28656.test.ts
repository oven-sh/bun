import { expect, test } from "bun:test";
import { tls } from "harness";
import http2 from "node:http2";
import https from "node:https";

test("http2.createSecureServer with allowHTTP1 handles HTTP/1.1 requests", async () => {
  const { promise: listening, resolve: onListening } = Promise.withResolvers<number>();
  const {
    promise: done,
    resolve: onDone,
    reject: onError,
  } = Promise.withResolvers<{
    status: number;
    body: string;
    httpVersion: string;
  }>();

  const server = http2.createSecureServer(
    {
      allowHTTP1: true,
      ...tls,
    },
    (req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
    },
  );

  server.listen(0, () => {
    onListening((server.address() as any).port);
  });

  const port = await listening;

  const req = https.get(`https://localhost:${port}`, { rejectUnauthorized: false }, res => {
    let data = "";
    res.on("data", (chunk: any) => (data += chunk));
    res.on("end", () => {
      onDone({
        status: res.statusCode!,
        body: data,
        httpVersion: res.httpVersion,
      });
    });
  });
  req.on("error", onError);

  const result = await done;
  expect(result).toEqual({
    status: 200,
    body: "ok",
    httpVersion: "1.1",
  });

  server.close();
});

test("http2.createSecureServer with allowHTTP1 still handles HTTP/2 requests", async () => {
  const { promise: listening, resolve: onListening } = Promise.withResolvers<number>();

  const server = http2.createSecureServer(
    {
      allowHTTP1: true,
      ...tls,
    },
    (req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok-h2");
    },
  );

  server.listen(0, () => {
    onListening((server.address() as any).port);
  });

  const port = await listening;

  const {
    promise: done,
    resolve: onDone,
    reject: onError,
  } = Promise.withResolvers<{
    status: number;
    body: string;
  }>();

  const client = http2.connect(`https://localhost:${port}`, { rejectUnauthorized: false });
  client.on("error", onError);

  const h2req = client.request({ ":path": "/" });
  let data = "";
  let status = 0;
  h2req.on("response", headers => {
    status = headers[":status"] as number;
  });
  h2req.on("data", (chunk: any) => (data += chunk));
  h2req.on("end", () => {
    onDone({ status, body: data });
  });
  h2req.end();

  const result = await done;
  expect(result).toEqual({
    status: 200,
    body: "ok-h2",
  });

  client.close();
  server.close();
});

test("http2.createSecureServer without allowHTTP1 rejects HTTP/1.1", async () => {
  const { promise: listening, resolve: onListening } = Promise.withResolvers<number>();

  const server = http2.createSecureServer(
    {
      allowHTTP1: false,
      ...tls,
    },
    (_req, res) => {
      res.end("should not reach");
    },
  );

  server.listen(0, () => {
    onListening((server.address() as any).port);
  });

  const port = await listening;

  const { promise: done, resolve: onDone } = Promise.withResolvers<string>();

  const req = https.get(`https://localhost:${port}`, { rejectUnauthorized: false }, res => {
    let data = "";
    res.on("data", (chunk: any) => (data += chunk));
    res.on("end", () => onDone("unexpected-success:" + data));
  });
  req.on("error", (e: any) => onDone("error:" + e.code));

  const result = await done;
  // Should get a connection error since the server rejects HTTP/1.1
  expect(result).toStartWith("error:");

  server.close();
});

test("http2.createSecureServer allowHTTP1 handles request with body", async () => {
  const { promise: listening, resolve: onListening } = Promise.withResolvers<number>();

  const server = http2.createSecureServer(
    {
      allowHTTP1: true,
      ...tls,
    },
    (req, res) => {
      let body = "";
      req.on("data", (chunk: any) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: body }));
      });
    },
  );

  server.listen(0, () => {
    onListening((server.address() as any).port);
  });

  const port = await listening;

  const {
    promise: done,
    resolve: onDone,
    reject: onError,
  } = Promise.withResolvers<{
    status: number;
    body: string;
  }>();

  const options = {
    hostname: "localhost",
    port,
    path: "/test",
    method: "POST",
    rejectUnauthorized: false,
    headers: { "Content-Type": "text/plain" },
  };

  const req = https.request(options, res => {
    let data = "";
    res.on("data", (chunk: any) => (data += chunk));
    res.on("end", () => {
      onDone({ status: res.statusCode!, body: data });
    });
  });
  req.on("error", onError);
  req.write("hello world");
  req.end();

  const result = await done;
  expect(result.status).toBe(200);
  expect(JSON.parse(result.body)).toEqual({ received: "hello world" });

  server.close();
});

test("http2.createSecureServer allowHTTP1 streaming write() then end()", async () => {
  const { promise: listening, resolve: onListening } = Promise.withResolvers<number>();

  const server = http2.createSecureServer(
    {
      allowHTTP1: true,
      ...tls,
    },
    (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write("part1-");
      res.write("part2-");
      res.end("part3");
    },
  );

  server.listen(0, () => {
    onListening((server.address() as any).port);
  });

  const port = await listening;

  const { promise: done, resolve: onDone, reject: onError } = Promise.withResolvers<{
    status: number;
    body: string;
  }>();

  const req = https.get(`https://localhost:${port}`, { rejectUnauthorized: false }, (res) => {
    let data = "";
    res.on("data", (chunk: any) => (data += chunk));
    res.on("end", () => {
      onDone({ status: res.statusCode!, body: data });
    });
  });
  req.on("error", onError);

  const result = await done;
  expect(result).toEqual({
    status: 200,
    body: "part1-part2-part3",
  });

  server.close();
});

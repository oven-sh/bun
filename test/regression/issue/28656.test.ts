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
    contentType: string | undefined;
    custom: string | undefined;
  }>();

  const server = http2.createSecureServer(
    {
      allowHTTP1: true,
      ...tls,
    },
    (req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain", "X-Custom-Header": "custom-value" });
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
        // The response headers set via writeHead must survive the HTTP/1.1
        // fallback intact (the fallback previously mangled the flat header
        // array, emitting "c: o" instead of "content-type: text/plain").
        contentType: res.headers["content-type"],
        custom: res.headers["x-custom-header"],
      });
    });
  });
  req.on("error", onError);

  const result = await done;
  expect(result).toEqual({
    status: 200,
    body: "ok",
    httpVersion: "1.1",
    contentType: "text/plain",
    custom: "custom-value",
  });

  server.close();
});

test("http2.createSecureServer with allowHTTP1 honors res.sendDate = false", async () => {
  const { promise: listening, resolve: onListening } = Promise.withResolvers<number>();
  const {
    promise: done,
    resolve: onDone,
    reject: onError,
  } = Promise.withResolvers<{
    date: string | undefined;
    contentType: string | undefined;
    body: string;
  }>();

  const server = http2.createSecureServer(
    {
      allowHTTP1: true,
      ...tls,
    },
    (req, res) => {
      // renderNativeHeaders() omits Date when sendDate is false, so the
      // fallback must not re-synthesize it (it used to add Date unconditionally).
      res.sendDate = false;
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
        date: res.headers["date"],
        contentType: res.headers["content-type"],
        body: data,
      });
    });
  });
  req.on("error", onError);

  const result = await done;
  expect(result).toEqual({
    date: undefined,
    contentType: "text/plain",
    body: "ok",
  });

  server.close();
});

test("http2.createSecureServer with allowHTTP1 sends Keep-Alive on persistent connections", async () => {
  const { promise: listening, resolve: onListening } = Promise.withResolvers<number>();
  const {
    promise: done,
    resolve: onDone,
    reject: onError,
  } = Promise.withResolvers<{
    connection: string | undefined;
    keepAlive: string | undefined;
    body: string;
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

  // keepAlive advertises a persistent connection, which is what makes the
  // server emit Connection: keep-alive together with Keep-Alive: timeout=N.
  const agent = new https.Agent({ keepAlive: true });
  const req = https.get(`https://localhost:${port}`, { rejectUnauthorized: false, agent }, res => {
    let data = "";
    res.on("data", (chunk: any) => (data += chunk));
    res.on("end", () => {
      onDone({
        connection: res.headers["connection"],
        // renderNativeHeaders() only emits Keep-Alive when res._keepAliveTimeout
        // is set, so connectionListenerHTTP1 must set it like the node:http path.
        keepAlive: res.headers["keep-alive"],
        body: data,
      });
    });
  });
  req.on("error", onError);

  const result = await done;
  expect(result).toEqual({
    connection: "keep-alive",
    keepAlive: "timeout=5",
    body: "ok",
  });

  agent.destroy();
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

  const { promise: done, resolve: onDone } = Promise.withResolvers<{
    status?: number;
    body?: string;
    error?: string;
  }>();

  const req = https.get(`https://localhost:${port}`, { rejectUnauthorized: false }, res => {
    let data = "";
    res.on("data", (chunk: any) => (data += chunk));
    res.on("end", () => onDone({ status: res.statusCode!, body: data }));
  });
  req.on("error", (e: any) => onDone({ error: e.code }));

  const result = await done;
  // The HTTP/1.1 request must be rejected: the request handler is never reached.
  // Node sends a 403 "Missing ALPN Protocol" response (or the connection errors out);
  // either way the application's "should not reach" body is never delivered.
  expect(result.body ?? "").not.toContain("should not reach");
  if (result.error === undefined) {
    expect(result.status).toBe(403);
  }

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

  const {
    promise: done,
    resolve: onDone,
    reject: onError,
  } = Promise.withResolvers<{
    status: number;
    body: string;
  }>();

  const req = https.get(`https://localhost:${port}`, { rejectUnauthorized: false }, res => {
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

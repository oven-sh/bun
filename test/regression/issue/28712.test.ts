import { expect, test } from "bun:test";
import { tls } from "harness";
import http2 from "node:http2";

test("HTTP/2 server push streams work", async () => {
  let client: ReturnType<typeof http2.connect> | undefined;
  const {
    promise: done,
    resolve,
    reject,
  } = Promise.withResolvers<{
    mainBody: string;
    pushPath: string;
    pushData: string;
    pushResponseStatus: number;
  }>();

  const server = http2.createSecureServer({ key: tls.key, cert: tls.cert });

  function cleanup() {
    try {
      client?.close();
    } catch {}
    try {
      server.close();
    } catch {}
  }

  server.on("stream", (stream, _headers) => {
    stream.pushStream({ ":path": "/style.css" }, (err: Error | null, pushStream: any) => {
      if (err) {
        cleanup();
        reject(err);
        return;
      }
      pushStream.on("error", () => {});
      pushStream.respond({
        [http2.constants.HTTP2_HEADER_STATUS]: 200,
        [http2.constants.HTTP2_HEADER_CONTENT_TYPE]: "text/css",
      });
      pushStream.end("body { background: red; }");
    });

    stream.on("error", () => {});
    stream.respond({
      [http2.constants.HTTP2_HEADER_STATUS]: 200,
      [http2.constants.HTTP2_HEADER_CONTENT_TYPE]: "text/html",
    });
    stream.end("main response");
  });

  server.on("error", () => {});

  server.listen(0, () => {
    const port = (server.address() as any).port;
    client = http2.connect(`https://localhost:${port}`, {
      rejectUnauthorized: false,
    });
    client.on("error", (err: Error) => {
      cleanup();
      reject(err);
    });

    let pushPath: string | null = null;
    let pushData: string | null = null;
    let pushResponseStatus: number | null = null;
    let mainBody: string | null = null;

    function maybeFinish() {
      if (mainBody !== null && pushData !== null && pushPath !== null && pushResponseStatus !== null) {
        resolve({ mainBody, pushPath, pushData, pushResponseStatus });
        cleanup();
      }
    }

    client.on("stream", (pushedStream: any, headers: any) => {
      // Push promise request headers have :path; response headers have :status.
      const path = headers[":path"];
      if (!path) return;
      pushPath = path as string;
      pushedStream.setEncoding?.("utf8");
      pushedStream.on("error", () => {});
      // Node emits 'push' (not 'response') for a pushed stream's final
      // response headers. Capture :status so we exercise the event name.
      pushedStream.on("push", (pushResponseHeaders: any) => {
        pushResponseStatus = pushResponseHeaders[":status"];
      });
      let data = "";
      pushedStream.on("data", (chunk: any) => (data += chunk));
      pushedStream.on("end", () => {
        pushData = data;
        maybeFinish();
      });
    });

    const req = client.request({ ":path": "/" });
    req.setEncoding("utf8");
    req.on("error", () => {});
    let body = "";
    req.on("data", (chunk: any) => (body += chunk));
    req.on("end", () => {
      mainBody = body;
      maybeFinish();
    });
    req.end();
  });

  try {
    const result = await done;
    expect(result).toEqual({
      mainBody: "main response",
      pushPath: "/style.css",
      pushData: "body { background: red; }",
      pushResponseStatus: 200,
    });
  } finally {
    cleanup();
  }
});

test("nested pushStream() throws ERR_HTTP2_NESTED_PUSH", async () => {
  let client: ReturnType<typeof http2.connect> | undefined;
  const { promise: done, resolve, reject } = Promise.withResolvers<string | undefined>();

  const server = http2.createSecureServer({ key: tls.key, cert: tls.cert });

  function cleanup() {
    try {
      client?.close();
    } catch {}
    try {
      server.close();
    } catch {}
  }

  server.on("stream", (stream: any) => {
    stream.on("error", () => {});
    stream.pushStream({ ":path": "/a.css" }, (err: Error | null, pushStream: any) => {
      if (err) {
        cleanup();
        reject(err);
        return;
      }
      pushStream.on("error", () => {});
      let nestedCode: string | undefined;
      try {
        // Nested push — must throw ERR_HTTP2_NESTED_PUSH synchronously per
        // RFC 7540 §6.6 and Node.js ServerHttp2Stream.pushStream semantics.
        pushStream.pushStream({ ":path": "/b.css" }, () => {});
      } catch (e: any) {
        nestedCode = e?.code;
      }
      pushStream.respond({ [http2.constants.HTTP2_HEADER_STATUS]: 200 });
      pushStream.end("a");
      resolve(nestedCode);
    });
    stream.respond({ [http2.constants.HTTP2_HEADER_STATUS]: 200 });
    stream.end("root");
  });

  server.on("error", () => {});
  server.listen(0, () => {
    const port = (server.address() as any).port;
    client = http2.connect(`https://localhost:${port}`, { rejectUnauthorized: false });
    client.on("error", (err: Error) => {
      cleanup();
      reject(err);
    });
    client.on("stream", (pushedStream: any) => {
      pushedStream.on("error", () => {});
      pushedStream.resume();
    });
    const req = client.request({ ":path": "/" });
    req.on("error", () => {});
    req.resume();
    req.on("end", () => {});
    req.end();
  });

  try {
    const code = await done;
    expect(code).toBe("ERR_HTTP2_NESTED_PUSH");
  } finally {
    cleanup();
  }
});

test("pushStream() inherits :authority from the client's request headers", async () => {
  let client: ReturnType<typeof http2.connect> | undefined;
  const { promise: done, resolve, reject } = Promise.withResolvers<string | undefined>();

  const server = http2.createSecureServer({ key: tls.key, cert: tls.cert });

  function cleanup() {
    try {
      client?.close();
    } catch {}
    try {
      server.close();
    } catch {}
  }

  server.on("stream", (stream: any) => {
    stream.on("error", () => {});
    // Omit :authority from the push headers so pushStream() has to derive it
    // from the inbound request headers (Node: stream[kHeaders][':authority']).
    // Without the fix, it would fall back to "localhost".
    stream.pushStream({ ":path": "/a.css" }, (err: Error | null, pushStream: any) => {
      if (err) {
        cleanup();
        reject(err);
        return;
      }
      pushStream.on("error", () => {});
      pushStream.respond({ [http2.constants.HTTP2_HEADER_STATUS]: 200 });
      pushStream.end("a");
    });
    stream.respond({ [http2.constants.HTTP2_HEADER_STATUS]: 200 });
    stream.end("root");
  });

  server.on("error", () => {});
  server.listen(0, () => {
    const port = (server.address() as any).port;
    client = http2.connect(`https://localhost:${port}`, { rejectUnauthorized: false });
    client.on("error", (err: Error) => {
      cleanup();
      reject(err);
    });
    client.on("stream", (pushedStream: any, pushHeaders: any) => {
      pushedStream.on("error", () => {});
      pushedStream.resume();
      resolve(pushHeaders[":authority"]);
    });
    // Send the request with a distinct :authority so the fallback "localhost"
    // path would not coincidentally match.
    const req = client.request({ ":path": "/", ":authority": `localhost:${port}` });
    req.on("error", () => {});
    req.resume();
    req.end();
  });

  try {
    const authority = await done;
    expect(authority).toBeDefined();
    // The :authority on the pushed stream must contain the port the client
    // actually connected to (localhost:PORT). Plain "localhost" means the
    // fix didn't wire up — that's the buggy fallback.
    expect(authority).toMatch(/^localhost:\d+$/);
  } finally {
    cleanup();
  }
});

test("client session.close() completes when server response headers span HEADERS + CONTINUATION", async () => {
  let client: ReturnType<typeof http2.connect> | undefined;
  const { promise: done, resolve, reject } = Promise.withResolvers<{ closed: boolean; status: number | undefined }>();

  const server = http2.createSecureServer({ key: tls.key, cert: tls.cert });

  function cleanup() {
    try {
      client?.close();
    } catch {}
    try {
      server.close();
    } catch {}
  }

  server.on("stream", (stream: any) => {
    stream.on("error", () => {});
    // Respond with a bodyless response whose headers exceed maxFrameSize
    // (~16KB default) so the framing lands as HEADERS(END_STREAM=1,
    // END_HEADERS=0) + CONTINUATION(END_HEADERS=1). Prior to the fix, the
    // client's CONTINUATION path left the stream stuck in HALF_CLOSED_REMOTE
    // and session.close() would hang because #connections never reached 0.
    // Keep the pair count under maxHeaderListPairs (128) and total size
    // under maxHeaderListSize (65535) so only the per-frame limit matters.
    const bigHeaders: any = { [http2.constants.HTTP2_HEADER_STATUS]: 200 };
    const value = Buffer.alloc(200, "x").toString();
    for (let i = 0; i < 100; i++) {
      bigHeaders[`x-custom-header-${i}`] = value;
    }
    stream.respond(bigHeaders, { endStream: true });
  });

  server.on("error", () => {});
  server.listen(0, () => {
    const port = (server.address() as any).port;
    client = http2.connect(`https://localhost:${port}`, { rejectUnauthorized: false });
    client.on("error", (err: Error) => {
      cleanup();
      reject(err);
    });

    let respStatus: number | undefined;
    const req = client.request({ ":path": "/" });
    req.on("response", headers => {
      respStatus = headers[":status"];
    });
    req.on("error", () => {});
    req.on("end", () => {
      // Now try to close the session cleanly. If #connections is stuck
      // at 1 (the stream leak scenario) this never fires.
      client!.close(() => resolve({ closed: true, status: respStatus }));
    });
    req.resume();
    req.end();
  });

  try {
    const result = await done;
    expect(result.closed).toBe(true);
    expect(result.status).toBe(200);
  } finally {
    cleanup();
  }
});

test("pushStream() does not leak http2.sensitiveHeaders symbol as a bogus header", async () => {
  let client: ReturnType<typeof http2.connect> | undefined;
  const { promise: done, resolve, reject } = Promise.withResolvers<string[]>();

  const server = http2.createSecureServer({ key: tls.key, cert: tls.cert });

  function cleanup() {
    try {
      client?.close();
    } catch {}
    try {
      server.close();
    } catch {}
  }

  server.on("stream", (stream: any) => {
    stream.on("error", () => {});
    // Pass a sensitiveHeaders symbol in the push headers; if the symbol leaks
    // through the object spread to native, its description string
    // "nodejs.http2.sensitiveHeaders" would be HPACK-encoded as a real header.
    const pushHeaders: any = {
      ":path": "/a.css",
      authorization: "Bearer topsecret",
      [http2.sensitiveHeaders]: ["authorization"],
    };
    stream.pushStream(pushHeaders, (err: Error | null, pushStream: any) => {
      if (err) {
        cleanup();
        reject(err);
        return;
      }
      pushStream.on("error", () => {});
      pushStream.respond({ [http2.constants.HTTP2_HEADER_STATUS]: 200 });
      pushStream.end("a");
    });
    stream.respond({ [http2.constants.HTTP2_HEADER_STATUS]: 200 });
    stream.end("root");
  });

  server.on("error", () => {});
  server.listen(0, () => {
    const port = (server.address() as any).port;
    client = http2.connect(`https://localhost:${port}`, { rejectUnauthorized: false });
    client.on("error", (err: Error) => {
      cleanup();
      reject(err);
    });
    client.on("stream", (_pushedStream: any, headers: any) => {
      // Emit the received header names for the PUSH_PROMISE request block.
      resolve(Object.keys(headers));
      _pushedStream.on("error", () => {});
      _pushedStream.resume();
    });
    const req = client.request({ ":path": "/" });
    req.on("error", () => {});
    req.resume();
    req.end();
  });

  try {
    const names = await done;
    // No HPACK-encoded header should have a name derived from the symbol.
    for (const n of names) {
      expect(n.toLowerCase()).not.toContain("nodejs.http2.sensitiveheaders");
    }
  } finally {
    cleanup();
  }
});

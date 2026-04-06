import { expect, test } from "bun:test";
import { tls } from "harness";
import http2 from "node:http2";

test("HTTP/2 server push streams work", async () => {
  let client: ReturnType<typeof http2.connect> | undefined;
  let pushErr: Error | null = null;
  const {
    promise: done,
    resolve,
    reject,
  } = Promise.withResolvers<{
    mainBody: string;
    pushPath: string;
    pushData: string;
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
        pushErr = err;
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
    let mainBody: string | null = null;

    function maybeFinish() {
      if (mainBody !== null && pushData !== null && pushPath !== null) {
        resolve({ mainBody, pushPath, pushData });
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
    });
  } finally {
    cleanup();
  }
}, 15_000);

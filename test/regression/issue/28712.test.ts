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
  }>();

  const server = http2.createSecureServer({ key: tls.key, cert: tls.cert });

  function cleanup() {
    client?.close();
    server.close();
  }

  server.on("stream", (stream, _headers) => {
    stream.pushStream({ ":path": "/style.css" }, (err: Error | null, pushStream: any) => {
      if (err) {
        cleanup();
        reject(err);
        return;
      }
      pushStream.respond({
        [http2.constants.HTTP2_HEADER_STATUS]: 200,
        [http2.constants.HTTP2_HEADER_CONTENT_TYPE]: "text/css",
      });
      pushStream.end("body { background: red; }");
    });

    stream.respond({
      [http2.constants.HTTP2_HEADER_STATUS]: 200,
      [http2.constants.HTTP2_HEADER_CONTENT_TYPE]: "text/html",
    });
    stream.end("main response");
  });

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
      const path = headers[":path"];
      if (!path) return; // skip non-push stream events
      pushPath = path as string;
      let data = "";
      pushedStream.on("data", (chunk: Buffer) => (data += chunk));
      pushedStream.on("end", () => {
        pushData = data;
        maybeFinish();
      });
    });

    const req = client.request({ ":path": "/" });
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk));
    req.on("end", () => {
      mainBody = body;
      maybeFinish();
    });
    req.end();
  });

  const result = await done;
  expect(result).toEqual({
    mainBody: "main response",
    pushPath: "/style.css",
    pushData: "body { background: red; }",
  });
});

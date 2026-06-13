import { expect, test } from "bun:test";
import { tempDir } from "harness";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";

// https://github.com/oven-sh/bun/issues/12292
// When a Readable with no backpressure (like the AWS SDK's aws-chunked wrapper)
// is piped to http.ClientRequest, multiple synchronous push() calls can accumulate
// chunks in the internal buffer faster than the async generator body can yield them.
// When end() fires, the generator exits its loop before draining the remaining chunks,
// causing truncated request bodies and SignatureDoesNotMatch errors with S3.
test("#12292 - backpressure-free Readable piped to http.request sends complete body", async () => {
  using dir = tempDir("12292", {});
  const filePath = path.join(String(dir), "testfile.bin");

  // 1 MB deterministic file
  const fileSize = 1024 * 1024;
  const content = Buffer.alloc(fileSize);
  for (let i = 0; i < fileSize; i++) {
    content[i] = i & 0xff;
  }
  fs.writeFileSync(filePath, content);

  const { promise: bodyPromise, resolve: resolveBody } = Promise.withResolvers<Buffer>();

  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = Buffer.from(await req.arrayBuffer());
      resolveBody(body);
      return new Response("OK");
    },
  });

  await new Promise<void>((resolveReq, rejectReq) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: server.port,
        path: "/upload",
        method: "PUT",
      },
      res => {
        res.resume();
        res.on("end", resolveReq);
      },
    );
    req.on("error", rejectReq);

    // Simulate the AWS SDK's aws-chunked encoding wrapper:
    // a Readable with read:()=>{} that pushes data via "data" event
    // listeners on the source, with NO backpressure management.
    // This pattern causes many synchronous push() calls that overwhelm
    // the async generator in ClientRequest.
    const source = fs.createReadStream(filePath);
    const wrapper = new Readable({ read() {} });

    source.on("data", (chunk: Buffer) => {
      // Push framing + data synchronously, just like aws-chunked does
      wrapper.push(chunk.length.toString(16) + "\r\n");
      wrapper.push(chunk);
      wrapper.push("\r\n");
    });
    source.on("end", () => {
      wrapper.push("0\r\n");
      wrapper.push("trailer:value\r\n");
      wrapper.push("\r\n");
      wrapper.push(null);
    });
    source.on("error", err => wrapper.destroy(err));

    wrapper.pipe(req);
  });

  const result = await bodyPromise;

  // The received body must contain ALL the framed data plus the trailer
  const resultStr = result.toString("utf8");
  expect(resultStr).toContain("trailer:value");
  expect(result.length).toBeGreaterThan(fileSize);
});

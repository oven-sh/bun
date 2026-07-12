import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Verifies that S3Client retries back off exponentially instead of re-firing
// immediately. A fake S3 server fails the PUT three times before succeeding
// and we measure wall-clock gaps between the error being written and the
// first byte of the next attempt.

const env = {
  ...bunEnv,
  // The S3 client does not honor NO_PROXY, so an inherited proxy would
  // hijack the request to the stub server.
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
  BUN_S3_RETRY_BASE_DELAY_MS: "100",
};

const multipartFixture = /* js */ `
import * as net from "node:net";

const PART = 5 * 1024 * 1024;
const data = new Uint8Array(PART + 500);
let attempts = 0;
let awaitingFirst = false;
const errSent = [];
const firstByte = [];

const server = net.createServer(sock => {
  let buf = Buffer.alloc(0);
  sock.on("error", () => {});
  sock.on("data", d => {
    if (awaitingFirst) {
      firstByte.push(Date.now());
      awaitingFirst = false;
    }
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const he = buf.indexOf("\\r\\n\\r\\n");
      if (he < 0) return;
      const head = buf.subarray(0, he).toString("latin1");
      const [line, ...hls] = head.split("\\r\\n");
      const [method, target] = line.split(" ");
      const cl = Number((hls.find(l => /^content-length:/i.test(l)) ?? ":0").split(":")[1]);
      if (buf.length < he + 4 + cl) return;
      buf = buf.subarray(he + 4 + cl);
      const send = (st, b) => sock.write(
        "HTTP/1.1 " + st + " X\\r\\n" +
        "ETag: \\"abc\\"\\r\\n" +
        "Content-Length: " + Buffer.byteLength(b) + "\\r\\n" +
        "Connection: keep-alive\\r\\n\\r\\n" + b
      );
      if (method === "POST" && target.includes("uploads")) {
        send(200, "<InitiateMultipartUploadResult><Bucket>b</Bucket><Key>k</Key><UploadId>UP1</UploadId></InitiateMultipartUploadResult>");
      } else if (method === "PUT" && target.includes("partNumber=1")) {
        if (++attempts <= 3) {
          send(503, "<Error><Code>SlowDown</Code><Message>x</Message></Error>");
          errSent.push(Date.now());
          awaitingFirst = true;
        } else {
          send(200, "");
        }
      } else if (method === "PUT") {
        send(200, "");
      } else if (method === "POST" && target.includes("uploadId")) {
        send(200, "<CompleteMultipartUploadResult><Bucket>b</Bucket><Key>k</Key><ETag>\\"e\\"</ETag></CompleteMultipartUploadResult>");
      } else {
        send(204, "");
      }
    }
  });
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const c = new Bun.S3Client({
  endpoint: "http://127.0.0.1:" + port,
  bucket: "b",
  region: "us-east-1",
  accessKeyId: "AK",
  secretAccessKey: "SK",
});

const rs = new ReadableStream({
  start(ctrl) {
    for (let i = 0; i < data.length; i += 65536) ctrl.enqueue(data.subarray(i, i + 65536));
    ctrl.close();
  },
});
await c.write("k-503", new Response(rs), { partSize: PART, retry: 3 });
const gaps = errSent.map((t, i) => firstByte[i] - t);
console.log(JSON.stringify({ attempts, gaps }));
server.close();
process.exit(0);
`;

const singleFileFixture = /* js */ `
import * as net from "node:net";

let attempts = 0;
let awaitingFirst = false;
const errSent = [];
const firstByte = [];

const server = net.createServer(sock => {
  let buf = Buffer.alloc(0);
  sock.on("error", () => {});
  sock.on("data", d => {
    if (awaitingFirst) {
      firstByte.push(Date.now());
      awaitingFirst = false;
    }
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const he = buf.indexOf("\\r\\n\\r\\n");
      if (he < 0) return;
      const head = buf.subarray(0, he).toString("latin1");
      const [line, ...hls] = head.split("\\r\\n");
      const [method] = line.split(" ");
      const cl = Number((hls.find(l => /^content-length:/i.test(l)) ?? ":0").split(":")[1]);
      if (buf.length < he + 4 + cl) return;
      buf = buf.subarray(he + 4 + cl);
      const send = (st, b) => sock.write(
        "HTTP/1.1 " + st + " X\\r\\n" +
        "ETag: \\"abc\\"\\r\\n" +
        "Content-Length: " + Buffer.byteLength(b) + "\\r\\n" +
        "Connection: keep-alive\\r\\n\\r\\n" + b
      );
      if (method === "PUT") {
        if (++attempts <= 3) {
          send(500, "<Error><Code>InternalError</Code><Message>x</Message></Error>");
          errSent.push(Date.now());
          awaitingFirst = true;
        } else {
          send(200, "");
        }
      } else {
        send(204, "");
      }
    }
  });
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const c = new Bun.S3Client({
  endpoint: "http://127.0.0.1:" + port,
  bucket: "b",
  region: "us-east-1",
  accessKeyId: "AK",
  secretAccessKey: "SK",
});

const rs = new ReadableStream({
  start(ctrl) { ctrl.enqueue(new Uint8Array(500)); ctrl.close(); },
});
await c.write("k", new Response(rs), { partSize: 5 * 1024 * 1024, retry: 3 });
const gaps = errSent.map((t, i) => firstByte[i] - t);
console.log(JSON.stringify({ attempts, gaps }));
server.close();
process.exit(0);
`;

async function runFixture(src: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const line = stdout.trim().split("\n").pop() ?? "";
  return { stdout, stderr, exitCode, line };
}

describe("S3Client retry backoff", () => {
  test.concurrent("multipart part retries apply exponential backoff", async () => {
    const { stderr, exitCode, line } = await runFixture(multipartFixture);
    const { attempts, gaps } = JSON.parse(line) as { attempts: number; gaps: number[] };

    expect({ attempts, gapCount: gaps.length, stderr }).toEqual({
      attempts: 4,
      gapCount: 3,
      stderr: expect.any(String),
    });

    // With BUN_S3_RETRY_BASE_DELAY_MS=100 and equal-jitter backoff, the
    // minimum delay for attempt N is base*2^(N-1)/2: 50ms, 100ms, 200ms.
    // Allow slack for wall-clock measurement; the pre-fix behavior is ~0-20ms
    // for every attempt so these bounds cleanly separate.
    expect(gaps[0]).toBeGreaterThanOrEqual(40);
    expect(gaps[1]).toBeGreaterThanOrEqual(80);
    expect(gaps[2]).toBeGreaterThanOrEqual(160);
    expect(gaps[0] + gaps[1] + gaps[2]).toBeGreaterThanOrEqual(300);

    expect(exitCode).toBe(0);
  });

  test.concurrent("single-file upload retries apply exponential backoff", async () => {
    const { stderr, exitCode, line } = await runFixture(singleFileFixture);
    const { attempts, gaps } = JSON.parse(line) as { attempts: number; gaps: number[] };

    expect({ attempts, gapCount: gaps.length, stderr }).toEqual({
      attempts: 4,
      gapCount: 3,
      stderr: expect.any(String),
    });

    expect(gaps[0]).toBeGreaterThanOrEqual(40);
    expect(gaps[1]).toBeGreaterThanOrEqual(80);
    expect(gaps[2]).toBeGreaterThanOrEqual(160);
    expect(gaps[0] + gaps[1] + gaps[2]).toBeGreaterThanOrEqual(300);

    expect(exitCode).toBe(0);
  });
});

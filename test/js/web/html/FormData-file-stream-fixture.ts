// Fixture for the FormData + Bun.file() streaming upload test.
//
// Pre-fix, serialising a FormData whose entry is a file-backed Bun.file()
// read the whole file into memory before sending (peak RSS roughly 2x the
// file size). Post-fix, the file is read in fixed-size chunks, so peak RSS
// stays bounded regardless of the file size.
//
// Client and server share this process; node:http hands the body up chunk
// by chunk without buffering, so server allocations stay bounded and do not
// mask the client's peak.

import { createServer } from "node:http";

const MB = 1024 * 1024;
const path = process.env.FILE_PATH!;
const fileSize = Number(process.env.FILE_SIZE!);

const rss = () => process.memoryUsage().rss;

// node:http so the body is streamed to us chunk by chunk without any large
// server-side buffer that would mask the client's peak.
const server = createServer((req, res) => {
  let n = 0;
  let hash = 0;
  req.on("data", c => {
    n += c.length;
    for (let i = 0; i < c.length; i++) hash = ((hash << 1) | (hash >>> 31)) ^ c[i];
    hash >>>= 0;
  });
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        n,
        hash,
        ct: req.headers["content-type"],
        cl: req.headers["content-length"],
        te: req.headers["transfer-encoding"],
      }),
    );
  });
});
await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
const port = (server.address() as { port: number }).port;

async function upload(label: string, body: () => BodyInit) {
  Bun.gc(true);
  const before = rss();
  let peak = before;
  const iv = setInterval(() => (peak = Math.max(peak, rss())), 10);
  const res = await fetch(`http://127.0.0.1:${port}/`, { method: "POST", body: body() });
  clearInterval(iv);
  const j = (await res.json()) as { n: number; hash: number; ct: string; cl: string; te?: string };
  return { label, peakDeltaMB: Math.round((peak - before) / MB), ...j };
}

// Baseline: a plain ReadableStream body already streams today. The FormData
// path should end up in the same ballpark.
const stream = await upload("stream", () => Bun.file(path).stream());

const form = await upload("formdata", () => {
  const fd = new FormData();
  fd.append("before", "hello");
  fd.append("file", Bun.file(path), "big.bin");
  fd.append("after", "world");
  return fd;
});

server.close();

// Independently rebuild the exact multipart body from the received
// Content-Type boundary so the parent test can verify wire bytes, not just
// byte counts.
const boundaryMatch = /boundary=([^;]+)/.exec(form.ct);
const boundary = boundaryMatch ? boundaryMatch[1] : "";
function hashMultipart(boundary: string) {
  let hash = 0;
  const push = (buf: Uint8Array) => {
    for (let i = 0; i < buf.length; i++) hash = ((hash << 1) | (hash >>> 31)) ^ buf[i];
    hash >>>= 0;
  };
  const T = (s: string) => push(new TextEncoder().encode(s));
  T(`--${boundary}\r\nContent-Disposition: form-data; name="before"\r\n\r\nhello\r\n`);
  T(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.bin"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
  );
  const chunk = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) chunk[i] = i & 0xff;
  for (let i = 0; i < fileSize / 1024; i++) push(chunk);
  T(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="after"\r\n\r\nworld\r\n`);
  T(`--${boundary}--\r\n`);
  return hash;
}
const expectedHash = hashMultipart(boundary);

console.log(JSON.stringify({ stream, form, expectedHash, boundary }));

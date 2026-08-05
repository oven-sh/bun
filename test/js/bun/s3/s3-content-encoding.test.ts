import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// S3 stores Content-Encoding as object metadata and replays it verbatim on GET without
// transfer-encoding the body. The S3 client must hand back the stored bytes exactly,
// never inflate them: a GetObject response is the object, not a transport representation.
//
// Runs in a child process because the S3 client does not honor NO_PROXY, so an inherited
// HTTP_PROXY would hijack the loopback request.
const envWithoutProxy = {
  ...bunEnv,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
};

const ORIGIN = `
import net from "node:net";

export const objects = new Map();
export const acceptEncodingSeen = [];

const server = net.createServer(socket => {
  let buf = Buffer.alloc(0);
  socket.on("error", () => {});
  socket.on("data", chunk => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const headerEnd = buf.indexOf("\\r\\n\\r\\n");
      if (headerEnd < 0) return;
      const head = buf.subarray(0, headerEnd).toString("latin1");
      const [requestLine, ...headerLines] = head.split("\\r\\n");
      const [method, path] = requestLine.split(" ");
      const headers = {};
      for (const line of headerLines) {
        const i = line.indexOf(":");
        if (i > 0) headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
      }
      const contentLength = Number(headers["content-length"] ?? 0);
      if (buf.length < headerEnd + 4 + contentLength) return;
      const body = Buffer.from(buf.subarray(headerEnd + 4, headerEnd + 4 + contentLength));
      buf = buf.subarray(headerEnd + 4 + contentLength);

      if (method === "GET" || method === "HEAD") acceptEncodingSeen.push(headers["accept-encoding"]);

      if (method === "PUT") {
        objects.set(path, { body, encoding: headers["content-encoding"] });
        socket.write('HTTP/1.1 200 OK\\r\\nETag: "etag"\\r\\nContent-Length: 0\\r\\n\\r\\n');
        continue;
      }

      const obj = objects.get(path);
      const enc = obj?.encoding ? "Content-Encoding: " + obj.encoding + "\\r\\n" : "";
      const len = obj ? obj.body.length : 0;
      const responseBody = method === "GET" && obj ? obj.body : Buffer.alloc(0);
      socket.write("HTTP/1.1 200 OK\\r\\nETag: \\"etag\\"\\r\\nAccept-Ranges: bytes\\r\\n" + enc + "Content-Length: " + len + "\\r\\n\\r\\n");
      if (responseBody.length) socket.write(responseBody);
    }
  });
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

export const client = new Bun.S3Client({
  accessKeyId: "test",
  secretAccessKey: "test",
  region: "us-east-1",
  bucket: "bucket",
  endpoint: "http://127.0.0.1:" + server.address().port,
});

export function done() { server.close(); process.exit(0); }
`;

function roundTripFixture(encoding: string, compressExpr: string) {
  return `
${ORIGIN}
const plain = Buffer.alloc(880, "the quick brown fox jumps over the lazy dog ");
const compressed = Buffer.from(${compressExpr}(plain));
await client.write("app.js.gz", compressed, { contentEncoding: ${JSON.stringify(encoding)} });
const back = Buffer.from(await client.file("app.js.gz").bytes());
const stat = await client.file("app.js.gz").stat();
console.log(JSON.stringify({
  wrote: compressed.length,
  readBack: back.length,
  byteIdentical: Buffer.compare(back, compressed) === 0,
  statSize: stat.size,
  statMatchesWrote: stat.size === compressed.length,
  acceptEncoding: acceptEncodingSeen,
}));
done();
`;
}

const MISLABELLED_FIXTURE = `
${ORIGIN}
const plain = Buffer.alloc(880, "the quick brown fox jumps over the lazy dog ");
objects.set("/bucket/mislabelled", { body: plain, encoding: "gzip" });
objects.set("/bucket/custom", { body: plain, encoding: "aes256" });
const mislabelled = Buffer.from(await client.file("mislabelled").bytes());
const custom = Buffer.from(await client.file("custom").bytes());
console.log(JSON.stringify({
  mislabelled: { length: mislabelled.length, byteIdentical: Buffer.compare(mislabelled, plain) === 0 },
  custom: { length: custom.length, byteIdentical: Buffer.compare(custom, plain) === 0 },
}));
done();
`;

const STREAM_FIXTURE = `
${ORIGIN}
const plain = Buffer.alloc(880, "the quick brown fox jumps over the lazy dog ");
const compressed = Buffer.from(Bun.gzipSync(plain));
objects.set("/bucket/stream.gz", { body: compressed, encoding: "gzip" });
const chunks = [];
for await (const chunk of client.file("stream.gz").stream()) chunks.push(chunk);
const back = Buffer.concat(chunks);
console.log(JSON.stringify({
  wrote: compressed.length,
  readBack: back.length,
  byteIdentical: Buffer.compare(back, compressed) === 0,
}));
done();
`;

async function run(fixture: string) {
  using dir = tempDir("s3-content-encoding", { "fixture.ts": fixture });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    env: envWithoutProxy,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

describe("S3Client does not decode Content-Encoding metadata", () => {
  test.concurrent.each([
    ["gzip", "Bun.gzipSync"],
    ["br", '(await import("node:zlib")).brotliCompressSync'],
    ["deflate", "Bun.deflateSync"],
    ["zstd", "Bun.zstdCompressSync"],
  ] as const)("returns the stored %s bytes unchanged", async (encoding, compressExpr) => {
    const { stdout, stderr, exitCode } = await run(roundTripFixture(encoding, compressExpr));
    expect(stderr).toBe("");
    const result = JSON.parse(stdout);
    expect({
      readBack: result.readBack,
      byteIdentical: result.byteIdentical,
      statMatchesWrote: result.statMatchesWrote,
      acceptEncoding: result.acceptEncoding,
    }).toEqual({
      readBack: result.wrote,
      byteIdentical: true,
      statMatchesWrote: true,
      acceptEncoding: [null, null],
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("returns mislabelled and unknown-encoding bytes as-is", async () => {
    const { stdout, stderr, exitCode } = await run(MISLABELLED_FIXTURE);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      mislabelled: { length: 880, byteIdentical: true },
      custom: { length: 880, byteIdentical: true },
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("returns stored bytes unchanged via the streaming reader", async () => {
    const { stdout, stderr, exitCode } = await run(STREAM_FIXTURE);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout);
    expect({ readBack: result.readBack, byteIdentical: result.byteIdentical }).toEqual({
      readBack: result.wrote,
      byteIdentical: true,
    });
    expect(exitCode).toBe(0);
  });
});

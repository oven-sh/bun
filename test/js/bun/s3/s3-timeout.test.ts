import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The S3 client had no per-request way to bound a call against an unresponsive
// endpoint. These tests spawn a server that accepts the connection, consumes the
// request and never responds, and verify `{ timeout: N }` rejects instead of hanging.

type Op =
  | "text"
  | "slice"
  | "bytes"
  | "exists"
  | "stat"
  | "size"
  | "delete"
  | "write"
  | "list"
  | "stream"
  | "client-text"
  | "override-text"
  | "writer"
  | "writer-multipart"
  | "type-error";

function fixture(op: Op) {
  return `
import net from "node:net";

let connections = 0;
// Accept the connection and swallow the request without ever responding.
const server = net.createServer(socket => {
  connections++;
  socket.on("error", () => {});
  socket.on("data", () => {});
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const base = {
  accessKeyId: "key",
  secretAccessKey: "secret",
  bucket: "bucket",
  endpoint: "http://127.0.0.1:" + port,
};
const s3 = new Bun.S3Client(base);
const s3short = new Bun.S3Client({ ...base, timeout: 500 });
// client-level timeout disabled; per-call override should still apply.
const s3off = new Bun.S3Client({ ...base, timeout: false });

const calls = {
  text: () => s3.file("k", { timeout: 500 }).text(),
  slice: () => s3.file("k", { timeout: 500 }).slice(1, 4).text(),
  bytes: () => s3.file("k", { timeout: 500 }).bytes(),
  exists: () => s3.exists("k", { timeout: 500 }),
  stat: () => s3.stat("k", { timeout: 500 }),
  size: () => s3.size("k", { timeout: 500 }),
  delete: () => s3.delete("k", { timeout: 500 }),
  write: () => s3.write("k", "hello", { timeout: 500, retry: 0 }),
  list: () => s3.list({}, { timeout: 500 }),
  stream: async () => {
    const reader = s3.file("k", { timeout: 500 }).stream().getReader();
    try { while (!(await reader.read()).done) {} }
    finally { reader.releaseLock(); }
  },
  "client-text": () => s3short.file("k").text(),
  "override-text": () => s3off.file("k", { timeout: 500 }).text(),
  // writer() under partSize: single-file PUT path inside MultiPartUpload
  writer: async () => {
    const w = s3.file("k", { timeout: 500, retry: 0 }).writer();
    w.write("hello");
    await w.end();
  },
  // writer() at partSize: CreateMultipartUpload (?uploads=) request path
  "writer-multipart": async () => {
    const w = s3.file("k", { timeout: 500, retry: 0 }).writer({ partSize: 5 * 1024 * 1024 });
    w.write(Buffer.alloc(5 * 1024 * 1024, "x"));
    await w.end();
  },
  "type-error": () => s3.file("k", { timeout: "soon" }).text(),
};

const start = Date.now();
try {
  const value = await calls[${JSON.stringify(op)}]();
  console.log(JSON.stringify({ ok: true, value: String(value), connections }));
} catch (e) {
  console.log(JSON.stringify({
    ok: false,
    code: e?.code,
    name: e?.name,
    message: String(e?.message ?? e),
    elapsed: Date.now() - start,
    connections,
  }));
}
process.exit(0);
`;
}

async function run(op: Op) {
  const env = { ...bunEnv } as Record<string, string>;
  // S3 currently reads HTTP_PROXY unconditionally; keep the request local.
  delete env.HTTP_PROXY;
  delete env.HTTPS_PROXY;
  delete env.http_proxy;
  delete env.https_proxy;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture(op)],
    env,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const result = JSON.parse(stdout.trim());
  expect(exitCode).toBe(0);
  return result;
}

// uSockets sweeps short socket timeouts on a ~4s tick, so a 1s idle timeout
// fires anywhere up to ~4s after the last byte. Add subprocess startup under
// a debug + ASAN build and a single case sits around 5-6s; this is the rare
// outlier where the default 5s budget is too tight.
const perTestTimeoutMs = 15_000;

describe("S3Options.timeout", () => {
  test.concurrent.each([
    "text",
    "slice",
    "bytes",
    "exists",
    "stat",
    "size",
    "delete",
    "write",
    "list",
    "stream",
    "client-text",
    "override-text",
    "writer",
    "writer-multipart",
  ] as const)(
    "%s rejects with Timeout against a stalled endpoint",
    async op => {
      const result = await run(op);
      expect(result.ok).toBe(false);
      expect(result.code).toBe("Timeout");
      expect(result.connections).toBeGreaterThanOrEqual(1);
    },
    perTestTimeoutMs,
  );

  test.concurrent("non-numeric timeout throws ERR_INVALID_ARG_TYPE", async () => {
    const result = await run("type-error");
    expect(result.ok).toBe(false);
    expect(result.code).toBe("ERR_INVALID_ARG_TYPE");
  });
});

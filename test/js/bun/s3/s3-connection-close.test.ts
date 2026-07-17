import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Every S3 PUT/DELETE answers with a zero-length body, and any endpoint behind
// a load balancer may reply with `Connection: close`. The client must treat
// `Content-Length: 0` as complete rather than reading to EOF, FIN or not.
function fixture(op: "write" | "delete", sendFin: boolean) {
  return `
import net from "node:net";

const server = net.createServer(socket => {
  let buffer = Buffer.alloc(0);
  socket.on("error", () => {});
  socket.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
    if (headerEnd === -1) return;
    const match = /content-length: *(\\d+)/i.exec(buffer.subarray(0, headerEnd).toString());
    if (buffer.length - headerEnd - 4 < (match ? Number(match[1]) : 0)) return;
    socket.write("HTTP/1.1 200 OK\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n");
    ${sendFin ? "socket.end();" : "// the peer keeps the socket open"}
  });
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

const s3 = new Bun.S3Client({
  accessKeyId: "key",
  secretAccessKey: "secret",
  bucket: "bucket",
  endpoint: "http://127.0.0.1:" + server.address().port,
});

${op === "write" ? 'await s3.write("object.txt", "hello");' : 'await s3.delete("object.txt");'}
console.log("completed");
process.exit(0);
`;
}

// A success response carrying a body but neither Content-Length nor Transfer-Encoding
// is delimited by the connection close (RFC 9112 section 6.3, rule 8) — what HTTP/1.0
// upstreams and framing-stripping reverse proxies in front of S3 produce. Its headers
// arrive on one progress update and the completion on a later one carrying no metadata.
const SMALL_BODY = "hello-close-delimited";
// Several times one TCP segment, so the body spans several progress updates and the
// headers end up many callbacks behind the completion.
const LARGE_BODY_BYTES = 256 * 1024;

// Distinct first and last bytes so a body truncated, duplicated, or reassembled out of
// order across progress updates fails the assertion. Mirrored by `MAKE_LARGE_BODY` in
// the fixture; the head/tail/length assertion catches any drift between the two.
function largeBody() {
  const body = Buffer.alloc(LARGE_BODY_BYTES, "x");
  body.write("START");
  body.write("END", LARGE_BODY_BYTES - 3);
  return body.toString();
}

const MAKE_LARGE_BODY = `(() => {
  const b = Buffer.alloc(${LARGE_BODY_BYTES}, "x");
  b.write("START");
  b.write("END", ${LARGE_BODY_BYTES - 3});
  return b.toString();
})()`;

const CLOSE_DELIMITED_READ = {
  text: 'await s3.file("object.txt").text()',
  bytes: 'new TextDecoder().decode(await s3.file("object.txt").bytes())',
  "large text": 'await s3.file("object.txt").text()',
} as const;

function closeDelimitedFixture(op: keyof typeof CLOSE_DELIMITED_READ) {
  return `
import net from "node:net";

const body = ${op === "large text" ? MAKE_LARGE_BODY : JSON.stringify(SMALL_BODY)};
const server = net.createServer(socket => {
  let buffer = Buffer.alloc(0);
  socket.on("error", () => {});
  socket.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.indexOf("\\r\\n\\r\\n") === -1) return;
    buffer = Buffer.alloc(0);
    socket.write('HTTP/1.1 200 OK\\r\\nContent-Type: application/octet-stream\\r\\nETag: "etag"\\r\\nConnection: close\\r\\n\\r\\n');
    socket.write(body);
    socket.end();
  });
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

const s3 = new Bun.S3Client({
  accessKeyId: "key",
  secretAccessKey: "secret",
  bucket: "bucket",
  endpoint: "http://127.0.0.1:" + server.address().port,
});

// Summarised rather than echoed: the large body would outrun the stdout pipe.
const received = ${CLOSE_DELIMITED_READ[op]};
console.log(JSON.stringify({ length: received.length, head: received.slice(0, 5), tail: received.slice(-3) }));
server.close();
`;
}

function closeDelimitedExpectation(op: keyof typeof CLOSE_DELIMITED_READ) {
  const body = op === "large text" ? largeBody() : SMALL_BODY;
  return JSON.stringify({ length: body.length, head: body.slice(0, 5), tail: body.slice(-3) });
}

// The S3 client does not honor NO_PROXY, so an inherited proxy would hijack the
// request to the stub server.
const envWithoutProxy = {
  ...bunEnv,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
};

describe.each([true, false])("peer sends FIN: %p", sendFin => {
  test.concurrent.each(["write", "delete"] as const)(
    "S3Client.%s() resolves on a Content-Length: 0 + Connection: close response",
    async op => {
      using dir = tempDir("s3-connection-close", { "fixture.ts": fixture(op, sendFin) });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "fixture.ts"],
        env: envWithoutProxy,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "completed", exitCode: 0 });
      expect(stderr).not.toContain("S3Error");
      expect(proc.signalCode).toBeNull();
    },
  );
});

describe("close-delimited response body", () => {
  test.concurrent.each(["text", "bytes", "large text"] as const)(
    "S3Client %s reads a 200 with no Content-Length and no Transfer-Encoding",
    async op => {
      using dir = tempDir("s3-close-delimited", { "fixture.ts": closeDelimitedFixture(op) });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "fixture.ts"],
        env: envWithoutProxy,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: closeDelimitedExpectation(op), exitCode: 0 });
      expect(stderr).not.toContain("S3Error");
      // Before the fix the completion callback carried no response metadata, so
      // the task aborted the whole process and JS never saw an error at all.
      expect(proc.signalCode).toBeNull();
    },
  );
});

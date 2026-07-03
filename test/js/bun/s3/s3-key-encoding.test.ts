import { S3Client } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// S3 object keys are raw byte strings: `\` is a legal character and names a
// different object than `/` does. Both must survive into the signed request.
const fixture = `
import net from "node:net";

const requestLines = [];
const server = net.createServer(socket => {
  let buffer = Buffer.alloc(0);
  socket.on("error", () => {});
  socket.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
    if (headerEnd === -1) return;
    const head = buffer.subarray(0, headerEnd).toString();
    const match = /content-length: *(\\d+)/i.exec(head);
    if (buffer.length - headerEnd - 4 < (match ? Number(match[1]) : 0)) return;
    requestLines.push(head.split("\\r\\n")[0]);
    socket.write("HTTP/1.1 200 OK\\r\\nContent-Length: 0\\r\\n\\r\\n");
    buffer = Buffer.alloc(0);
  });
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

const s3 = new Bun.S3Client({
  accessKeyId: "key",
  secretAccessKey: "secret",
  bucket: "bucket",
  endpoint: "http://127.0.0.1:" + server.address().port,
});

for (const key of ["a\\\\b", "a/b", Buffer.alloc(500, " ").toString()]) {
  await s3.write(key, "hello");
}
await s3.delete("a\\\\b");

console.log(JSON.stringify(requestLines));
process.exit(0);
`;

test("a backslash in an object key reaches the wire as %5C, not /", async () => {
  using dir = tempDir("s3-key-encoding", { "fixture.ts": fixture });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    // The S3 client does not honor NO_PROXY, so an inherited proxy would
    // hijack the request to the stub server.
    env: { ...bunEnv, HTTP_PROXY: undefined, HTTPS_PROXY: undefined, http_proxy: undefined, https_proxy: undefined },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim().slice(0, 120), exitCode }).toMatchObject({ exitCode: 0 });
  expect(stderr).not.toContain("S3Error");

  expect(JSON.parse(stdout)).toEqual([
    "PUT /bucket/a%5Cb HTTP/1.1",
    "PUT /bucket/a/b HTTP/1.1",
    // A 1024-byte key can percent-encode to 3072 bytes; the signer must not
    // reject it for overflowing its own buffer.
    `PUT /bucket/${"%20".repeat(500)} HTTP/1.1`,
    "DELETE /bucket/a%5Cb HTTP/1.1",
  ]);
});

test("presign distinguishes a backslash from a slash", () => {
  const s3 = new S3Client({
    accessKeyId: "key",
    secretAccessKey: "secret",
    bucket: "bucket",
    endpoint: "http://s3.example.com",
  });

  expect(s3.presign("a\\b").split("?")[0]).toBe("http://s3.example.com/bucket/a%5Cb");
  expect(s3.presign("a/b").split("?")[0]).toBe("http://s3.example.com/bucket/a/b");
});

test.each(["evil.example.com/other", "evil.example.com\\other"])(
  "a virtual-hosted bucket name containing a path separator (%j) is rejected",
  bucket => {
    const s3 = new S3Client({
      accessKeyId: "key",
      secretAccessKey: "secret",
      bucket,
      region: "us-east-1",
      virtualHostedStyle: true,
    });

    expect(() => s3.presign("object.txt")).toThrow(expect.objectContaining({ code: "ERR_S3_INVALID_ENDPOINT" }));
  },
);

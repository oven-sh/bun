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

describe.each([true, false])("peer sends FIN: %p", sendFin => {
  test.each(["write", "delete"] as const)(
    "S3Client.%s() resolves on a Content-Length: 0 + Connection: close response",
    async op => {
      using dir = tempDir("s3-connection-close", { "fixture.ts": fixture(op, sendFin) });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "fixture.ts"],
        // The S3 client does not honor NO_PROXY, so an inherited proxy would
        // hijack the request to the stub server.
        env: {
          ...bunEnv,
          HTTP_PROXY: undefined,
          HTTPS_PROXY: undefined,
          http_proxy: undefined,
          https_proxy: undefined,
        },
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

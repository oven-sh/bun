import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A local S3 stub that records every request line. `failMode` controls which
// stage of the multipart lifecycle permanently errors so we can observe
// whether Bun sends AbortMultipartUpload (DELETE ?uploadId) afterward.
function fixture(failMode: "commit" | "part") {
  return String.raw`
import * as net from "node:net";

const requests: string[] = [];
let aborts = 0;
const xml = (s: string) => '<?xml version="1.0" encoding="UTF-8"?>\n' + s;

const server = net.createServer(socket => {
  let buf = Buffer.alloc(0);
  socket.on("error", () => {});
  socket.on("data", chunk => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const head = buf.toString("latin1", 0, headerEnd);
      const contentLength = Number(/^content-length: *(\d+)/im.exec(head)?.[1] ?? 0);
      if (buf.length < headerEnd + 4 + contentLength) return;
      buf = buf.subarray(headerEnd + 4 + contentLength);

      const [method, target] = head.split("\r\n")[0].split(" ");
      const qs = target.includes("?") ? new URLSearchParams(target.split("?")[1]) : new URLSearchParams();
      let tag = "";
      if (qs.has("uploads")) tag = "?uploads";
      else if (qs.has("partNumber")) tag = "?partNumber=" + qs.get("partNumber");
      else if (qs.has("uploadId")) tag = "?uploadId";

      let status = 200, body = "", extraHeader = "";
      if (method === "POST" && qs.has("uploads")) {
        body = xml("<InitiateMultipartUploadResult><Bucket>b</Bucket><Key>k</Key><UploadId>up-1</UploadId></InitiateMultipartUploadResult>");
      } else if (method === "PUT" && qs.has("partNumber")) {
        if (${JSON.stringify(failMode)} === "part") {
          status = 500;
          body = xml("<Error><Code>InternalError</Code><Message>part fail</Message></Error>");
        } else {
          extraHeader = 'ETag: "etag-' + qs.get("partNumber") + '"\r\n';
        }
      } else if (method === "POST" && qs.has("uploadId")) {
        status = 500;
        body = xml("<Error><Code>InternalError</Code><Message>commit fail</Message></Error>");
      } else if (method === "DELETE" && qs.has("uploadId")) {
        status = 204;
        aborts++;
      }
      requests.push(method + " " + tag + " -> " + status);
      const bodyBuf = Buffer.from(body);
      socket.write(
        "HTTP/1.1 " + status + " X\r\n" +
        extraHeader +
        "Connection: keep-alive\r\n" +
        "Content-Length: " + (status === 204 ? 0 : bodyBuf.length) + "\r\n\r\n",
      );
      if (status !== 204 && bodyBuf.length) socket.write(bodyBuf);
    }
  });
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
const port = (server.address() as net.AddressInfo).port;

const client = new Bun.S3Client({
  endpoint: "http://127.0.0.1:" + port,
  bucket: "b",
  accessKeyId: "AK",
  secretAccessKey: "SK",
  region: "us-east-1",
});
const writer = client.file("obj.bin").writer({ partSize: 5 * 1024 * 1024, queueSize: 1, retry: 1 });
writer.write(new Uint8Array(5 * 1024 * 1024));
writer.write(new Uint8Array(64));

let outcome: string;
try {
  await writer.end();
  outcome = "resolved";
} catch (e: any) {
  outcome = "rejected:" + (e?.code ?? e?.name ?? String(e));
}

// Allow the best-effort AbortMultipartUpload to be issued and observed.
const deadline = Date.now() + 2000;
while (aborts === 0 && Date.now() < deadline) {
  await Bun.sleep(25);
}

console.log(JSON.stringify({ outcome, aborts, requests }));
process.exit(0);
`;
}

const env = {
  ...bunEnv,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
  // The S3 writer's NetworkSink is owned by the JS wrapper and is only freed
  // on GC; process.exit() skips that, which LSan reports. That leak exists on
  // main for the success path too and is not what this test observes.
  ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
};

async function run(failMode: "commit" | "part") {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture(failMode)],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) expect({ stdout, stderr, exitCode }).toEqual({ stdout, stderr: "", exitCode: 0 });
  return JSON.parse(stdout.trim()) as { outcome: string; aborts: number; requests: string[] };
}

describe("S3 multipart upload aborts the server-side upload on failure", () => {
  test.concurrent("UploadPart failure triggers AbortMultipartUpload", async () => {
    const result = await run("part");
    expect(result.outcome).toBe("rejected:InternalError");
    expect(result.requests).toContain("DELETE ?uploadId -> 204");
    expect(result.aborts).toBeGreaterThanOrEqual(1);
  });

  test.concurrent("CompleteMultipartUpload failure triggers AbortMultipartUpload", async () => {
    const result = await run("commit");
    // The writer should reject, parts should have succeeded, commit retried,
    // and then an AbortMultipartUpload must be issued so the server-side
    // upload (and its parts) are not left orphaned.
    expect(result.outcome).toBe("rejected:InternalError");
    expect(result.requests.filter(r => r.startsWith("PUT ?partNumber"))).toEqual([
      "PUT ?partNumber=1 -> 200",
      "PUT ?partNumber=2 -> 200",
    ]);
    expect(result.requests).toContain("DELETE ?uploadId -> 204");
    expect(result.aborts).toBeGreaterThanOrEqual(1);
  });
});

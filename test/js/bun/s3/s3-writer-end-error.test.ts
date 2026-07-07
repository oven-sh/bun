import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// S3File.writer().end(new Error(...)) must abort the multipart upload and
// reject. Previously the error argument was ignored: the buffered tail was
// uploaded, CompleteMultipartUpload was sent, and the promise resolved,
// silently publishing a truncated object.

const fixture = `
import * as net from "node:net";

const reqs: string[] = [];
const committed = new Set<string>();
let nextId = 0;

const server = net.createServer(sock => {
  let buf = Buffer.alloc(0);
  sock.on("error", () => {});
  sock.on("data", chunk => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const headerEnd = buf.indexOf("\\r\\n\\r\\n");
      if (headerEnd < 0) return;
      const head = buf.toString("latin1", 0, headerEnd);
      const len = Number(/^content-length: *(\\d+)/im.exec(head)?.[1] ?? 0);
      if (buf.length < headerEnd + 4 + len) return;
      const body = Buffer.from(buf.subarray(headerEnd + 4, headerEnd + 4 + len));
      buf = buf.subarray(headerEnd + 4 + len);
      const [method, target] = head.split("\\r\\n")[0].split(" ");
      const key = decodeURIComponent(target.split("?")[0]).replace(/^\\/bucket\\//, "");
      const q = new URLSearchParams(target.split("?")[1] ?? "");
      let status = 200, out = "", extra = "";
      if (method === "POST" && q.has("uploads")) {
        const id = "up" + ++nextId;
        reqs.push("INIT " + key);
        out = '<?xml version="1.0"?><InitiateMultipartUploadResult><Bucket>bucket</Bucket><Key>k</Key><UploadId>' + id + '</UploadId></InitiateMultipartUploadResult>';
      } else if (method === "PUT" && q.has("partNumber")) {
        reqs.push("PART " + key + " " + q.get("partNumber") + " " + body.length);
        extra = 'ETag: "p' + q.get("partNumber") + '"\\r\\n';
      } else if (method === "POST" && q.has("uploadId")) {
        reqs.push("COMMIT " + key);
        committed.add(key);
        out = '<?xml version="1.0"?><CompleteMultipartUploadResult><Key>k</Key><ETag>"e"</ETag></CompleteMultipartUploadResult>';
      } else if (method === "DELETE" && q.has("uploadId")) {
        reqs.push("ABORT " + key);
        status = 204;
      } else if (method === "PUT") {
        reqs.push("PUT " + key + " " + body.length);
        committed.add(key);
      }
      const b = Buffer.from(out);
      sock.write("HTTP/1.1 " + status + " X\\r\\n" + extra + "Connection: keep-alive\\r\\nContent-Length: " + (status === 204 ? 0 : b.length) + "\\r\\n\\r\\n");
      if (status !== 204 && b.length) sock.write(b);
    }
  });
});
await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
const port = (server.address() as net.AddressInfo).port;

const s3 = new Bun.S3Client({
  endpoint: "http://127.0.0.1:" + port,
  bucket: "bucket",
  accessKeyId: "AK",
  secretAccessKey: "SK",
  region: "us-east-1",
});
const PART = 5 * 1024 * 1024;

async function settle(p: Promise<unknown>) {
  try {
    await p;
    return "resolved";
  } catch (e: any) {
    return "rejected:" + e.message;
  }
}

function summary(key: string) {
  return {
    committed: committed.has(key),
    commits: reqs.filter(r => r.startsWith("COMMIT ")).length,
    puts: reqs.filter(r => r.startsWith("PUT ")).length,
    aborts: reqs.filter(r => r.startsWith("ABORT ")).length,
    inits: reqs.filter(r => r.startsWith("INIT ")).length,
  };
}

async function waitFor(predicate: () => boolean, limit = 500) {
  for (let i = 0; i < limit && !predicate(); i++) await Bun.sleep(10);
}

const results: Record<string, unknown> = {};

{
  // Multipart already initiated and a part uploaded; then the source fails.
  reqs.length = 0;
  const w = s3.file("multi.bin").writer({ partSize: PART, queueSize: 1, retry: 0 });
  w.write(new Uint8Array(PART));
  await w.flush();
  w.write(new Uint8Array(100));
  const outcome = await settle(w.end(new Error("source failed mid-stream")));
  await waitFor(() => reqs.some(r => r.startsWith("ABORT ") || r.startsWith("COMMIT ")));
  results.multipart = { outcome, ...summary("multi.bin") };
}

{
  // end(error) in the same JS turn as the write that triggered the init
  // request; the UploadId arrives after fail() and must still be rolled back.
  reqs.length = 0;
  const w = s3.file("race.bin").writer({ partSize: PART, queueSize: 1, retry: 0 });
  w.write(new Uint8Array(PART));
  w.write(new Uint8Array(100));
  const outcome = await settle(w.end(new Error("source failed mid-stream")));
  await waitFor(() => reqs.some(r => r.startsWith("ABORT ") || r.startsWith("COMMIT ")));
  results.race = { outcome, ...summary("race.bin") };
}

{
  // DOMException (the default AbortSignal.reason type) must abort like any Error.
  reqs.length = 0;
  const w = s3.file("domex.bin").writer({ partSize: PART, queueSize: 1, retry: 0 });
  w.write(new Uint8Array(PART));
  await w.flush();
  w.write(new Uint8Array(100));
  const ac = new AbortController();
  ac.abort(new DOMException("source failed mid-stream", "AbortError"));
  const outcome = await settle(w.end(ac.signal.reason));
  await waitFor(() => reqs.some(r => r.startsWith("ABORT ") || r.startsWith("COMMIT ")));
  results.domex = { outcome, ...summary("domex.bin") };
}

{
  // Buffered data below partSize; multipart never started.
  reqs.length = 0;
  const w = s3.file("single.bin").writer({ partSize: PART, queueSize: 1, retry: 0 });
  w.write(new Uint8Array(100));
  const outcome = await settle(w.end(new Error("source failed mid-stream")));
  // A buggy build uploads the buffered bytes as a single-file PUT and only
  // then settles, so reqs already reflects it here. Give any late request a
  // bounded window to appear; the fixed build leaves reqs empty.
  await waitFor(() => reqs.length > 0, 50);
  results.single = { outcome, ...summary("single.bin") };
}

{
  // Control: end() with no error still commits.
  reqs.length = 0;
  const w = s3.file("ok.bin").writer({ partSize: PART, queueSize: 1, retry: 0 });
  w.write(new Uint8Array(PART));
  w.write(new Uint8Array(100));
  const outcome = await settle(w.end());
  await waitFor(() => reqs.some(r => r.startsWith("COMMIT ")));
  results.ok = { outcome, ...summary("ok.bin") };
}

{
  // Control: a non-Error argument (e.g. an options bag) is not treated as an
  // abort request and the upload commits.
  reqs.length = 0;
  const w = s3.file("opts.bin").writer({ partSize: PART, queueSize: 1, retry: 0 });
  w.write(new Uint8Array(PART));
  w.write(new Uint8Array(100));
  const outcome = await settle((w.end as any)({ signal: new AbortController().signal }));
  await waitFor(() => reqs.some(r => r.startsWith("COMMIT ") || r.startsWith("ABORT ")));
  results.opts = { outcome, ...summary("opts.bin") };
}

console.log(JSON.stringify(results));
server.close();
process.exit(0);
`;

test("S3File.writer().end(error) aborts the upload and rejects", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: {
      ...bunEnv,
      HTTP_PROXY: undefined,
      HTTPS_PROXY: undefined,
      http_proxy: undefined,
      https_proxy: undefined,
      // LSan flags pre-existing transpiler/sourcemap leaks from the -e fixture
      // itself; unrelated to S3, so don't let it abort the child.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "symbolize=0", "detect_leaks=0"].filter(Boolean).join(":"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  let result;
  try {
    result = JSON.parse(stdout.trim());
  } catch {
    throw new Error(`fixture did not emit JSON\nstdout: ${stdout}\nstderr: ${stderr}`);
  }

  // After a part has been uploaded, end(error) must reject with the caller's
  // error, send AbortMultipartUpload, and never send CompleteMultipartUpload.
  expect(result.multipart).toEqual({
    outcome: "rejected:source failed mid-stream",
    committed: false,
    commits: 0,
    puts: 0,
    aborts: 1,
    inits: 1,
  });

  // end(error) in the same turn as the write that dispatched the init request
  // must still roll back the UploadId once it arrives.
  expect(result.race).toEqual({
    outcome: "rejected:source failed mid-stream",
    committed: false,
    commits: 0,
    puts: 0,
    aborts: 1,
    inits: 1,
  });

  // DOMException (AbortSignal.reason) must abort like any Error.
  expect(result.domex).toEqual({
    outcome: "rejected:source failed mid-stream",
    committed: false,
    commits: 0,
    puts: 0,
    aborts: 1,
    inits: 1,
  });

  // Before anything is sent, end(error) must reject without uploading the
  // buffered bytes as a single-file PUT.
  expect(result.single).toEqual({
    outcome: "rejected:source failed mid-stream",
    committed: false,
    commits: 0,
    puts: 0,
    aborts: 0,
    inits: 0,
  });

  // end() with no error still commits normally.
  expect(result.ok).toEqual({
    outcome: "resolved",
    committed: true,
    commits: 1,
    puts: 0,
    aborts: 0,
    inits: 1,
  });

  // end() with a non-Error argument commits normally.
  expect(result.opts).toEqual({
    outcome: "resolved",
    committed: true,
    commits: 1,
    puts: 0,
    aborts: 0,
    inits: 1,
  });

  expect(exitCode).toBe(0);
});

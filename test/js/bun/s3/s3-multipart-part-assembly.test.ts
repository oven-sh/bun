import { S3Client } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
import { join } from "path";

// The S3 client resolves HTTP_PROXY/HTTPS_PROXY without consulting NO_PROXY
// (get_http_proxy is called with no hostname, matching the Zig original), so
// in environments with a mandatory egress proxy these local-endpoint requests
// get routed to the proxy and fail with "egress denied ... host not on
// allowlist". Skip the network-touching tests there; they run in CI, which
// sets no proxy. The teardown tests below never reach the network and run
// everywhere.
const mandatoryProxy = !!(
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  process.env.HTTPS_PROXY ||
  process.env.https_proxy
);

// Streamed multipart uploads: part assembly against a local fake S3 endpoint
// (the s3-insecure.test.ts pattern), plus teardown of writers whose upload
// never completes.
describe("S3 multipart part assembly", () => {
  function makeServer() {
    const uploads = new Map<string, Map<number, Buffer>>();
    const singlePuts: Buffer[] = [];
    let counter = 0;
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const q = new URL(req.url).searchParams;
        if (req.method === "POST" && q.has("uploads")) {
          const id = `up-${++counter}`;
          uploads.set(id, new Map());
          return new Response(
            `<?xml version="1.0"?><InitiateMultipartUploadResult><Bucket>b</Bucket><Key>k</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`,
            { headers: { "Content-Type": "application/xml" } },
          );
        }
        if (req.method === "PUT" && q.has("partNumber")) {
          uploads.get(q.get("uploadId")!)!.set(Number(q.get("partNumber")), Buffer.from(await req.arrayBuffer()));
          return new Response(null, { headers: { ETag: `"etag-${q.get("partNumber")}"` } });
        }
        if (req.method === "POST" && q.has("uploadId")) {
          return new Response(
            `<?xml version="1.0"?><CompleteMultipartUploadResult><ETag>"done"</ETag></CompleteMultipartUploadResult>`,
            { headers: { "Content-Type": "application/xml" } },
          );
        }
        if (req.method === "PUT") {
          singlePuts.push(Buffer.from(await req.arrayBuffer()));
          return new Response(null, { headers: { ETag: '"single"' } });
        }
        return new Response(null, { status: 400 });
      },
    });
    const s3 = new S3Client({
      endpoint: server.url.origin,
      bucket: "b",
      accessKeyId: "k",
      secretAccessKey: "s",
      region: "us-east-1",
    });
    return { server, s3, uploads, singlePuts };
  }

  function patterned(total: number) {
    const buf = Buffer.alloc(total);
    for (let i = 0; i < total; i++) buf[i] = (i * 13) & 0xff;
    return buf;
  }

  it.skipIf(mandatoryProxy)("splits a streamed upload into full-sized parts that reassemble exactly", async () => {
    const { server, s3, uploads } = makeServer();
    using _s = server;
    const total = Math.floor(12.5 * 1024 * 1024);
    const data = patterned(total);

    const writer = s3.file("multi.bin").writer();
    // odd-sized writes that straddle part boundaries
    const sizes = [1, 4093, 65537, 1024 * 1024 + 7, 3 * 1024 * 1024, 333];
    let offset = 0;
    let i = 0;
    while (offset < total) {
      const n = Math.min(sizes[i++ % sizes.length], total - offset);
      writer.write(data.subarray(offset, offset + n));
      offset += n;
      if (i % 3 === 0) await writer.flush();
    }
    await writer.end();

    const parts = [...uploads.values()].at(-1)!;
    const numbers = [...parts.keys()].sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3]);
    expect(numbers.slice(0, -1).map(n => parts.get(n)!.length)).toEqual([5 * 1024 * 1024, 5 * 1024 * 1024]);
    expect(Buffer.compare(Buffer.concat(numbers.map(n => parts.get(n)!)), data)).toBe(0);
  });

  it.skipIf(mandatoryProxy)("routes sub-part-size uploads through a single PUT", async () => {
    const { server, s3, singlePuts } = makeServer();
    using _s = server;
    const data = patterned(100 * 1024);
    const writer = s3.file("small.bin").writer();
    writer.write(data);
    await writer.end();
    expect(singlePuts).toHaveLength(1);
    expect(Buffer.compare(singlePuts[0], data)).toBe(0);
  });

  it.skipIf(mandatoryProxy)("converts non-ASCII string writes to UTF-8", async () => {
    const { server, s3, singlePuts } = makeServer();
    using _s = server;
    const writer = s3.file("text.txt").writer();
    writer.write("hello ");
    writer.write("wörld ✓");
    await writer.end();
    expect(singlePuts).toHaveLength(1);
    expect(singlePuts[0].toString("utf8")).toBe("hello wörld ✓");
  });
});

describe("S3 multipart upload teardown", () => {
  // A writer dropped in the never-started state (sub-part-size write, no
  // end()) issues no request, so no completion callback ever fires; the
  // wrapper's finalizer must tear the upload task down itself or the task's
  // event-loop handle keeps the process alive forever.
  it("a writer dropped before its first request releases its event-loop handle", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { heapStats } = require("bun:jsc");
        const networkSinkCells = () => heapStats().objectTypeCounts.NetworkSink ?? 0;
        function makeAbandonedWriter() {
          const s3 = new Bun.S3Client({
            endpoint: "http://127.0.0.1:1",
            bucket: "b",
            accessKeyId: "k",
            secretAccessKey: "s",
            region: "r",
          });
          const writer = s3.file("never-started.bin").writer();
          writer.write("tiny");
          // cell count while the wrapper is provably live (also counts
          // persistent prototype/structure cells, so it never reaches 0)
          return networkSinkCells();
        }
        const withWriter = makeAbandonedWriter();
        // wait for the wrapper cell to be collected: the count drops below
        // its live-writer level
        for (let i = 0; networkSinkCells() >= withWriter; i++) {
          if (i > 500) throw new Error("writer wrapper was never collected");
          Bun.gc(true);
          await Bun.sleep(0);
        }
        console.log("collected");
        // nothing else is pending: the process must now exit on its own`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) console.error(stderr);
    expect(stdout).toBe("collected\n");
    expect(exitCode).toBe(0);
  });

  // Signing the multipart-init request fails synchronously (empty
  // credentials) while a second full part is already staged. The drain loop
  // must stop handing parts to the failed task; a part stored after fail()
  // is never started, canceled, or freed, and LeakSanitizer aborts the child
  // on the leaked 5 MiB buffer.
  it.skipIf(!isASAN)("frees staged parts when the multipart init fails synchronously", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const s3 = new Bun.S3Client({
          endpoint: "http://127.0.0.1:1",
          bucket: "b",
          accessKeyId: "",
          secretAccessKey: "",
          region: "r",
        });
        const writer = s3.file("sign-fail.bin").writer();
        // one write staging two full 5 MiB parts before the first drain
        writer.write(Buffer.alloc(10 * 1024 * 1024, 7));
        console.log("ended", await writer.end());`,
      ],
      env: {
        ...bunEnv,
        // same leak-check contract the ASAN CI runner applies to test
        // processes (scripts/runner.node.mjs): full VM teardown so exit-time
        // reachability is precise, leak detection on, abort so a report
        // fails the child.
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1", "abort_on_error=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS:
          bunEnv.LSAN_OPTIONS ??
          `malloc_context_size=30:print_suppressions=0:suppressions=${join(import.meta.dir, "../../../leaksan.supp")}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) console.error(stderr);
    expect(stdout).toBe("ended 0\n");
    expect(exitCode).toBe(0);
  });
});

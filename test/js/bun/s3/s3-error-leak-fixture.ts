// Each failed S3 request surfaces an `S3Error` to JS via `JSS3Error`, which
// allocates two WTFStringImpls (code + message) with +1 refs. Those refs must
// be released on the Rust side after the FFI call; if not, every failed
// request leaks the message string forever.
//
// We force the <Message> over 64 bytes so `create_atom_if_possible` falls
// through to a fresh `clone_utf8` allocation (atoms are interned and would
// hide the leak behind a single refcount), and make each message unique so
// leaked allocations accumulate visibly in RSS.

import { S3Client } from "bun";

const msgSize = 128 * 1024;
const warmup = 200;
const main = 200;

let n = 0;
const pad = Buffer.alloc(msgSize, "m").toString();
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch() {
    const msg = `req-${n++}-${pad}`;
    const body = `<?xml version="1.0"?><Error><Code>NoSuchBucket</Code><Message>${msg}</Message></Error>`;
    return new Response(body, {
      status: 404,
      headers: { "content-type": "application/xml" },
    });
  },
});

const s3 = new S3Client({
  accessKeyId: "x",
  secretAccessKey: "y",
  endpoint: `http://127.0.0.1:${server.port}`,
  bucket: "b",
});

async function hit() {
  try {
    await s3.file("k").text();
    throw new Error("expected S3 request to fail");
  } catch (e: any) {
    if (e?.code !== "NoSuchBucket") throw e;
  }
}

for (let i = 0; i < warmup; i++) await hit();
Bun.gc(true);
await Bun.sleep(10);
Bun.gc(true);

const before = process.memoryUsage.rss();

for (let i = 0; i < main; i++) await hit();
Bun.gc(true);
await Bun.sleep(10);
Bun.gc(true);

const growth = process.memoryUsage.rss() - before;

server.stop(true);

// Expected leak on the unfixed build: `main * msgSize` ≈ 25 MB of message
// strings. The threshold sits at half that so fixed builds (near-zero growth)
// pass with room for allocator noise.
const thresholdBytes = (main * msgSize) / 2;
console.log(
  JSON.stringify({
    growth,
    threshold: thresholdBytes,
    leaked: growth > thresholdBytes,
  }),
);
if (growth > thresholdBytes) {
  throw new Error(
    `S3 error path leaked ${(growth / 1024 / 1024).toFixed(1)} MB over ${main} failed requests`,
  );
}

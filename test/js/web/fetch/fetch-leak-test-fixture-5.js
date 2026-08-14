// Spawned by fetch-leak.test.ts ("Sending <type> does not leak"):
//   fetch-leak-test-fixture-5.js <server url> <body size in bytes> <body type> <request count>
// POSTs the requests in batches, waits for each batch's Response objects and
// fetch() promises to be collected, and prints one JSON line for the parent to
// assert on. RSS growth is measured from after the first batch so one-time
// allocations (JIT, allocator warm-up, the cached body) are not counted.
import { heapStats } from "bun:jsc";
const rss =
  process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function"
    ? Bun.unsafe.memoryFootprint
    : process.memoryUsage.rss;

const server = process.argv[2];
const BODY_SIZE = parseInt(process.argv[3], 10);
const type = process.argv[4];
const REQUESTS = parseInt(process.argv[5], 10);
const batch = 10;
if (!Number.isSafeInteger(BODY_SIZE) || !Number.isSafeInteger(REQUESTS) || REQUESTS % batch !== 0) {
  console.error("body size must be an integer and the request count a multiple of", batch, process.argv);
  process.exit(1);
}
// Everything a batch allocated is garbage once the batch has settled, but the
// most recent batch or two can still be pinned by the native side when a GC
// runs (see collectBatch), so only counts that stay above a couple of batches'
// worth are a leak.
const maxResponses = batch * 2 + batch / 2;
// JSC's C++ module loader keeps a handful of pipeline JSPromises live in the
// module map (fetch/module/load per registry entry) for the life of the
// process. These are constant across batches, so account for them separately
// from the per-batch leak threshold.
const maxPromises = maxResponses + 10;

function getFormData() {
  const formData = new FormData();

  formData.set("file", getBlob());
  return formData;
}
let cachedBlobBuffer;
function getBlob() {
  if (!cachedBlobBuffer) {
    const buf = new Uint8Array(BODY_SIZE);
    buf.fill(42);
    for (let i = 0; i < 256; i++) {
      buf[i] = i;
    }
    cachedBlobBuffer = buf;
  }
  return new Blob([cachedBlobBuffer], { type: "application/octet-stream" });
}
function getBuffer() {
  return Buffer.alloc(BODY_SIZE, "abcdefghijklmnopqrstuvwxyz");
}
function getString() {
  return getBuffer().toString();
}
function getURLSearchParams() {
  // The URLSearchParams itself is what gets copied and serialized per request;
  // the string it is built from can be shared.
  const urlSearchParams = new URLSearchParams();
  urlSearchParams.set("file", (cachedBody ??= getString()));
  return urlSearchParams;
}

// Cache only buffer/string since those aren't reference counted the same way.
let cachedBody;
function getBody() {
  let body;
  switch (type.toLowerCase()) {
    case "blob":
      body = getBlob();
      break;
    case "buffer":
      body = cachedBody ??= getBuffer();
      break;
    case "string":
      body = cachedBody ??= getString();
      break;
    case "formdata":
      body = getFormData();
      break;
    case "urlsearchparams":
      body = getURLSearchParams();
      break;
    case "iterator":
      body = async function* iter() {
        yield (cachedBody ??= getString());
      };
      break;
    case "stream":
      body = new ReadableStream({
        async pull(c) {
          // Hand the chunk over after the request has started so the body is
          // streamed into an in-flight request rather than buffered up front.
          await Bun.sleep(10);
          c.enqueue((cachedBody ??= getBuffer()));
          c.close();
        },
      });
      break;
    default:
      throw new Error(`Invalid type: ${type}`);
  }

  return body;
}

let requests = 0;
async function sendBatch() {
  const promises = [];
  for (let j = 0; j < batch; j++) {
    promises.push(fetch(server, { method: "POST", body: getBody() }));
  }
  for (const response of await Promise.all(promises)) {
    if (response.status !== 200) throw new Error(`unexpected status ${response.status}`);
    requests++;
  }
}

// A settled fetch() still has its Response and promise pinned until the native
// side lets go of them on a later event-loop turn, so poll for the counts to
// drop rather than sleeping a fixed amount. A real leak never drops below the
// limits, so the poll is bounded and the last counts seen are reported.
async function collectBatch() {
  const deadline = Date.now() + 5_000;
  for (;;) {
    Bun.gc(true);
    const counts = heapStats().objectTypeCounts;
    const responses = counts.Response ?? 0;
    const promises = counts.Promise ?? 0;
    if ((responses <= maxResponses && promises <= maxPromises) || Date.now() >= deadline) {
      return { responses, promises };
    }
    await new Promise(resolve => setImmediate(resolve));
  }
}

let peakResponses = 0;
let peakPromises = 0;
let baseline = 0;
while (requests < REQUESTS) {
  await sendBatch();
  const { responses, promises } = await collectBatch();
  peakResponses = Math.max(peakResponses, responses);
  peakPromises = Math.max(peakPromises, promises);
  // Once a batch has failed to be collected every later one would only wait out
  // the deadline again.
  if (responses > maxResponses || promises > maxPromises) break;
  if (requests === batch) baseline = rss();
}

console.log(
  JSON.stringify({
    type,
    requests,
    peakResponses,
    peakPromises,
    rssGrowthMB: Math.round(((rss() - baseline) / 1024 / 1024) * 10) / 10,
  }),
);
if (peakResponses > maxResponses || peakPromises > maxPromises) {
  throw new Error(
    `${peakResponses} Response and ${peakPromises} Promise objects survived GC after ${requests} requests (limits ${maxResponses} and ${maxPromises})`,
  );
}

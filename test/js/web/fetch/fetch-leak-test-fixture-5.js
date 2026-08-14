// Spawned by fetch-leak.test.ts ("Sending <type> does not leak"):
//   fetch-leak-test-fixture-5.js <server url> <body size in bytes> <body type> <request count>
// POSTs the requests in batches, checks that the Response objects and fetch()
// promises were collected, and prints one JSON line with the RSS growth, whose
// threshold the parent owns. The growth is measured from after the first batch
// so one-time allocations (JIT, allocator warm-up, the cached body) are not
// counted. The counts are checked after the first batch and at the end only: on
// some lanes (x64-asan, Windows 2019) the native side takes about a second to
// let go of a finished batch, so checking after every batch cost a second per
// batch there without catching anything the final check does not.
import { expectCollected, maxResponsesAlive } from "./fetch-leak-test-helpers.js";
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
// JSC's C++ module loader keeps a handful of pipeline JSPromises live in the
// module map (fetch/module/load per registry entry) for the life of the
// process, so the promise count the process settles at is measured after the
// first batch instead of being hard-coded; a leaked promise per request then
// adds the remaining requests (REQUESTS - batch of them) on top of it.
const promiseSlack = batch / 2;

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
          // Hand the chunk over a little after the request has started so the
          // body is streamed into an in-flight request rather than buffered up
          // front. (The server reads the body before answering, so no pull is
          // still pending once the responses are in.)
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

// The first batch provides the settled promise count and the RSS baseline.
await sendBatch();
const settled = await expectCollected(
  { Response: maxResponsesAlive, Promise: Infinity },
  `the first ${requests} requests`,
);
const baseline = rss();

while (requests < REQUESTS) await sendBatch();
const alive = await expectCollected(
  { Response: maxResponsesAlive, Promise: settled.Promise + promiseSlack },
  `${requests} requests`,
);

console.log(
  JSON.stringify({
    type,
    requests,
    responsesAlive: alive.Response,
    promisesAlive: alive.Promise,
    rssGrowthMB: Math.round(((rss() - baseline) / 1024 / 1024) * 10) / 10,
  }),
);

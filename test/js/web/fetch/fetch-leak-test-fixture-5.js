import { heapStats } from "bun:jsc";
import { expect } from "bun:test";
const rss =
  process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function"
    ? Bun.unsafe.memoryFootprint
    : process.memoryUsage.rss;
function getHeapStats() {
  return heapStats().objectTypeCounts;
}

const server = process.argv[2];
const batch = 10;
const warmupIterations = 2;
const iterations = 12;
const threshold = batch * 2 + batch / 2;
// JSC's C++ module loader keeps a handful of pipeline JSPromises live in the
// module map (fetch/module/load per registry entry) for the life of the
// process. These are constant across iterations, so account for them
// separately from the per-batch leak threshold.
const promiseThreshold = threshold + 10;
const BODY_SIZE = parseInt(process.argv[3], 10);
if (!Number.isSafeInteger(BODY_SIZE)) {
  console.error("BODY_SIZE must be a safe integer", BODY_SIZE, process.argv);
  process.exit(1);
}

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
  const urlSearchParams = new URLSearchParams();
  urlSearchParams.set("file", getString());
  return urlSearchParams;
}

const type = process.argv[4];

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
        pull(c) {
          // The server answers without reading the body, so the pull can still
          // be in flight when fetch() resolves, and by then the controller may
          // already be closed. Track the pull so iterate() waits for it before
          // the heap is measured.
          const pull = Bun.sleep(10).then(() => {
            try {
              c.enqueue((cachedBody ??= getBuffer()));
              c.close();
            } catch {}
          });
          pendingPulls.push(pull);
          return pull;
        },
      });
      break;
    default:
      throw new Error(`Invalid type: ${type}`);
  }

  return body;
}

let responses = 0;
const pendingPulls = [];
async function iterate() {
  const promises = [];
  for (let j = 0; j < batch; j++) {
    promises.push(fetch(server, { method: "POST", body: getBody() }));
  }
  for (const res of await Promise.all(promises)) {
    if (res.status !== 200) throw new Error("unexpected status " + res.status);
    responses++;
  }
  await Promise.all(pendingPulls);
  pendingPulls.length = 0;
}

// A Response finalizer releases its native body, so an object freed by one
// collection shows up in the next one's heap stats. Collect, yield, collect.
async function collect() {
  Bun.gc(true);
  await new Promise(r => setImmediate(r));
  Bun.gc(true);
}

let maxResponses = 0;
let maxPromises = 0;
async function measure() {
  await collect();
  const stats = getHeapStats();
  maxResponses = Math.max(maxResponses, stats.Response || 0);
  maxPromises = Math.max(maxPromises, stats.Promise || 0);
  expect(stats.Response || 0).toBeLessThanOrEqual(threshold);
  expect(stats.Promise || 0).toBeLessThanOrEqual(promiseThreshold);
}

try {
  for (let i = 0; i < warmupIterations; i++) {
    await iterate();
    await measure();
  }
  const baseline = rss();

  for (let i = 0; i < iterations; i++) {
    await iterate();
    await measure();
  }

  console.log(
    JSON.stringify({
      type,
      responses,
      maxResponses,
      maxPromises,
      deltaMiB: Math.round(((rss() - baseline) / 1024 / 1024) * 10) / 10,
    }),
  );
  process.exit(0);
} catch (e) {
  console.error(e);
  process.exit(1);
}

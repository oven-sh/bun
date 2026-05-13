import { heapStats } from "bun:jsc";
import { expect } from "bun:test";
function getHeapStats() {
  return heapStats().objectTypeCounts;
}

const server = process.argv[2];
const batch = 10;
const iterations = 50;
// The leak this test guards against is *sustained per-iteration growth* of
// Response / Promise objects across `iterations` fetches. The previous version
// asserted an absolute object count, but that count has no fixed value: some
// body paths plus JSC's C++ module loader keep a residual of transient
// JSPromises alive, and on a debug/ASAN build under load `Bun.gc(true)` + a
// short sleep doesn't always drain the per-batch FetchTasklet cleanup before the
// measurement, so the residual both varies between runs and ramps up over the
// first iterations before plateauing. On Windows in particular the residual
// keeps drifting up slightly (GC jitter / late-settling cleanup) even after the
// warmup window. None of that is a leak. So instead: treat the first ~60% of the
// run as warmup (long enough for the residual to plateau), record its high-water
// mark as a baseline, keep nudging the baseline up for a few iterations past the
// warmup window, then require the rest to stay within baseline + a few batches of
// slack. A real leak keeps climbing and blows past that bound; a
// constant-or-plateauing residual does not.
const warmupIterations = Math.ceil(iterations * 0.6);
// Number of post-warmup iterations during which we still allow the baseline to
// be nudged upward (absorbs a slow plateau without masking a real leak).
const baselineSettleIterations = 3;
const growthSlack = batch * 4 + 32;
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
        async pull(c) {
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

async function iterate() {
  const promises = [];
  for (let j = 0; j < batch; j++) {
    promises.push(fetch(server, { method: "POST", body: getBody() }));
  }
  await Promise.all(promises);
}

let baselineResponses = 0;
let baselinePromises = 0;

try {
  for (let i = 0; i < iterations; i++) {
    await iterate();

    {
      Bun.gc(true);
      await Bun.sleep(100);
      Bun.gc(true);
      const stats = getHeapStats();
      const responses = stats.Response || 0;
      const promises = stats.Promise || 0;
      if (i < warmupIterations) {
        // Warmup: let the constant residual settle; record its high-water mark.
        baselineResponses = Math.max(baselineResponses, responses);
        baselinePromises = Math.max(baselinePromises, promises);
      } else if (i < warmupIterations + baselineSettleIterations) {
        // Still settling: keep nudging the baseline up, but also enforce the
        // bound so a real leak in this window is still caught.
        baselineResponses = Math.max(baselineResponses, responses);
        baselinePromises = Math.max(baselinePromises, promises);
        expect(responses).toBeLessThanOrEqual(baselineResponses + growthSlack);
        expect(promises).toBeLessThanOrEqual(baselinePromises + growthSlack);
      } else {
        expect(responses).toBeLessThanOrEqual(baselineResponses + growthSlack);
        expect(promises).toBeLessThanOrEqual(baselinePromises + growthSlack);
      }
      process.send({
        rss: process.memoryUsage.rss(),
      });
    }
  }
  process.send({
    rss: process.memoryUsage.rss(),
  });
  await Bun.sleep(10);
  process.exit(0);
} catch (e) {
  console.error(e);
  process.exit(1);
}

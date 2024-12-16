import { heapStats } from "bun:jsc";
import { expect } from "bun:test";
function getHeapStats() {
  return heapStats().objectTypeCounts;
}

const server = process.argv[2];
const batch = 10;
const iterations = 50;
const threshold = batch * 2 + batch / 2;
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

try {
  for (let i = 0; i < iterations; i++) {
    {
      const promises = [];
      for (let j = 0; j < batch; j++) {
        promises.push(fetch(server, { method: "POST", body: getBody() }));
      }
      await Promise.all(promises);
    }

    {
      Bun.gc(true);
      await Bun.sleep(100);
      Bun.gc(true);
      const stats = getHeapStats();
      expect(stats.Response || 0).toBeLessThanOrEqual(threshold);
      expect(stats.Promise || 0).toBeLessThanOrEqual(threshold);
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

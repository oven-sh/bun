// Spawned by fetch-leak.test.ts ("fetch doesn't leak > ... > fixture #2"). Fetches
// SERVER COUNT times, buffering every body through the ReadableStream fast
// path, and prints one JSON line with how many bodies' worth of RSS the process
// grew by. The parent owns the thresholds.
//
// env: SERVER (url), COUNT (measured requests), NAME ("tcp" | "tls" |
// "tls-with-client"; the last one passes per-request tls options to fetch()).
import { heapStats } from "bun:jsc";

const rss =
  process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function"
    ? Bun.unsafe.memoryFootprint
    : process.memoryUsage.rss;

const { SERVER, NAME } = process.env;
const COUNT = parseInt(process.env.COUNT, 10);
if (!SERVER || !Number.isSafeInteger(COUNT) || COUNT < 10) {
  throw new Error("SERVER and COUNT (>= 10) must be set: " + JSON.stringify({ SERVER, COUNT: process.env.COUNT }));
}

const tls =
  NAME === "tls-with-client"
    ? {
        cert: "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAKLdQVPy90jjMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV\nBAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX\naWRnaXRzIFB0eSBMdGQwHhcNMTkwMjAzMTQ0OTM1WhcNMjAwMjAzMTQ0OTM1WjBF\nMQswCQYDVQQGEwJBVTETMBEGA1UECAwKU29tZS1TdGF0ZTEhMB8GA1UECgwYSW50\nZXJuZXQgV2lkZ2l0cyBQdHkgTHRkMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB\nCgKCAQEA7i7IIEdICTiSTVx+ma6xHxOtcbd6wGW3nkxlCkJ1UuV8NmY5ovMsGnGD\nhJJtUQ2j5ig5BcJUf3tezqCNW4tKnSOgSISfEAKvpn2BPvaFq3yx2Yjz0ruvcGKp\nDMZBXmB/AAtGyN/UFXzkrcfppmLHJTaBYGG6KnmU43gPkSDy4iw46CJFUOupc51A\nFIz7RsE7mbT1plCM8e75gfqaZSn2k+Wmy+8n1HGyYHhVISRVvPqkS7gVLSVEdTea\nUtKP1Vx/818/HDWk3oIvDVWI9CFH73elNxBkMH5zArSNIBTehdnehyAevjY4RaC/\nkK8rslO3e4EtJ9SnA4swOjCiqAIQEwIDAQABo1AwTjAdBgNVHQ4EFgQUv5rc9Smm\n9c4YnNf3hR49t4rH4yswHwYDVR0jBBgwFoAUv5rc9Smm9c4YnNf3hR49t4rH4ysw\nDAYDVR0TBAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEATcL9CAAXg0u//eYUAlQa\nL+l8yKHS1rsq1sdmx7pvsmfZ2g8ONQGfSF3TkzkI2OOnCBokeqAYuyT8awfdNUtE\nEHOihv4ZzhK2YZVuy0fHX2d4cCFeQpdxno7aN6B37qtsLIRZxkD8PU60Dfu9ea5F\nDDynnD0TUabna6a0iGn77yD8GPhjaJMOz3gMYjQFqsKL252isDVHEDbpVxIzxPmN\nw1+WK8zRNdunAcHikeoKCuAPvlZ83gDQHp07dYdbuZvHwGj0nfxBLc9qt90XsBtC\n4IYR7c/bcLMmKXYf0qoQ4OzngsnPI5M+v9QEHvYWaKVwFY4CTcSNJEwfXw+BAeO5\nOA==\n-----END CERTIFICATE-----",
      }
    : undefined;

let requests = 0;
// Decoded size of the body, taken from the first response; every response must
// match it. (Content-Length is the encoded size when the body is compressed.)
let bodySize = 0;
async function request() {
  const response = await fetch(SERVER, { tls });
  if (!response.headers.has("Content-Length")) throw new Error("Content-Length header is not set");
  // Touching .body first makes arrayBuffer() go through the buffered
  // ReadableStream fast path instead of reading the body directly.
  response.body;
  const { byteLength } = await response.arrayBuffer();
  bodySize ||= byteLength;
  if (byteLength !== bodySize) throw new Error(`body was ${byteLength} bytes, expected ${bodySize}`);
  requests++;
}

// Every Response is garbage once request() returns, bar the most recent ones,
// which the native side lets go of on a later event-loop turn: poll for that
// instead of sleeping. A leak never gets under the limit, so the poll is bounded
// and the count is reported instead.
const maxResponsesAlive = 5;
async function collectResponses() {
  const deadline = Date.now() + 5_000;
  for (;;) {
    Bun.gc(true);
    const alive = heapStats().objectTypeCounts.Response ?? 0;
    if (alive <= maxResponsesAlive || Date.now() >= deadline) return alive;
    await new Promise(resolve => setImmediate(resolve));
  }
}

// Warm up so the connection pool, decompressor state and allocator are at
// steady state before the baseline is taken.
for (let i = 0; i < COUNT / 10; i++) await request();
await collectResponses();
const baseline = rss();

for (let i = 0; i < COUNT; i++) await request();
const responsesAlive = await collectResponses();

const growth = rss() - baseline;
console.log(
  JSON.stringify({
    requests,
    count: COUNT,
    bodySize,
    responsesAlive,
    rssGrowthMB: Math.round((growth / 1024 / 1024) * 10) / 10,
    // A body retained per request shows up here as roughly COUNT.
    bodiesRetained: Math.round((growth / bodySize) * 10) / 10,
  }),
);
if (responsesAlive > maxResponsesAlive) {
  throw new Error(`${responsesAlive} Response objects are still alive after ${requests} buffered fetches`);
}

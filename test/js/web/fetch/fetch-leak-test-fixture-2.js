import { heapStats } from "bun:jsc";

const rss =
  process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function"
    ? Bun.unsafe.memoryFootprint
    : process.memoryUsage.rss;

const { SERVER } = process.env;

if (typeof SERVER === "undefined" || !SERVER?.length) {
  throw new Error("SERVER environment variable is not set");
}

const COUNT = parseInt(process.env.COUNT || "50", 10);
const EXPECT_BYTES = parseInt(process.env.EXPECT_BYTES || "0", 10);
const tls =
  process.env.NAME === "tls-with-client"
    ? {
        cert: "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAKLdQVPy90jjMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV\nBAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX\naWRnaXRzIFB0eSBMdGQwHhcNMTkwMjAzMTQ0OTM1WhcNMjAwMjAzMTQ0OTM1WjBF\nMQswCQYDVQQGEwJBVTETMBEGA1UECAwKU29tZS1TdGF0ZTEhMB8GA1UECgwYSW50\nZXJuZXQgV2lkZ2l0cyBQdHkgTHRkMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB\nCgKCAQEA7i7IIEdICTiSTVx+ma6xHxOtcbd6wGW3nkxlCkJ1UuV8NmY5ovMsGnGD\nhJJtUQ2j5ig5BcJUf3tezqCNW4tKnSOgSISfEAKvpn2BPvaFq3yx2Yjz0ruvcGKp\nDMZBXmB/AAtGyN/UFXzkrcfppmLHJTaBYGG6KnmU43gPkSDy4iw46CJFUOupc51A\nFIz7RsE7mbT1plCM8e75gfqaZSn2k+Wmy+8n1HGyYHhVISRVvPqkS7gVLSVEdTea\nUtKP1Vx/818/HDWk3oIvDVWI9CFH73elNxBkMH5zArSNIBTehdnehyAevjY4RaC/\nkK8rslO3e4EtJ9SnA4swOjCiqAIQEwIDAQABo1AwTjAdBgNVHQ4EFgQUv5rc9Smm\n9c4YnNf3hR49t4rH4yswHwYDVR0jBBgwFoAUv5rc9Smm9c4YnNf3hR49t4rH4ysw\nDAYDVR0TBAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEATcL9CAAXg0u//eYUAlQa\nL+l8yKHS1rsq1sdmx7pvsmfZ2g8ONQGfSF3TkzkI2OOnCBokeqAYuyT8awfdNUtE\nEHOihv4ZzhK2YZVuy0fHX2d4cCFeQpdxno7aN6B37qtsLIRZxkD8PU60Dfu9ea5F\nDDynnD0TUabna6a0iGn77yD8GPhjaJMOz3gMYjQFqsKL252isDVHEDbpVxIzxPmN\nw1+WK8zRNdunAcHikeoKCuAPvlZ83gDQHp07dYdbuZvHwGj0nfxBLc9qt90XsBtC\n4IYR7c/bcLMmKXYf0qoQ4OzngsnPI5M+v9QEHvYWaKVwFY4CTcSNJEwfXw+BAeO5\nOA==\n-----END CERTIFICATE-----",
      }
    : null;

let textLength = 0;
let oks = 0;

async function iterate() {
  const resp = await fetch(SERVER, { tls });
  textLength = Number(resp.headers.get("Content-Length"));
  if (!textLength) {
    throw new Error("Content-Length header is not set");
  }
  resp.body;
  const byteLength = (await resp.arrayBuffer()).byteLength;
  if (byteLength !== EXPECT_BYTES) {
    throw new Error("Expected " + EXPECT_BYTES + " body bytes, got " + byteLength);
  }
  oks++;
}

Bun.gc(true);
for (let i = 0; i < Math.max(Math.ceil(COUNT / 10), 1); i++) {
  await iterate();
}
Bun.gc(true);
const baseline = rss();
oks = 0;

for (let j = 0; j < COUNT; j++) {
  await iterate();
}

if (oks !== COUNT) {
  throw new Error("Not all requests succeeded");
}

Bun.gc(true);
await new Promise(r => setImmediate(r));
Bun.gc(true);
const delta = rss() - baseline;
const responses = heapStats().objectTypeCounts.Response ?? 0;
if (responses > 5) {
  throw new Error("Too many Response objects: " + responses);
}

// A leak of one body per request grows RSS by at least COUNT times the larger
// of the wire size and the decoded size. Fail at a quarter of that, which is
// still several times the allocator noise.
const fullLeak = COUNT * Math.max(textLength, EXPECT_BYTES);
const maxDelta = fullLeak / 4;
const mb = n => Math.round((n / 1024 / 1024) * 10) / 10;

console.log(
  JSON.stringify({ count: COUNT, bodyBytes: textLength, responses, deltaMB: mb(delta), maxDeltaMB: mb(maxDelta) }),
);

if (delta > maxDelta) {
  throw new Error("fetch leaked " + mb(delta) + " MB over " + COUNT + " requests (max " + mb(maxDelta) + " MB)");
}

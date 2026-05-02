// Avoid using String.prototype.repeat in this file because it's very slow in
// debug builds of JavaScriptCore.
const { randomUUID } = require("crypto");

const payloadMiB = Number(process.env.PAYLOAD_MIB || "1");
const warmupIterations = Number(process.env.WARMUP_ITERATIONS || "8");
const iterations = Number(process.env.ITERATIONS || "80");
const maxAllowedRSSIncrementMiB = Number(process.env.MAX_ALLOWED_RSS_INCREMENT_MB || "64");

const payloadSize = payloadMiB * 1024 * 1024;
const payload = Buffer.alloc(payloadSize, "A".charCodeAt(0));
const s3Dest = randomUUID() + "-s3-arraybuffer-leak-fixture";
const s3file = Bun.s3.file(s3Dest);

function rssMiB() {
  return (process.memoryUsage.rss() / 1024 / 1024) | 0;
}

async function readLargeFile() {
  let arrayBuffer = await Bun.s3.file(s3Dest).arrayBuffer();
  if (arrayBuffer.byteLength !== payloadSize) {
    throw new Error(`Expected ${payloadSize} bytes, got ${arrayBuffer.byteLength}`);
  }
  arrayBuffer = null;
}

await s3file.write(payload);
Bun.gc(true);

try {
  for (let i = 0; i < warmupIterations; i++) {
    await readLargeFile();
    Bun.gc(true);
  }

  await Bun.sleep(10);
  Bun.gc(true);

  const baseline = rssMiB();

  for (let i = 0; i < iterations; i++) {
    await readLargeFile();
    if ((i & 3) === 3) {
      Bun.gc(true);
    }
  }

  Bun.gc(true);
  await Bun.sleep(10);
  Bun.gc(true);

  const rss = rssMiB();
  const maxAllowedRSS = baseline + maxAllowedRSSIncrementMiB;

  if (rss > maxAllowedRSS) {
    throw new Error(`RSS reached ${rss}MB, expected <= ${maxAllowedRSS}MB (baseline ${baseline}MB)`);
  }
} finally {
  await s3file.unlink();
}

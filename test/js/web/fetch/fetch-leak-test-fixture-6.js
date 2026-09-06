const rss =
  process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function"
    ? Bun.unsafe.memoryFootprint
    : process.memoryUsage.rss;
const url = process.argv[2];
const expectBytes = parseInt(process.argv[3], 10);
const iterations = parseInt(process.argv[4], 10);

let chunks = 0;
async function iterate() {
  const response = await fetch(url);
  const reader = response.body.getReader();
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    chunks++;
    // Yield between reads so the body is consumed slower than it arrives.
    await new Promise(r => setImmediate(r));
  }
  if (bytes !== expectBytes) throw new Error("expected " + expectBytes + " bytes, got " + bytes);
}

for (let i = 0; i < Math.ceil(iterations / 10); i++) await iterate();
Bun.gc(true);
const baseline = rss();

for (let i = 0; i < iterations; i++) await iterate();
Bun.gc(true);
await new Promise(r => setImmediate(r));
Bun.gc(true);

console.log(JSON.stringify({ chunks, deltaMiB: Math.round(((rss() - baseline) / 1024 / 1024) * 10) / 10 }));

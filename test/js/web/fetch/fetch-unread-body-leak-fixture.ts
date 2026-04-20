// Client side of the fetch response-body backpressure test (Sentry BUN-2V22
// cluster). The server lives in the test file so this process's RSS measures
// only fetch-client buffering.
//
// Mechanism under test: when the unread response body in ByteStream.buffer /
// scheduled_response_buffer crosses the high-water mark, the HTTP thread
// pauses socket reads so TCP applies backpressure instead of the buffer
// growing without bound. When JS pulls below the low-water mark, reads resume.
//
// Shape:
//   1. Read ONE chunk to establish the ByteStream and enable streaming.
//   2. Stall. Yield to the event loop repeatedly so the HTTP thread has every
//      opportunity to deliver more data. With backpressure, RSS plateaus near
//      the high-water mark; without, it climbs toward the full payload.
//   3. Report the RSS plateau.
//   4. Drain a further N MB to prove resume works (the read would hang if the
//      socket stayed paused).

const SERVER = process.env.SERVER!;
const TARGET_BYTES = Number(process.env.TARGET_BYTES!);

const res = await fetch(SERVER);
const reader = res.body!.getReader();

// (1) Prime the stream so `response_body_streaming` is set before measuring.
const first = await reader.read();
if (first.done) throw new Error("server closed before sending data");

// Measure the baseline AFTER fetch/connect/first-read so we isolate growth
// during the stall. Under debug+ASAN the connect + JSC ReadableStream setup
// alone costs tens of MB; that's not what this test is about.
Bun.gc(true);
const baselineRSS = process.memoryUsage.rss();

// (2) Stall and let the HTTP thread push as much as backpressure allows. The
// outcome being tested is inherently a rate: without backpressure, RSS climbs
// at network speed; with it, RSS plateaus near the high-water mark almost
// immediately. We sample until either RSS crosses half the payload (leak —
// breaks immediately, makes the unfixed case fast and deterministic) or RSS
// has been stable for a stretch of consecutive samples (plateau — backpressure
// engaged). The 2ms inter-sample gap exists only so the HTTP thread gets
// scheduling time on release builds; the loop's exit is condition-driven.
let maxGrowth = 0;
let stableFor = 0;
let last = 0;
for (let i = 0; i < 250; i++) {
  await Bun.sleep(2);
  const growth = process.memoryUsage.rss() - baselineRSS;
  if (growth > maxGrowth) maxGrowth = growth;
  if (growth > TARGET_BYTES / 2) break;
  if (growth === last) {
    if (++stableFor >= 25) break;
  } else {
    stableFor = 0;
    last = growth;
  }
}
Bun.gc(true);

// (3) Report.
const stalledMB = (maxGrowth / 1024 / 1024) | 0;

// (4) Drain another 16 MB to prove the socket resumes after a pull. If
// backpressure paused the socket and resume is broken, this hangs and the
// parent's test timeout catches it.
let drained = first.value!.length;
while (drained < 16 * 1024 * 1024) {
  const { value, done } = await reader.read();
  if (done) break;
  drained += value.length;
}

console.log(
  JSON.stringify({
    sentMB: (TARGET_BYTES / 1024 / 1024) | 0,
    stalledRssGrowthMB: stalledMB,
    drainedMB: (drained / 1024 / 1024) | 0,
  }),
);

// Keep the response alive past the measurement so GC can't free the buffer
// before we sampled RSS.
void res;

process.exit(0);

// The point of the feature: state built before the freeze lives in the snapshot's shared, clean pages, so a restored process
// has far less private (anonymous) memory than a process that builds the same state itself. Reports RssAnon (Linux) at the
// same program point either way: after the state exists and a full collection has run.
const graph = [];
for (let i = 0; i < 60_000; i++) graph.push({ i, s: "item-" + i, arr: [i, i + 1, i + 2], m: new Map([[i, String(i)]]) });
globalThis.keep = graph;
function report(label) {
  Bun.gc(true);
  const kb = Number(/RssAnon:\s+(\d+)/.exec(require("fs").readFileSync("/proc/self/status", "utf8"))[1]);
  console.log(`[js] ${label} rss-anon-kb=${kb} items=${keep.length}`);
}
if (process.env.PLAIN) {
  report("plain");
} else {
  process.on("restore", () => { report("restored"); process.exit(0); });
  setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 10);
}

// Stateful HTTP workload: a Bun.serve() server hammered by many concurrent
// clients, every response body validated against what the server sent
// (length + content). Long-lived state (a request counter, a payload cache)
// so a poisoned read/write has somewhere to propagate. Prints
// WSF-CORRUPTION on any silent mismatch - the oracle for garbage faults.
console.log("STAGE: setup");
const PAYLOADS = [
  "x".repeat(64),
  JSON.stringify({ id: 7, name: "bun", tags: ["a", "b", "c"], nested: { ok: true, n: 12345 } }),
  "0123456789abcdef".repeat(256), // 4 KB
  Array.from({ length: 200 }, (_, i) => `line-${i}`).join("\n"),
];
let served = 0;
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const u = new URL(req.url);
    const i = +(u.searchParams.get("p") ?? 0) % PAYLOADS.length;
    served++;
    return new Response(PAYLOADS[i], { headers: { "x-idx": String(i), "x-len": String(PAYLOADS[i].length) } });
  },
});
console.log("STAGE: load");
const errors = [];
async function client(id) {
  for (let n = 0; n < 25; n++) {
    const p = (id + n) % PAYLOADS.length;
    let r, body;
    try {
      r = await fetch(`http://127.0.0.1:${server.port}/?p=${p}`);
      body = await r.text();
    } catch (e) {
      errors.push(String(e).slice(0, 60)); // an error is fine; wrong data is not
      continue;
    }
    const want = PAYLOADS[p];
    if (r.headers.get("x-idx") !== String(p)) console.log(`WSF-CORRUPTION: header idx ${r.headers.get("x-idx")} != ${p}`);
    if (body.length !== want.length) console.log(`WSF-CORRUPTION: body length ${body.length} != ${want.length} (p=${p})`);
    else if (body !== want) console.log(`WSF-CORRUPTION: body content mismatch (p=${p})`);
  }
}
await Promise.all(Array.from({ length: 8 }, (_, i) => client(i)));
console.log("STAGE: shutdown");
server.stop(true);
console.log(`http-load ok served=${served} errors=${errors.length}`);

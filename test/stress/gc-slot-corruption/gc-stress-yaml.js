// Round-2 stress for BUN-2V5X: add native object-graph builders
// (Bun.YAML.parse, JSON.parse, Response.json) on top of the abort/fetch
// churn, since 64% of crashers had yaml_parse=True.
"use strict";

const DURATION_MS = Number(process.env.STRESS_MS || 90_000);
const t0 = Date.now();

// Deep-ish YAML: maps, sequences, nested maps. Enough entries to push
// arrays into butterfly storage and objects into out-of-line storage.
function genYAML(depth, width) {
  let s = "";
  const ind = "  ".repeat(depth);
  for (let i = 0; i < width; i++) {
    s += `${ind}k${i}:\n`;
    s += `${ind}  a: ${i}\n`;
    s += `${ind}  b: "str${i}"\n`;
    s += `${ind}  c: [${Array.from({length: 12}, (_, j) => i * 12 + j).join(", ")}]\n`;
    s += `${ind}  d: {x: ${i}, y: ${i+1}, z: ${i+2}, w: ${i+3}, v: ${i+4}, u: ${i+5}, t: ${i+6}, s: ${i+7}, r: ${i+8}}\n`;
    if (depth < 2) s += `${ind}  nested:\n` + genYAML(depth + 1, Math.max(2, width >> 1));
  }
  return s;
}
const YAML_SRC = genYAML(0, 16);
// Matching JSON tree for JSON.parse comparison.
const JSON_SRC = JSON.stringify(Bun.YAML.parse(YAML_SRC));

const server = Bun.serve({
  port: 0,
  async fetch() {
    await Bun.sleep((Math.random() * 6) | 0);
    return new Response(JSON_SRC, { headers: { "content-type": "application/json" } });
  },
});
const url = `http://127.0.0.1:${server.port}/`;

let live = [];
let stats = { yaml: 0, json: 0, fetch: 0, abort: 0, spawn: 0, closure: 0 };

function retain(...xs) {
  for (const x of xs) live.push(x);
  if (live.length > 60_000) live = live.slice(live.length >> 1);
}

function makeClosureNest(seed) {
  let a = seed, b = seed|1, c = seed|2, d = seed|3, e = seed|4, f = seed|5;
  let g = [a,b,c,d,e,f,a,b,c,d,e,f];
  return () => {
    let h = a+b, i = c+d, j = e+f;
    return () => a+b+c+d+e+f+h+i+j+g.length;
  };
}

async function yamlLoop() {
  while (Date.now() - t0 < DURATION_MS) {
    for (let k = 0; k < 8; k++) {
      const o = Bun.YAML.parse(YAML_SRC);
      retain(o, o.k0, o.k0?.c, o.k0?.d);
      stats.yaml++;
    }
    await Bun.sleep(0);
  }
}

async function jsonLoop() {
  while (Date.now() - t0 < DURATION_MS) {
    for (let k = 0; k < 8; k++) {
      const o = JSON.parse(JSON_SRC);
      retain(o, Object.values(o));
      stats.json++;
    }
    const cl = makeClosureNest(stats.json);
    retain(cl, cl());
    stats.closure++;
    await Bun.sleep(0);
  }
}

async function fetchAbortLoop() {
  while (Date.now() - t0 < DURATION_MS) {
    const ac = new AbortController();
    ac.signal.addEventListener("abort", () => retain({ r: ac.signal.reason }));
    const t = (Math.random() * 6) | 0;
    setTimeout(() => ac.abort(new Error("mid")), t);
    try {
      const res = await fetch(url, { signal: ac.signal });
      const body = await res.json();
      retain(body, res.headers);
    } catch { stats.abort++; }
    stats.fetch++;
    retain(ac, ac.signal);
  }
}

async function spawnLoop() {
  const bun = process.execPath;
  while (Date.now() - t0 < DURATION_MS) {
    const ac = new AbortController();
    const p = Bun.spawn({ cmd: [bun, "-e", "1"], stdout: "ignore", stderr: "ignore", signal: ac.signal });
    if (Math.random() < 0.3) ac.abort();
    await p.exited;
    stats.spawn++;
    await Bun.sleep(3);
  }
}

const st = setInterval(() => {
  if (process.env.STRESS_QUIET === "1") return;
  console.error(`[${((Date.now()-t0)/1000).toFixed(1)}s]`, JSON.stringify(stats), "live=", live.length, "rss=", (process.memoryUsage().rss/1048576|0)+"M");
}, 3000);
st.unref?.();

await Promise.all([
  yamlLoop(), yamlLoop(),
  jsonLoop(), jsonLoop(),
  fetchAbortLoop(), fetchAbortLoop(), fetchAbortLoop(),
  spawnLoop(),
]);
server.stop(true);
console.error("done", JSON.stringify(stats));
process.exit(0);

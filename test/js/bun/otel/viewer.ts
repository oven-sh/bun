#!/usr/bin/env bun
// OTEL trace viewer — a tiny in-memory OTLP/HTTP collector with a waterfall UI.
//
// Run the viewer:
//   bun bd test/js/bun/otel/viewer.ts
//
// Point an app at it (in another terminal):
//   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 bun bd ./your-app.ts
// or programmatically:
//   Bun.otel.configure({ endpoint: "http://localhost:4318" });
//
// Then open http://localhost:4318 in a browser.

// @ts-expect-error TODO: packages/bun-types
const { decodeTraces } = Bun.otel;

type Span = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind?: number;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  attributes?: Array<{ key: string; value: Record<string, unknown> }>;
  events?: Array<{ name: string; timeUnixNano?: string; attributes?: unknown[] }>;
  status?: { code?: number; message?: string };
  scope?: string;
  resource?: Array<{ key: string; value: Record<string, unknown> }>;
};

type Trace = { traceId: string; spans: Span[]; lastSeen: number };

const MAX_TRACES = 200;
const store = new Map<string, Trace>();
const sseClients = new Set<(chunk: string) => void>();

function ingest(body: Uint8Array) {
  let decoded;
  try {
    decoded = decodeTraces(body);
  } catch (e) {
    return { ok: false, error: String(e) };
  }
  const touched = new Set<string>();
  for (const rs of decoded.resourceSpans ?? []) {
    const resource = rs.resource?.attributes ?? [];
    for (const ss of rs.scopeSpans ?? []) {
      const scope = ss.scope?.name ?? "";
      for (const sp of ss.spans ?? []) {
        const tid = sp.traceId;
        if (!tid) continue;
        let t = store.get(tid);
        if (!t) {
          t = { traceId: tid, spans: [], lastSeen: 0 };
          store.set(tid, t);
        }
        t.spans.push({ ...sp, scope, resource });
        t.lastSeen = Date.now();
        touched.add(tid);
      }
    }
  }
  // LRU evict
  if (store.size > MAX_TRACES) {
    const sorted = [...store.values()].sort((a, b) => a.lastSeen - b.lastSeen);
    for (let i = 0; i < store.size - MAX_TRACES; i++) store.delete(sorted[i].traceId);
  }
  for (const tid of touched) broadcast(summarize(store.get(tid)!));
  return { ok: true, count: touched.size };
}

function ns(s?: string): number {
  return s ? Number(BigInt(s) / 1000n) / 1000 : 0; // ns string → ms float
}

function summarize(t: Trace) {
  let min = Infinity,
    max = 0,
    root = t.spans[0];
  for (const s of t.spans) {
    const start = ns(s.startTimeUnixNano),
      end = ns(s.endTimeUnixNano);
    if (start && start < min) min = start;
    if (end > max) max = end;
    if (!s.parentSpanId || /^0+$/.test(s.parentSpanId)) root = s;
  }
  return {
    traceId: t.traceId,
    rootSpanName: root?.name ?? "(unknown)",
    spanCount: t.spans.length,
    durationMs: max - min,
    startTime: min,
    spans: t.spans,
  };
}

function broadcast(summary: ReturnType<typeof summarize>) {
  const chunk = `event: trace\ndata: ${JSON.stringify(summary)}\n\n`;
  for (const send of sseClients) send(chunk);
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 4318),
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/v1/traces") {
      ingest(new Uint8Array(await req.arrayBuffer()));
      return new Response(new Uint8Array(0), {
        status: 200,
        headers: { "content-type": "application/x-protobuf" },
      });
    }
    if (req.method === "GET" && url.pathname === "/api/traces") {
      const list = [...store.values()].sort((a, b) => b.lastSeen - a.lastSeen).map(summarize);
      return Response.json(list);
    }
    if (req.method === "DELETE" && url.pathname === "/api/traces") {
      store.clear();
      return new Response(null, { status: 204 });
    }
    if (req.method === "GET" && url.pathname === "/api/stream") {
      let send: (s: string) => void;
      const stream = new ReadableStream({
        start(ctrl) {
          send = s => ctrl.enqueue(new TextEncoder().encode(s));
          sseClients.add(send);
          send(": connected\n\n");
        },
        cancel() {
          sseClients.delete(send);
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      });
    }
    if (req.method === "GET" && url.pathname === "/") {
      return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`\n  otel viewer  ▸  ${server.url}`);
console.log(`  point apps at:  OTEL_EXPORTER_OTLP_ENDPOINT=${server.url.href.replace(/\/$/, "")}\n`);

// ───────────────────────────────────────────────────────────────────────────── UI

const HTML = /* html */ `<!doctype html>
<meta charset="utf-8"><title>bun ▪ otel</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;800&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0a0b0d; --panel: #111317; --hairline: #1e2128; --text: #c8ccd4; --dim: #6b7280;
    --server: #5eead4; --client: #fbbf24; --internal: #818cf8; --producer: #f472b6; --consumer: #a3e635;
    --err: #ef4444; --accent: #5eead4;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 12px/1.5 "JetBrains Mono", ui-monospace, monospace;
    background-image: radial-gradient(ellipse 80% 50% at 50% -10%, #14323033, transparent); }
  header { padding: 10px 16px; border-bottom: 1px solid var(--hairline); display: flex; align-items: baseline; gap: 16px;
    background: linear-gradient(#0e1013, #0a0b0d); }
  header h1 { margin: 0; font-size: 13px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }
  header h1 b { color: var(--accent); }
  header .meta { color: var(--dim); font-size: 11px; }
  header button { margin-left: auto; background: transparent; border: 1px solid var(--hairline); color: var(--dim);
    font: inherit; padding: 4px 10px; cursor: pointer; border-radius: 2px; }
  header button:hover { color: var(--text); border-color: #2a2e38; }
  main { display: grid; grid-template-columns: 320px 1fr; height: calc(100vh - 41px); }
  #rail { border-right: 1px solid var(--hairline); overflow-y: auto; background: var(--panel); }
  .trace { padding: 10px 12px; border-bottom: 1px solid var(--hairline); cursor: pointer; position: relative; }
  .trace:hover { background: #161920; }
  .trace.sel { background: #161920; box-shadow: inset 2px 0 0 var(--accent); }
  .trace .tid { color: var(--dim); font-size: 10px; }
  .trace .name { color: var(--text); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .trace .stats { color: var(--dim); font-size: 10px; display: flex; gap: 10px; }
  .trace.new::after { content: ""; position: absolute; inset: 0; background: var(--accent); opacity: 0;
    animation: flash 600ms ease-out; pointer-events: none; }
  @keyframes flash { from { opacity: 0.12; } to { opacity: 0; } }
  #view { overflow: auto; position: relative; }
  #waterfall { padding: 12px 16px 24px; min-width: 600px; }
  .axis { position: relative; height: 18px; border-bottom: 1px solid var(--hairline); margin-bottom: 6px; }
  .tick { position: absolute; top: 0; bottom: -1000px; border-left: 1px dashed #1a1d24; color: #3d4250;
    font-size: 9px; padding-left: 4px; }
  .row { position: relative; height: 22px; display: flex; align-items: center; }
  .row .gutter { color: var(--dim); font-size: 10px; padding-right: 8px; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; flex: 0 0 var(--gutter, 200px); }
  .row .lane { position: relative; flex: 1; height: 100%; }
  .bar { position: absolute; top: 4px; height: 14px; border-radius: 1px; cursor: pointer; min-width: 2px;
    display: flex; align-items: center; padding: 0 6px; font-size: 10px; color: #0a0b0d; font-weight: 600;
    white-space: nowrap; overflow: hidden; box-shadow: 0 0 0 1px #00000040 inset; transition: filter 80ms; }
  .bar:hover { filter: brightness(1.25) drop-shadow(0 0 6px currentColor); }
  .bar.err { background: repeating-linear-gradient(135deg, var(--err), var(--err) 4px, #b91c1c 4px, #b91c1c 8px) !important; color: #fff; }
  .bar .dur { margin-left: auto; opacity: 0.7; font-weight: 400; padding-left: 8px; }
  #detail { position: fixed; right: 0; top: 41px; bottom: 0; width: 420px; background: var(--panel);
    border-left: 1px solid var(--hairline); overflow-y: auto; padding: 14px 16px; transform: translateX(100%);
    transition: transform 160ms cubic-bezier(.4,0,.2,1); }
  #detail.open { transform: translateX(0); }
  #detail h2 { margin: 0 0 4px; font-size: 13px; font-weight: 800; }
  #detail .sub { color: var(--dim); font-size: 10px; margin-bottom: 12px; word-break: break-all; }
  #detail h3 { margin: 14px 0 6px; font-size: 10px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.1em; }
  #detail table { width: 100%; border-collapse: collapse; font-size: 11px; }
  #detail td { padding: 3px 0; vertical-align: top; word-break: break-all; }
  #detail td:first-child { color: var(--dim); padding-right: 12px; white-space: nowrap; }
  #detail .close { position: absolute; top: 8px; right: 10px; cursor: pointer; color: var(--dim); }
  .empty { padding: 40px; text-align: center; color: var(--dim); }
  .pill { display: inline-block; padding: 1px 6px; border-radius: 2px; font-size: 9px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.05em; }
  ::-webkit-scrollbar { width: 8px; height: 8px; } ::-webkit-scrollbar-thumb { background: #1e2128; }
</style>
<header>
  <h1>bun<b>▪</b>otel</h1>
  <span class="meta" id="count">0 traces</span>
  <button onclick="clearAll()">clear</button>
</header>
<main>
  <nav id="rail"><div class="empty">waiting for spans…<br><br>POST /v1/traces</div></nav>
  <section id="view"><div class="empty">select a trace</div></section>
</main>
<aside id="detail"></aside>
<script>
const KIND = ["internal","internal","server","client","producer","consumer"];
const KCOLOR = {server:"var(--server)",client:"var(--client)",internal:"var(--internal)",producer:"var(--producer)",consumer:"var(--consumer)"};
const traces = new Map(); let selected = null;

const ns = s => s ? Number(BigInt(s)/1000n)/1000 : 0;
const fmt = ms => ms < 1 ? (ms*1000).toFixed(0)+"µs" : ms < 1000 ? ms.toFixed(2)+"ms" : (ms/1000).toFixed(2)+"s";
const attrVal = v => { const k = Object.keys(v??{})[0]; return k ? String(v[k]?.values ? "["+v[k].values.length+"]" : v[k]) : ""; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

function upsert(t) {
  traces.set(t.traceId, t);
  document.getElementById("count").textContent = traces.size + " trace" + (traces.size===1?"":"s");
  renderRail(t.traceId);
  if (selected === t.traceId) renderTrace(t);
}
function renderRail(flashId) {
  const list = [...traces.values()].sort((a,b)=>b.startTime-a.startTime);
  const rail = document.getElementById("rail");
  rail.innerHTML = list.map(t =>
    \`<div class="trace \${t.traceId===selected?"sel":""} \${t.traceId===flashId?"new":""}" data-tid="\${t.traceId}">
      <div class="tid">\${t.traceId.slice(0,16)}…</div>
      <div class="name">\${esc(t.rootSpanName)}</div>
      <div class="stats"><span>\${t.spanCount} span\${t.spanCount===1?"":"s"}</span><span>\${fmt(t.durationMs)}</span></div>
    </div>\`).join("") || '<div class="empty">waiting for spans…</div>';
  rail.querySelectorAll(".trace").forEach(el => el.onclick = () => select(el.dataset.tid));
}
function select(tid) { selected = tid; renderRail(); renderTrace(traces.get(tid)); closeDetail(); }

function buildTree(spans) {
  const byId = new Map(spans.map(s=>[s.spanId,{s,children:[],depth:0}]));
  const roots = [];
  for (const n of byId.values()) {
    const p = n.s.parentSpanId && !/^0+$/.test(n.s.parentSpanId) && byId.get(n.s.parentSpanId);
    if (p) p.children.push(n); else roots.push(n);
  }
  const flat = [];
  const walk = (n,d) => { n.depth=d; flat.push(n); n.children.sort((a,b)=>ns(a.s.startTimeUnixNano)-ns(b.s.startTimeUnixNano)).forEach(c=>walk(c,d+1)); };
  roots.sort((a,b)=>ns(a.s.startTimeUnixNano)-ns(b.s.startTimeUnixNano)).forEach(r=>walk(r,0));
  return flat;
}
function renderTrace(t) {
  const flat = buildTree(t.spans);
  const min = Math.min(...flat.map(n=>ns(n.s.startTimeUnixNano)||Infinity));
  const max = Math.max(...flat.map(n=>ns(n.s.endTimeUnixNano)||0));
  const span = Math.max(max-min, 0.001);
  const ticks = 6;
  const gutter = Math.min(320, 100 + Math.max(...flat.map(n=>n.depth))*14);
  let html = \`<div id="waterfall" style="--gutter:\${gutter}px">
    <div class="row"><div class="gutter"></div><div class="lane axis">\${
      Array.from({length:ticks+1},(_,i)=>\`<span class="tick" style="left:\${i/ticks*100}%">\${fmt(span*i/ticks)}</span>\`).join("")
    }</div></div>\`;
  for (const n of flat) {
    const s = n.s, st = ns(s.startTimeUnixNano), en = ns(s.endTimeUnixNano)||st;
    const left = (st-min)/span*100, width = Math.max((en-st)/span*100, 0.15);
    const kind = KIND[s.kind??1]||"internal";
    const err = s.status?.code === 2;
    html += \`<div class="row"><div class="gutter" style="padding-left:\${n.depth*14}px" title="\${esc(s.name)}">\${esc(s.name)}</div>
      <div class="lane"><div class="bar \${err?"err":""}" data-sid="\${s.spanId}"
        style="left:\${left}%;width:\${width}%;background:\${KCOLOR[kind]};color:\${KCOLOR[kind]}">
        <span style="color:#0a0b0d">\${esc(s.name)}</span><span class="dur" style="color:#0a0b0d">\${fmt(en-st)}</span>
      </div></div></div>\`;
  }
  document.getElementById("view").innerHTML = html + "</div>";
  document.querySelectorAll(".bar").forEach(el => el.onclick = () => showDetail(t, el.dataset.sid));
}
function showDetail(t, sid) {
  const s = t.spans.find(x=>x.spanId===sid); if(!s) return;
  const kind = KIND[s.kind??1]||"internal";
  const d = document.getElementById("detail");
  const kv = (rows) => rows?.length ? "<table>"+rows.map(a=>\`<tr><td>\${esc(a.key)}</td><td>\${esc(attrVal(a.value))}</td></tr>\`).join("")+"</table>" : '<div style="color:var(--dim)">—</div>';
  d.innerHTML = \`<span class="close" onclick="closeDetail()">✕</span>
    <h2>\${esc(s.name)}</h2>
    <div class="sub"><span class="pill" style="background:\${KCOLOR[kind]};color:#0a0b0d">\${kind}</span>
      \${s.scope?\` · \${esc(s.scope)}\`:""} · \${fmt(ns(s.endTimeUnixNano)-ns(s.startTimeUnixNano))}</div>
    <div class="sub">trace \${s.traceId}<br>span&nbsp; \${s.spanId}\${s.parentSpanId&&!/^0+$/.test(s.parentSpanId)?\`<br>parent \${s.parentSpanId}\`:""}</div>
    \${s.status?.code?\`<h3>status</h3><table><tr><td>code</td><td>\${s.status.code===2?"ERROR":"OK"}</td></tr>\${s.status.message?\`<tr><td>message</td><td>\${esc(s.status.message)}</td></tr>\`:""}</table>\`:""}
    <h3>attributes</h3>\${kv(s.attributes)}
    \${s.events?.length?\`<h3>events</h3><table>\${s.events.map(e=>\`<tr><td>\${esc(e.name)}</td><td>+\${fmt(ns(e.timeUnixNano)-ns(s.startTimeUnixNano))}</td></tr>\`).join("")}</table>\`:""}
    <h3>resource</h3>\${kv(s.resource)}\`;
  d.classList.add("open");
}
function closeDetail(){ document.getElementById("detail").classList.remove("open"); }
async function clearAll(){ await fetch("/api/traces",{method:"DELETE"}); traces.clear(); selected=null; renderRail(); document.getElementById("view").innerHTML='<div class="empty">select a trace</div>'; }

fetch("/api/traces").then(r=>r.json()).then(list=>{ list.forEach(upsert); renderRail(); });
new EventSource("/api/stream").addEventListener("trace", e => upsert(JSON.parse(e.data)));
</script>`;

'use strict';
// Flags: --expose-gc
// Diagnostic twin of test-primitive-timer-leak.js: identical timer/GC
// structure; on a collection plateau it prints the retainer paths of the
// surviving Timeout wrappers from a GCDebugging heap snapshot, then exits 1.
require('../common');
const { onGC } = require('../common/gc');

const FORCE = process.env.BUN_DIAG_FORCE === '1';
const STATS_ONLY = process.env.BUN_DIAG_STATS_ONLY === '1';
const held = []; // FORCE mode: pin one extra timer to validate the parser.

const poller = setInterval(() => {
  globalThis.gc();
}, 100);

let count = 0;

for (let i = 0; i < 10; i++) {
  const timer = setTimeout(() => {}, 0);
  onGC(timer, {
    ongc: () => {
      if (++count === 10) {
        clearInterval(poller);
      }
    }
  });
  console.log(+timer);
}
if (FORCE) { const t = setTimeout(() => {}, 0); held.push(t); console.log('held:', +t); }

// ── plateau watchdog ────────────────────────────────────────────────────────
let lastCount = -1, stable = 0, ticks = 0;
const watchdog = setInterval(() => {
  ticks++;
  if (count === 10 && !FORCE) {
    process.stderr.write(`DIAG-OK all 10 collected after ${ticks} ticks\n`);
    clearInterval(watchdog);
    return;
  }
  if (FORCE && count === 10 && ticks >= 5) { clearInterval(watchdog); clearInterval(poller); diagnose(); return; }
  if (count === lastCount) stable++; else { stable = 0; lastCount = count; }
  if (stable >= 20 && ticks >= 30) { clearInterval(watchdog); clearInterval(poller); diagnose(); }
}, 100);

function diagnose() {
  const out = [];
  const jsc = require('bun:jsc');
  try {
    const hs = jsc.heapStats();
    out.push(`DIAG collected=${count}/10 mainThread=${Bun.isMainThread} platform=${process.platform}`);
    out.push(`heapStats Timeout=${hs.objectTypeCounts.Timeout ?? 0} protected.Timeout=${(hs.protectedObjectTypeCounts || {}).Timeout ?? 0}`);
    try {
      const rep = process.report && process.report.getReport && process.report.getReport();
      if (rep && rep.header) out.push(`report threadId=${rep.header.threadId ?? '?'} arch=${rep.header.arch ?? '?'}`);
    } catch {}
    if (!STATS_ONLY) snapshotPaths(out);
  } catch (e) {
    out.push('DIAG-ERROR ' + (e && e.message));
  }
  process.stderr.write(out.slice(0, 50).join('\n') + '\n');
  process.exit(1);
}

function snapshotPaths(out) {
  const o = require('bun:jsc').generateHeapSnapshotForDebugging();
  const NF = 7, EF = 4; // GCDebugging v3: nodes [id,size,classIdx,flags,labelIdx,cell,wrapped]; edges [from,to,type,data]
  const cls = o.nodeClassNames, labels = o.labels, eTypes = o.edgeTypes, eNames = o.edgeNames;
  const node = new Map(); // id -> {c: classIdx, l: labelIdx}
  for (let i = 0; i < o.nodes.length; i += NF) node.set(o.nodes[i], { c: o.nodes[i + 2], l: o.nodes[i + 4] });
  const rootReason = new Map(); // id -> reasons[]
  for (let i = 0; i < o.roots.length; i += 3) {
    const id = o.roots[i], r = labels[o.roots[i + 1]] ?? String(o.roots[i + 1]);
    if (!rootReason.has(id)) rootReason.set(id, []);
    rootReason.get(id).push(r);
  }
  const preds = new Map(); // to -> [{from, t, d}]
  for (let i = 0; i < o.edges.length; i += EF) {
    const from = o.edges[i], to = o.edges[i + 1];
    if (!preds.has(to)) preds.set(to, []);
    if (preds.get(to).length < 24) preds.get(to).push({ from, t: o.edges[i + 2], d: o.edges[i + 3] });
  }
  const timeouts = [];
  for (const [id, n] of node) if (cls[n.c] === 'Timeout') timeouts.push(id);
  out.push(`snapshot Timeout nodes: ${timeouts.length}`);
  const fmt = id => { const n = node.get(id); return `${cls[n.c]}${labels[n.l] ? `(${labels[n.l]})` : ''}#${id}`; };
  const edgeStr = e => { const t = eTypes[e.t]; return t === 'Property' || t === 'Variable' ? `${t}:${eNames[e.d] ?? e.d}` : t === 'Index' ? `Index:${e.d}` : t; };
  for (const tid of timeouts.slice(0, 4)) {
    if (rootReason.has(tid)) out.push(`ROOT ${fmt(tid)} <= [${rootReason.get(tid).join(',')}]`);
    const ins = preds.get(tid) || [];
    out.push(`  IN-EDGES ${fmt(tid)}: ${ins.length ? ins.slice(0, 6).map(e => `${fmt(e.from)} -${edgeStr(e)}-`).join(' | ') : '(none)'}`);
    if (!ins.length && !rootReason.has(tid)) {
      out.push(`  ${fmt(tid)}: unrooted + no in-edges => conservative/stack-marked (GCDebugging roots[] has no conservative category)`);
      continue;
    }
    // BFS backward to node 0 or any rooted node
    const seen = new Set([tid]), parent = new Map();
    let queue = [tid], hit = null;
    for (let depth = 0; depth < 14 && queue.length && !hit; depth++) {
      const next = [];
      for (const cur of queue) {
        for (const e of preds.get(cur) || []) {
          if (seen.has(e.from)) continue;
          seen.add(e.from); parent.set(e.from, { to: cur, e });
          if (e.from === 0 || rootReason.has(e.from)) { hit = e.from; break; }
          next.push(e.from);
        }
        if (hit) break;
      }
      queue = next;
    }
    if (hit === null) { out.push(`  ${fmt(tid)}: NO PATH TO ROOT within depth 14 (root-only retention)`); continue; }
    const parts = [];
    let cur = hit;
    const reason = hit === 0 ? '<root>' : `[${(rootReason.get(hit) || []).join(',')}]`;
    while (cur !== tid && parts.length < 14) {
      const step = parent.get(cur);
      parts.push(`${fmt(cur)} -${edgeStr(step.e)}-> `);
      cur = step.to;
    }
    out.push(`  PATH ${reason} ${parts.join('')}${fmt(tid)}`);
  }
}

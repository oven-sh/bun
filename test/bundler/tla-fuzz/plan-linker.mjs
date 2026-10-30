// Prototype linker, full version: flat mode (static evaluation plan) + wrapped mode (modules that an
// internal import() can reach, evaluated by a run-time DFS that shares the same scheduler core).
import { bodyLines, hasTLA } from "./gen.mjs";

// record fields
//   f body   t HasTLA   i () => imports (wrapped records only)
//   s 0 linked | 1 evaluating | 2 evaluating-async | 3 evaluated | 4 evaluated with error
//   o [[AsyncEvaluationOrder]] (-1 unset)   n [[PendingAsyncDependencies]]   p [[AsyncParentModules]]
//   r [[CycleRoot]] (0 = empty)   e error   c [[TopLevelCapability]] = [promise, resolve, reject]
export const CORE = String.raw`
var __n = 0;
var __rec = (f, t, i) => ({ f, t, i, s: 0, o: -1, n: 0, p: [], r: 0, e: 0, c: 0, d: 0 });
var __node = (f, t, deps, open, members, m) => {
  m = __rec(f, t);
  m.s = 2; m.o = __n++; m.n = deps.length;
  if (!open) m.r = m;
  if (members) for (var x of members) x.r = m;
  for (var d of deps) d.p.push(m);
  if (f && !m.n) __exec(m);
  return m;
};
var __exec = m => { m.f(m).then(() => __ok(m), e => __fail(m, e)); };
var __gather = (m, l) => {
  for (var a of m.p)
    if (a.r && a.r.s < 4 && !--a.n) { l.push(a); a.t || __gather(a, l); }
};
var __list = (m, l) => {
  m.s = 3;
  m.c && m.c[1]();
  __gather(m, l = []);
  return l.sort((a, b) => a.o - b.o);
};
var __run = a => {
  if (a.s > 2);
  else if (!a.f) a.s = 3; // the main thread runs it when we return
  else if (a.t) __exec(a);
  else try { a.f(); a.s = 3; a.c && a.c[1](); } catch (e) { __fail(a, e); }
};
var __ok = m => { if (m.s < 3) for (var a of __list(m)) __run(a); };
var __fail = (m, e) => {
  if (m.s > 2) return;
  m.s = 4; m.e = e;
  m.c && m.c[2](e);
  for (var a of m.p) __fail(a, e);
};
var __cap = (m, a, b) => (m.c = [new Promise((x, y) => { a = x; b = y; }), a, b])[0];
`;
export const DFS = String.raw`
var __stk = [], __ix = 0;
var __visit = (m, x, q) => {
  if (m.s > 1) { if (m.s > 3) throw m.e; return; }
  if (m.s) return;
  m.s = 1; x = m.d = __ix++;
  __stk.push(m);
  for (q of m.i()) {
    if (!q.p) { q(); continue; } // synchronous __esm wrapper
    __visit(q);
    if (q.s == 1) m.d = Math.min(m.d, q.d);
    else if ((q = q.r).s > 3) throw q.e;
    if (q.o >= 0 && q.s < 3) { m.n++; q.p.push(m); }
  }
  if (m.t || m.n) { m.o = __n++; m.n || __exec(m); } else m.f();
  if (m.d == x) do { q = __stk.pop(); q.s = q.o < 0 ? 3 : 2; q.r = m; } while (q != m);
};
// InnerModuleEvaluation of a wrapped module + the error bookkeeping of Evaluate()
var __top = m => {
  try { __visit(m); } catch (e) { for (var q of __stk) { q.s = 4; q.e = e; } __stk = []; throw e; }
};
var __evaluate = (m, p) => {
  if (m.s > 1 && m.r) m = m.r;
  if (m.c) return m.c[0];
  p = __cap(m);
  try { __top(m); m.s == 3 && m.c[1](); } catch (e) { m.c[2](e); }
  return p;
};
var __import = (m, ns) => new Promise((a, b) => { Promise.resolve().then(() => { __evaluate(m).then(() => a(ns()), b); }); });
var __importS = (init, ns) => new Promise((a, b) => { Promise.resolve().then(() => { new Promise(r => r(init())).then(() => a(ns()), b); }); });
var __esm = (fn, res, err) => () => {
  if (fn) try { res = fn(fn = 0); } catch (e) { err = [e]; }
  if (err) throw err[0];
  return res;
};
`;
// Code splitting: a chunk only defines records, so loading it evaluates nothing. import() loads, then evaluates.
export const CHUNKS = String.raw`
var __importChunk = (chunk, id) => chunk.then(c => __evaluate(c["w_" + id]).then(() => c["ns_" + id]));
var __importChunkS = (chunk, id) => chunk.then(c => (c["init_" + id](), c["ns_" + id]));
`;
export const ENTRY_INLINE = String.raw`
var __last, __wake, __E;
var __d = m => { --__r || (__last = m, __wake && __wake()); };
var __main = (deps, members) => new Promise(w => { __wake = w; (__E = __node(0, 0, deps, 0, members)).c = [0, 0, () => w()]; __r || w(); });
var __resume = () => { __E.s > 2 || __ok(__last); if (__E.s > 3) throw __E.e; };
`;

// Fail-fast variant: every sync module that waits on ALL TLA nodes stays flat on the main thread too.
// Exact as long as no module throws; after a throw nothing else runs (the spec would still run the
// modules that do not depend on the one that threw).
export const ENTRY_RELAXED = String.raw`
var __last, __wake, __F, __L = [];
var __d = m => { --__r || (__last = m, __wake && __wake()); };
var __fail0 = __fail;
__fail = (m, e) => { __F ||= [e]; __wake && __wake(); __fail0(m, e); };
var __main = () => new Promise(w => { __wake = w; });
var __chk = () => { if (__F) throw __F[0]; };
var __resume = () => { __F || (__L = __list(__last)); __chk(); };
var __upto = x => { while (__L.length && __L[0].o <= x.o) __run(__L.shift()); __chk(); };
`;

const surelySuspends = m => m.body.some(a => a.t === "await0" || a.t === "tick" || a.t === "sleep" || a.t === "wait");

export function analyze(g, opts = {}) {
  const N = g.mods.length;
  // wrapped = closure of import() targets under static imports
  const wrapped = Array(N).fill(false);
  const mark = i => {
    if (wrapped[i]) return;
    wrapped[i] = true;
    g.mods[i].imports.forEach(mark);
  };
  for (const m of g.mods) for (const a of m.body) if (a.t === "dyn") mark(a.to);
  // tainted = reaches a TLA module through static imports
  const tainted = g.mods.map(hasTLA);
  for (let changed = true; changed;) {
    changed = false;
    g.mods.forEach((m, i) => {
      if (!tainted[i] && m.imports.some(j => tainted[j])) tainted[i] = changed = true;
    });
  }
  // rec[i]: wrapped module that gets a full record (run-time DFS bookkeeping) instead of a sync __esm wrapper
  const rec = wrapped.map((w, i) => w && (tainted[i] || !!opts.allRec));
  return { wrapped, tainted, rec };
}

// Build-time InnerModuleEvaluation of the entry from a fresh graph. Returns a list of events:
//   { k: "post", m, tla, W, async, members, open }   flat module reaches its execute/schedule step
//   { k: "call", m }                                 a flat module's import touches wrapped module m
export function plan(g, A, opts = {}) {
  const through = {};
  const N = g.mods.length;
  const status = Array(N).fill(0),
    anc = Array(N).fill(0),
    order = Array(N).fill(-1),
    root = Array(N).fill(-1);
  const events = [],
    stack = [],
    items = [];
  let index = 0,
    count = 0;
  const inner = m => {
    if (status[m]) return;
    status[m] = 1;
    const my = (anc[m] = index++);
    stack.push(m);
    const W = [];
    for (const r0 of g.mods[m].imports) {
      if (A.wrapped[r0] && !A.wrapped[m]) events.push({ k: "call", m: r0 });
      inner(r0);
      let r = r0;
      if (status[r] === 1) anc[m] = Math.min(anc[m], anc[r]);
      else r = root[r];
      // whoever imports a module that was left out waits for what that module would have waited for
      for (const x of through[r] ?? [r]) if (order[x] >= 0 && !W.includes(x)) W.push(x);
    }
    const tla = hasTLA(g.mods[m]);
    const item = { k: "post", m, tla, W, async: tla || W.length > 0, members: [], open: false, wrapped: A.wrapped[m] };
    // A module that evaluates nothing needs no node. (Not in a cycle: its [[CycleRoot]] stands for the others.)
    if (
      opts.elide !== false &&
      g.mods[m].inert &&
      m !== 0 &&
      !A.wrapped[m] &&
      anc[m] === my &&
      stack.at(-1) === m &&
      !g.mods[m].imports.includes(m)
    ) {
      through[m] = W;
      item.async = false;
    }
    if (item.async) order[m] = count++;
    items.push(item);
    if (!A.wrapped[m]) events.push(item);
    if (anc[m] === my) {
      for (;;) {
        const x = stack.pop();
        status[x] = 2;
        root[x] = m;
        if (x === m) break;
        if (order[x] >= 0) item.members.push(x);
      }
    }
  };
  inner(0);
  for (const it of items) it.open = root[it.m] !== it.m;
  return { events, items };
}

export function emitProto2(g, opts = {}) {
  const A = analyze(g, opts);
  const out = [];
  const H = i => (A.wrapped[i] ? "w_" : "n_") + g.mods[i].id; // handle of an async-capable module
  const list = a => `[${a.map(H).join(", ")}]`;
  const imp = to => {
    const id = g.mods[to].id;
    if (opts.chunkOf)
      return `${A.rec[to] ? "__importChunk" : "__importChunkS"}(import("./${opts.chunkOf(to)}.mjs"), "${id}")`;
    return A.rec[to] ? `__import(w_${id}, () => ns_${id})` : `__importS(init_${id}, () => ns_${id})`;
  };
  const lines = i => bodyLines(g, g.mods[i], imp);
  const anyWrapped = A.wrapped.some(Boolean);

  const { events, items } = plan(g, A, opts);
  const entryWrapped = A.wrapped[0];
  const asyncItems = items.filter(it => it.async);
  const entryItem = items[items.length - 1];

  // ---- main-thread suffix (only flat modules qualify) ----------------------------------------
  const reach = new Map();
  for (const it of asyncItems) {
    const s = new Set();
    for (const w of it.W) {
      s.add(w);
      for (const x of reach.get(w)) s.add(x);
    }
    reach.set(it.m, s);
  }
  let suffix = [];
  // A module that an import() can reach may get more parents later, with a higher order than the entry's,
  // so "the entry is the last element of the last exec list" only holds when all async modules are flat.
  if (!entryWrapped && entryItem.async && opts.entry !== "node" && !asyncItems.some(it => it.wrapped)) {
    suffix = [entryItem];
    for (let i = asyncItems.length - 2; i >= 0 && opts.chain !== false; i--) {
      const it = asyncItems[i],
        next = suffix[0];
      if (it.wrapped || !reach.get(next.m).has(it.m) || it.open || it.members.length || next.open) break;
      if ([...reach.get(next.m)].some(x => x !== it.m && !reach.get(it.m).has(x))) break;
      suffix.unshift(it);
    }
    const coversAllTLA = head => asyncItems.every(x => !x.tla || suffix.includes(x) || reach.get(head.m).has(x.m));
    while (suffix.length > 1 && !coversAllTLA(suffix[0])) suffix.shift();
    const syncWorkAfter = it =>
      events.slice(events.indexOf(it) + 1).some(x => x.k === "call" || (!x.async && !g.mods[x.m].inert));
    while (suffix.length > 1 && syncWorkAfter(suffix[0])) suffix.shift();
  }
  let relaxed = false;
  if (opts.relaxed && suffix.length) {
    const Tn = asyncItems.filter(x => x.tla && !suffix.includes(x));
    const parents = new Map(asyncItems.map(it => [it.m, []]));
    for (const it of asyncItems) for (const w of it.W) parents.get(w).push(it.m);
    const onMain = new Set(suffix.map(it => it.m));
    for (let i = asyncItems.length - 1; i >= 0; i--) {
      const it = asyncItems[i];
      if (onMain.has(it.m) || it.tla || it.open || it.members.length) continue;
      if (Tn.every(t => reach.get(it.m).has(t.m)) && parents.get(it.m).every(p => onMain.has(p))) onMain.add(it.m);
    }
    if (Tn.length && onMain.size > suffix.length) {
      if (!Tn.some(it => it.W.length > 0 || surelySuspends(g.mods[it.m])))
        return emitProto2(g, { ...opts, relaxed: false });
      relaxed = true;
      suffix = asyncItems.filter(it => onMain.has(it.m));
    }
  }
  const inSuffix = new Set(suffix.map(it => it.m));
  const others = asyncItems.filter(it => !inSuffix.has(it.m));
  const tlaOthers = others.filter(it => it.tla);
  if (suffix.length && others.length) {
    const safe = tlaOthers.some(it => it.W.length > 0 || surelySuspends(g.mods[it.m]));
    if (!safe) {
      // every TLA module might run to completion inside the sync phase; then the last one must be the
      // last thing that runs user code there
      const lastFlatLeaf = Math.max(...tlaOthers.map(it => (it.wrapped ? Infinity : events.indexOf(it))));
      if (
        lastFlatLeaf === Infinity ||
        events.slice(lastFlatLeaf + 1).some(x => x.k === "call" || (!x.async && !g.mods[x.m].inert))
      )
        return emitProto2(g, { ...opts, entry: "node" });
    }
  }
  const inline = suffix.length > 0 && others.length > 0;
  const countsForMain = new Set(inline ? tlaOthers.map(it => it.m) : []);

  if (opts.stats)
    Object.assign(opts.stats, {
      modules: items.length,
      tainted: A.tainted.filter(Boolean).length,
      async: asyncItems.length,
      wrappers: others.length + A.wrapped.filter((w, i) => w && !asyncItems.some(it => it.m === i)).length,
    });
  const needCore = others.length > 0 || A.rec.some(Boolean);
  if (needCore) out.push(CORE);
  if (anyWrapped) out.push(DFS);
  if (opts.chunkOf) out.push(CHUNKS);
  if (inline) out.push(`var __r = ${tlaOthers.length};`, relaxed ? ENTRY_RELAXED : ENTRY_INLINE);
  if (opts.chunkOf) g.mods.forEach((m, i) => out.push(`//@@ ${opts.chunkOf(i)}`, `var v_${m.id};`));
  else out.push(`var ${g.mods.map(m => "v_" + m.id).join(", ")};`);

  const fn = (i, tla) =>
    `${tla ? "async $" : "()"} => {\n  ${lines(i).join("\n  ")}${countsForMain.has(i) ? "\n  __d($);" : ""}\n}`;

  // ---- wrapped modules: definitions only ------------------------------------------------------
  g.mods.forEach((m, i) => {
    if (!A.wrapped[i]) return;
    if (opts.chunkOf) out.push(`//@@ ${opts.chunkOf(i)}`);
    out.push(`// ${m.id} (wrapped)`, `var ns_${m.id} = { get v_${m.id}() { return v_${m.id}; } };`);
    if (A.rec[i]) {
      const deps = m.imports.map(j => (A.rec[j] ? "w_" : "init_") + g.mods[j].id);
      out.push(`var w_${m.id} = __rec(${fn(i, hasTLA(m))}, ${hasTLA(m) ? 1 : 0}, () => [${deps.join(", ")}]);`);
    } else {
      out.push(
        `var init_${m.id} = __esm(() => {\n  ${m.imports.map(j => `init_${g.mods[j].id}();`).join(" ")}\n  ${lines(i).join("\n  ")}\n});`,
      );
    }
  });

  if (opts.chunkOf) out.push(`//@@ m0`);
  if (entryWrapped) {
    out.push(A.tainted[0] ? `await __evaluate(w_m0);` : A.rec[0] ? `__top(w_m0);` : `init_m0();`);
    return out.join("\n") + "\n";
  }

  // ---- flat plan --------------------------------------------------------------------------------
  for (const ev of events) {
    const m = g.mods[ev.m];
    if (ev.k === "call") {
      out.push(A.rec[ev.m] ? `__top(w_${m.id});` : `init_${m.id}();`);
      continue;
    }
    if (inSuffix.has(ev.m)) continue;
    out.push(`// ${m.id}`);
    if (!ev.async) {
      out.push(...lines(ev.m));
      continue;
    }
    const extra = ev.members.length ? `, 0, ${list(ev.members)}` : ev.open ? `, 1` : "";
    out.push(`var ${H(ev.m)} = __node(${fn(ev.m, ev.tla)}, ${ev.tla ? 1 : 0}, ${list(ev.W)}${extra});`);
    if (ev.m === 0) out.push(`await __cap(${H(0)});`);
  }
  suffix.forEach((it, i) => {
    out.push(`// ${g.mods[it.m].id} (main thread)`);
    if (relaxed) {
      if (i === 0) {
        // the entry is the root of its SCC: close it, as its own node would have
        if (entryItem.members.length) out.push(`__node(0, 0, [], 0, ${list(entryItem.members)});`);
        out.push(`await __main();`, `__resume();`);
      }
      // nodes whose order lies between the previous main-thread module and this one run first
      const lo = i ? asyncItems.indexOf(suffix[i - 1]) : -1;
      const between = asyncItems.slice(lo + 1, asyncItems.indexOf(it)).filter(x => !inSuffix.has(x.m));
      if (between.length) out.push(`__upto(${H(between.at(-1).m)});`);
    } else if (i === 0 && others.length) {
      out.push(
        `await __main(${list(it.W.filter(w => !inSuffix.has(w)))}${it.members.length ? ", " + list(it.members) : ""});`,
        `__resume();`,
      );
    }
    out.push(...lines(it.m));
    if (it.tla && i < suffix.length - 1) out.push(`await 0; // the AsyncModuleExecutionFulfilled hop`);
  });
  return out.join("\n") + "\n";
}

// The same program as emitProto2, cut into the files that code splitting would make: one chunk per set of roots (the
// entry point and the import() targets) that reach a module, plus the run-time. Returns { "m0.mjs": ..., ... }.
export function emitSplit(g, opts = {}) {
  const roots = [...new Set([0, ...g.mods.flatMap(m => m.body.filter(a => a.t === "dyn").map(a => a.to))])];
  const reachedFrom = g.mods.map(() => []);
  for (const root of roots) {
    const seen = new Set();
    const walk = i => {
      if (seen.has(i)) return;
      seen.add(i);
      reachedFrom[i].push(root);
      g.mods[i].imports.forEach(walk);
    };
    walk(root);
  }
  // "m0" is the file that is run: the flat plan, or the call that evaluates a wrapped entry point. It awaits, so no
  // chunk may import it: a record that something else can reach is never in it.
  const { wrapped } = analyze(g, opts);
  const chunkOf = i => (wrapped[i] ? "chunk_" + reachedFrom[i].join("_") : "m0");
  const text = { rt: [] };
  let current = text.rt;
  for (const line of emitProto2(g, { ...opts, entry: "node", chunkOf }).split("\n")) {
    if (line.startsWith("//@@ ")) current = text[line.slice(5)] ??= [];
    else current.push(line);
  }
  const globals = new Set(["__log", "__start", "__probe", "__tick", "__sleep", "__chan", "__fire", "__never"]);
  const defined = {};
  for (const [name, lines] of Object.entries(text))
    for (const line of lines) for (const m of line.matchAll(/^var (\w+)/g)) defined[m[1]] = name;
  const files = {};
  for (const [name, lines] of Object.entries(text)) {
    const body = lines.join("\n");
    const imports = {};
    for (const [id] of body.matchAll(/\b(?:__\w+|(?:v|w|n|ns|init)_m\d+)\b/g))
      if (!globals.has(id) && defined[id] && defined[id] !== name) (imports[defined[id]] ??= new Set()).add(id);
    const own = Object.keys(defined).filter(id => defined[id] === name);
    files[name + ".mjs"] =
      Object.entries(imports)
        .map(([from, ids]) => `import { ${[...ids].join(", ")} } from "./${from}.mjs";\n`)
        .join("") +
      body +
      (own.length ? `\nexport { ${own.join(", ")} };\n` : "\n");
  }
  return files;
}

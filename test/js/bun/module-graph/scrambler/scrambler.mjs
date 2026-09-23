// Fixture of module-graph-scrambler.test.ts: N graphs each load a "cell" module (cell.mjs, a byte-identical copy of it, or
// a structurally different variant, which the test writes next to this file). Everything a cell makes checks, every
// time any of its code runs, that Bun.ModuleGraph.current is its home graph. Each scramble takes a value of graph i,
// wraps it in layers owned by other graphs and by the host, and gives it to graph j to use, in one of ~80 ways: call
// forms and hot loops, and j's timers, promises, emitters, streams, files, child processes, servers, workers.
// Meanwhile graphs are disposed mid-flight and replaced, some graphs are made by other graphs' code, and workers run
// the same thing while the host passes a token round them. Invariants: every piece of code runs as its home graph,
// every caller has its own context back after a call, the host never sees a graph as current, no callback is lost
// (unless a disposed graph was involved), and each graph's counter is exactly the number of times its own code ran.
//   bun scrambler.mjs       env: N=6 ROUNDS=300 | SECONDS=60 (soak), SEED, DEPTH=4, HOT=20000, MIX=mixed|same|distinct,
//                                CHURN=1 (dispose a graph mid-batch and recreate it), NEST=1 (some graphs are made by graphs),
//                                WORKERS=k (k worker threads each run a scramble and relay tokens through the host), KILL=1 (terminate
//                                and replace one worker halfway), SKIP=via,via
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { heapStats } from 'bun:jsc'
const env = isMainThread ? process.env : workerData.env
const num = (k, d) => Number(env[k] ?? d)
const N = num('N', 6), ROUNDS = num('ROUNDS', 300), SECONDS = num('SECONDS', 0), SEED0 = num('SEED', 1), DEPTH = num('DEPTH', 4), HOT = num('HOT', 20000)
const MIX = env.MIX ?? 'mixed', CHURN = env.CHURN !== '0', NEST = env.NEST !== '0', WORKERS = isMainThread ? num('WORKERS', 0) : 0, KILL = env.KILL === '1'
const LOST_MS = num('LOST_MS', 4000)   // how long a callback that must run is waited for before it counts as lost
const SKIP = new Set((env.SKIP ?? '').split(',').filter(Boolean)); const WHO = isMainThread ? 'main' : 'worker' + workerData.index
let seed = SEED0; const rnd = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n }; const pick = a => a[rnd(a.length)]
const tick = ms => new Promise(r => setTimeout(r, ms))
const problems = []; const problem = m => { if (problems.length < 25) problems.push(m) }
const server = Bun.serve({ port: 0, fetch(req, s) { if (s.upgrade(req)) return; return new Response('host') }, websocket: { message(ws, m) { ws.send('echo:' + m) } } })
const ctxBase = { url: `http://127.0.0.1:${server.port}/`, wsUrl: `ws://127.0.0.1:${server.port}/` }
const SPECS = ['cell.mjs', 'cell.mjs', 'cell-copy.mjs', 'cell.mjs?v=1', 'cell-variant.mjs', 'cell.mjs', 'cell-variant.mjs', 'cell-copy.mjs?v=2']
let made = 0
const specOf = i => import.meta.dir + '/' + (MIX === 'same' ? 'cell.mjs' : MIX === 'distinct' ? ['cell.mjs', 'cell-copy.mjs', 'cell-variant.mjs'][made % 3] + '?m=' + made : SPECS[(i + made) % SPECS.length])
// ---- slots: slot s holds the current graph of that slot; a slot's graph can be disposed and replaced ------------------
const slots = []            // { graph, cell, gen, parent (slot index or -1), label }
const labels = new Map()    // graph object -> label, including retired ones (a WeakMap would hide a leak; this holds only graph handles of live slots + recent retirees)
const nameOf = g => g === undefined ? 'HOST' : labels.get(g) ?? 'unknown-graph'
const expected = new Map()  // cell namespace -> how many times its own code was asked to bump its state
const retiredLogs = []; let recreated = 0, nested = 0, cancelled = 0, childAlive = 0, childDead = 0
async function fill(s, gen) {
  let graph, cell, parent = -1; const live = slots.map((x, k) => x && k !== s && !x.dead ? k : -1).filter(k => k >= 0)
  if (NEST && live.length && rnd(3) === 0) { parent = pick(live); [graph, cell] = await slots[parent].cell.makeChild(specOf(s)); nested++ }
  else { graph = new Bun.ModuleGraph({ uncaughtException: e => problem(`${WHO} g${s}#${gen} uncaughtException: ${String(e).slice(0, 100)}`) }); cell = await graph.import(specOf(s)) }
  made++; const label = `g${s}#${gen}${parent >= 0 ? `(child of ${slots[parent].label})` : ''}`; labels.set(graph, label)
  cell.setup(label, nameOf); expected.set(cell, 0); slots[s] = { graph, cell, gen, parent, label }
  if (Bun.ModuleGraph.current !== undefined) problem(`${WHO}: host sees ${nameOf(Bun.ModuleGraph.current)} as current after creating ${label}`)
}
function retire(s, checkState) {
  const x = slots[s]; for (const v of x.cell.log.violations) problem(`${WHO} ${x.label}: ${v}`)
  if (checkState && x.cell.state !== expected.get(x.cell)) problem(`${WHO} ${x.label} module state is ${x.cell.state}, expected ${expected.get(x.cell)}`)
  retiredLogs.push([x.label, x.cell.log]); if (retiredLogs.length > 40) retiredLogs.shift(); expected.delete(x.cell)
  const old = x.graph; setTimeout(() => labels.delete(old), 1500)
}
for (let s = 0; s < N; s++) await fill(s, 0)
const hostCheck = where => { if (Bun.ModuleGraph.current !== undefined) problem(`${WHO}: host sees ${nameOf(Bun.ModuleGraph.current)} as current ${where}`) }
const hostWrap = (f, expectedGraph, tainted) => function hostLayer(...a) { const c = Bun.ModuleGraph.current; if (c !== expectedGraph && !tainted()) problem(`${WHO}: host layer expected to run as ${nameOf(expectedGraph)} ran as ${nameOf(c)}`); const r = f.apply(this, a); if (Bun.ModuleGraph.current !== expectedGraph && !tainted()) problem(`${WHO}: host layer: context after inner call is ${nameOf(Bun.ModuleGraph.current)}, expected ${nameOf(expectedGraph)}`); return r }
const WRAPS = ['wrap', 'wrapSpread', 'wrapTry', 'wrapTail', 'wrapTailPlain']
const usage = {}; let ops = 0, lost = 0, hotCalls = 0, hops = 0
let victim = -1, victimDisposed = false
const lineage = s => { const out = new Set(); for (let k = s; k >= 0; k = slots[k].parent) out.add(k); return out }   // a slot and its ancestors
async function scramble(mode) {
  const c0 = slots[0].cell; const vias = Object.keys(c0[mode]).filter(v => !SKIP.has(v))
  const via = pick(vias), j = rnd(N); const hotCur = via.startsWith('hotCur'); const i = hotCur && rnd(2) ? j : rnd(N)
  const kindMap = mode === 'simple' ? c0.simpleKinds : c0.complexKinds
  const kind = Object.hasOwn(kindMap, via) ? kindMap[via] : (mode === 'complex' && rnd(4) === 0 ? 'asyncProbe' : rnd(5) === 0 ? 'bound' : 'probe')
  const involved = new Set([...lineage(i), ...lineage(j)]); const I = slots[i], J = slots[j]
  const tainted = () => victim >= 0 && involved.has(victim)
  let resolveDone; const donePromise = new Promise(r => { resolveDone = r })
  const done = () => { expected.set(I.cell, (expected.get(I.cell) ?? 0) + 1); resolveDone() }
  let value = I.cell.make[kind](done); const label = [`${I.label}.${kind}`]
  if (kind === 'probe' || kind === 'bound' || kind === 'asyncProbe' || kind === 'counter') {
    const layers = rnd(DEPTH + 1); const owners = Array.from({ length: layers }, () => rnd(N + 1) - 1)
    for (let p = 0; p < layers; p++) { const k = owners[p]; const outer = p + 1 < layers ? owners.slice(p + 1).find(o => o !== -1) : undefined
      if (k === -1) { value = hostWrap(value, outer === undefined ? J.graph : slots[outer].graph, tainted); label.push('host') }
      else { for (const a of lineage(k)) involved.add(a); value = slots[k].cell[kind === 'asyncProbe' ? 'wrapAsync' : pick(WRAPS)](value); label.push(slots[k].label) } }
  }
  const ctx = { ...ctxBase, want: I.graph, n: HOT, check: t => { if (t !== 'g' + I.label && !tainted()) problem(`${WHO} ${via}: response "${t}" came from the wrong graph, expected ${I.label}`) } }
  ops++; usage[via] = (usage[via] ?? 0) + 1
  try { const ret = J.cell[mode][via](value, ctx)
    if (kind === 'counter') { expected.set(I.cell, (expected.get(I.cell) ?? 0) + ret); hotCalls += ret; resolveDone() }
    else if (hotCur) { hotCalls += ctx.n; if (ret) problem(`${WHO} ${via}: ${I.label}'s tiny value called hot by ${J.label} ran as the wrong graph ${ret}/${ctx.n} times`); resolveDone() }
  } catch (e) { if (!tainted()) problem(`${WHO} ${label.join('>')} via ${J.label}.${via} threw ${String(e).slice(0, 80)}`); resolveDone() }
  hostCheck(`after ${J.label}.${via}`)
  const r = await Promise.race([donePromise, tick(tainted() ? 250 : LOST_MS).then(() => 'LOST')])
  if (r === 'LOST') { if (tainted()) cancelled++; else { lost++; problem(`${WHO} LOST: ${label.join(' > ')} via ${J.label}.${mode}.${via} never ran`) } }
  hostCheck(`after awaiting ${J.label}.${via}`)
}
// ---- worker mode: one extra graph (never churned) answers relay tokens from the host -----------------------------------
let relayCell, relayed = 0
if (!isMainThread) { const g = new Bun.ModuleGraph({}); relayCell = await g.import(import.meta.dir + '/cell.mjs'); labels.set(g, 'relay'); relayCell.setup('relay', nameOf); relayCell.onPort(parentPort); parentPort.on('message', m => { if (m?.token === true) relayed++ }); parentPort.postMessage({ ready: true }) }
// ---- main: spawn workers and pass tokens around them --------------------------------------------------------------------
const workers = []; const workerResults = []; let relayHops = 0, killed = 0, stopRelay = false
function spawnWorker(index) { const w = new Worker(import.meta.path, { workerData: { index, env: { ...process.env, SEED: String(SEED0 * 1000 + index + killed * 17), WORKERS: '0', N: String(Math.max(3, N - 2)) } } })
  w.on('message', m => { if (m.ready) { if (index === 0 || m.replacement) w.postMessage({ token: true, hop: relayHops }) } else if (m.relay) { relayHops = m.hop; if (!stopRelay) { const next = workers[(workers.indexOf(w) + 1) % workers.length]; setTimeout(() => { try { next.postMessage({ token: true, hop: relayHops }) } catch {} }, 1) } } else if (m.result) workerResults.push(m.result) })
  w.on('error', e => problem(`worker ${index} error: ${String(e).slice(0, 120)}`)); return w }
for (let k = 0; k < WORKERS; k++) workers.push(spawnWorker(k))
// ---- the run ---------------------------------------------------------------------------------------------------------------
const t0 = performance.now(); const samples = []; let lastSample = 0, round = 0
const running = () => SECONDS ? performance.now() - t0 < SECONDS * 1000 : round < ROUNDS
while (running()) {
  victim = -1; victimDisposed = false
  if (CHURN && round % 4 === 3) { victim = rnd(N); const v = slots[victim]; setTimeout(() => { v.dead = true; v.graph.dispose(); victimDisposed = true }, rnd(4)) }     // disposed while the batch below is in flight
  const batch = []; for (let b = 0; b < 6; b++) batch.push(scramble(rnd(3) === 0 ? 'simple' : 'complex'))
  await Promise.all(batch)
  if (victim >= 0) { if (!victimDisposed) { slots[victim].dead = true; slots[victim].graph.dispose() }
    // every descendant of the victim (children, grandchildren, ...): see whether it still works, then replace the whole family
    const family = []; for (let grew = true; grew;) { grew = false; slots.forEach((x, k) => { if (k !== victim && !family.includes(k) && (x.parent === victim || family.includes(x.parent))) { family.push(k); grew = true } }) }
    const alive = await Promise.all(family.map(k => new Promise(res => { let fired = false; try { slots[k].cell.complex.timeout(() => { fired = true }) } catch {} setTimeout(() => res(fired), 30) })))
    alive.forEach(a => a ? childAlive++ : childDead++)
    for (const k of family) { slots[k].dead = true; retire(k, false); slots[k].graph.dispose() }
    retire(victim, false)
    for (const k of [victim, ...family]) { await fill(k, slots[k].gen + 1); recreated++ }
    victim = -1 }
  if (round % 50 === 0) { const a = rnd(N); let b = rnd(N); if (b === a) b = (a + 1) % N; const A = slots[a], B = slots[b]; A.cell.setPeer(B.cell.hopPeer); B.cell.setPeer(A.cell.hopPeer)
    for (const [X, Y] of [[A, B], [B, A]]) for (const n of [1, 4]) { const want = n % 2 ? Y.graph : X.graph; const wrong = X.cell.drivePeer(30000, n, want); hops += 30000 * n; if (wrong) problem(`${WHO} fixed-peer tail call ${X.label}<->${Y.label}, ${n} hop(s): ${wrong}/30000 ended as the wrong graph`) } hostCheck('after drivePeer') }
  if (KILL && isMainThread && workers.length && !killed && (SECONDS ? performance.now() - t0 > SECONDS * 500 : round === ROUNDS >> 1)) { killed = 1; const idx = workers.length - 1; const old = workers[idx]; await old.terminate(); const w = spawnWorker(idx); workers[idx] = w; w.once('message', () => { try { workers[0].postMessage({ token: true, hop: relayHops }) } catch {} }) }
  if (round % 100 === 99) Bun.gc(true)
  if (env.PROGRESS && round % 20 === 0) console.error(`[${WHO}] round ${round} ${Math.round(performance.now() - t0)}ms recreated=${recreated} cancelled=${cancelled}`)
  const sec = Math.floor((performance.now() - t0) / 1000); if (SECONDS && sec >= lastSample + 10) { lastSample = sec; Bun.gc(true); Bun.gc(true); const h = heapStats(); samples.push(`${sec}s rss=${Math.round(process.memoryUsage().rss / 1048576)}MB objs=${Math.round(h.objectCount / 1000)}k graphs=${h.objectTypeCounts.ModuleGraph ?? 0}`) }
  round++
}
await tick(60)
for (let s = 0; s < N; s++) { const x = slots[s]; for (const v of x.cell.log.violations) problem(`${WHO} ${x.label}: ${v}`); if (x.cell.state !== expected.get(x.cell)) problem(`${WHO} ${x.label} module state is ${x.cell.state}, expected ${expected.get(x.cell)} (only its own code may change it)`) }
for (const [label, log] of retiredLogs) for (const v of log.violations) problem(`${WHO} retired ${label}: ${v}`)
if (relayCell) { for (const v of relayCell.log.violations) problem(`${WHO} relay: ${v}`); if (relayCell.state !== relayed) problem(`${WHO} relay graph handled ${relayCell.state} tokens, host saw ${relayed}`) }
const calls = slots.reduce((t, x) => t + x.cell.log.calls, 0)
const line = `${problems.length ? 'FAIL' : 'PASS'} ${WHO} seed=${SEED0} mix=${MIX} churn=${CHURN} nest=${NEST} graphs=${N} made=${made} nested=${nested} recreated=${recreated} scrambles=${ops} context-checks(live)=${calls} hot-calls=${hotCalls} tail-hops=${hops} cancelled-by-dispose=${cancelled} lost=${lost} children-after-parent-dispose: alive=${childAlive} dead=${childDead}${relayCell ? ` relayed=${relayed}` : ''} ms=${Math.round(performance.now() - t0)}`
if (!isMainThread) { parentPort.postMessage({ result: { line, problems } }); server.stop(true); await tick(20); process.exit(0) }
stopRelay = true; const deadline = performance.now() + 120000; while (workerResults.length < WORKERS && performance.now() < deadline) await tick(100)
console.log(line); for (const p of problems) console.log('  ' + p)
for (const r of workerResults) { console.log('  ' + r.line); for (const p of r.problems) console.log('    ' + p) }
if (WORKERS) console.log(`  workers=${WORKERS} results=${workerResults.length} relay-hops=${relayHops} killed-and-replaced=${killed}`)
if (WORKERS && workerResults.length < WORKERS - killed) console.log('  MISSING worker results')
for (const s of samples) console.log('  ' + s)
if (process.env.USAGE) console.log('  ways used:', Object.entries(usage).map(([k, v]) => `${k}:${v}`).join(' '))
const bad = problems.length || workerResults.some(r => r.problems.length)
for (const w of workers) w.terminate(); server.stop(true); process.exit(bad ? 1 : 0)

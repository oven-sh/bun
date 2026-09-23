// Fixture of module-graph-scrambler.test.ts. One cell per graph. Everything a cell makes checks, every time any of its code runs, that it runs as its home graph.
import fs from 'node:fs'; import http from 'node:http'; import zlib from 'node:zlib'; import crypto from 'node:crypto'; import dns from 'node:dns'
import child_process from 'node:child_process'; import { EventEmitter } from 'node:events'; import { Readable } from 'node:stream'
import { AsyncResource, AsyncLocalStorage } from 'node:async_hooks'; import { MessageChannel, Worker } from 'node:worker_threads'
import timersP from 'node:timers/promises'; import { PerformanceObserver, performance } from 'node:perf_hooks'
const cur = () => Bun.ModuleGraph.current
let home, id, nameOf
export const log = { calls: 0, violations: [] }
const bad = m => { if (log.violations.length < 12) log.violations.push(m) }
const here = what => { log.calls++; const c = cur(); if (c !== home) bad(`${what} [home g${id}] ran as ${nameOf(c)}`) }
export const setup = (i, names) => { id = i; home = cur(); nameOf = names }
export let state = 0
const store = new Map(); const als = new AsyncLocalStorage(); const emitter = new EventEmitter(); emitter.setMaxListeners(0)

// ---- values this graph hands out -------------------------------------------------------------------------------
export const make = {
  probe: done => function probe() { here('probe'); state++; done(id); return id },
  tinyCur: () => (a, b) => Bun.ModuleGraph.current,                                   // small enough to inline; reports who it ran as
  tinyCtor: () => class Tiny { constructor(a, b) { this.c = Bun.ModuleGraph.current } },
  counter: () => function counter() { here('counter'); state++; return id },
  bound: done => make.probe(done).bind({ tag: 'bound-this' }, 'pre'),
  asyncProbe: done => async function asyncProbe() { here('async:start'); await null; here('async:after-await'); await new Promise(r => setTimeout(r, 0)); here('async:after-timer'); await new Promise(r => process.nextTick(r)); here('async:after-tick'); state++; done(id); return id },
  genFn: done => function* gen() { here('gen:start'); yield id; here('gen:resumed'); try { yield id } finally { here('gen:finally'); state++; done(id) } },
  asyncGenFn: done => async function* agen() { here('agen:start'); yield id; await null; here('agen:after-await'); state++; done(id) },
  klass: done => class Cell { static made = 0; field = (here('class:field'), id); constructor() { here('class:ctor'); Cell.made++ } method() { here('class:method'); state++; done(id); return id } get g() { here('class:getter'); return id } static s() { here('class:static'); return id } },
  thenable: done => ({ then(res) { here('thenable.then'); state++; done(id); res(id) } }),
  proxy: done => new Proxy(function () {}, { apply() { here('proxy.apply'); state++; done(id); return id }, get(t, k) { if (k === 'then' || typeof k === 'symbol') return undefined; here('proxy.get'); return id }, construct() { here('proxy.construct'); return { made: id } } }),
  httpHandler: done => function handler(req, res) { here('httpHandler'); state++; res.end('g' + id); done(id) },
  fetchHandler: done => function fetchHandler(req) { here('fetchHandler'); state++; done(id); return new Response('g' + id) },
}
// ---- layers another graph's value can be wrapped in ------------------------------------------------------------
export const wrap = f => function wrapped(...a) { here('wrap:in'); const r = f.apply(this, a); here('wrap:out'); return r }
export const wrapSpread = f => (...a) => { here('wrapSpread:in'); const r = f(...a); here('wrapSpread:out'); return r }
export const wrapAsync = f => async function (...a) { here('wrapAsync:in'); const r = await f(...a); here('wrapAsync:out'); return r }
export const wrapTail = f => function tail() { here('wrapTail:in'); return f.apply(this, arguments) }          // strict tail call, varargs
export const wrapTailPlain = f => (a, b) => { here('wrapTailPlain:in'); return f(a, b) }                       // strict tail call
export const wrapTry = f => (...a) => { here('wrapTry:in'); try { return f(...a) } finally { here('wrapTry:finally') } }
// ---- simple ways of using a foreign value ----------------------------------------------------------------------
const after = what => here('via.' + what + ':after')
export const simple = {
  direct: f => { f(); after('direct') },
  call: f => { f.call(null, 1); after('call') },
  apply: f => { f.apply(null, [1, 2]); after('apply') },
  spread: f => { f(...[1, 2, 3]); after('spread') },
  reflectApply: f => { Reflect.apply(f, null, []); after('reflectApply') },
  optional: f => { f?.(); after('optional') },
  map: f => { [1].map(f); after('map') },
  forEach: f => { [1].forEach(f); after('forEach') },
  sort: f => { let n = 0; [2, 1].sort((a, b) => { if (!n++) f(); return a - b }); after('sort') },
  reduce: f => { [1].reduce(f, 0); after('reduce') },
  toJSON: f => { JSON.stringify({ toJSON: f }); after('toJSON') },
  getter: f => { const o = {}; Object.defineProperty(o, 'x', { get: f }); void o.x; after('getter') },
  setter: f => { const o = {}; Object.defineProperty(o, 'x', { set: f }); o.x = 1; after('setter') },
  valueOf: f => { void ({ valueOf: f } + 1); after('valueOf') },
  tagged: f => { f`a${1}b`; after('tagged') },
  replace: f => { 'a'.replace(/a/, f); after('replace') },
  stored: f => { store.set('k', f); store.get('k')(); after('stored') },
  tryFinally: f => { try { f() } finally { after('tryFinally') } },
  bindAgain: f => { f.bind(null)(); after('bindAgain') },
  hotCurPlain: (f, ctx) => { let w = 0; for (let i = 0; i < ctx.n; i++) if (f(i, 1) !== ctx.want) w++; after('hotCurPlain'); return w },
  hotCurSpread: (f, ctx) => { const g = (...a) => f(...a); let w = 0; for (let i = 0; i < ctx.n; i++) if (g(i, 1) !== ctx.want) w++; after('hotCurSpread'); return w },
  hotCurApply: (f, ctx) => { function g() { return f.apply(null, arguments) } let w = 0; for (let i = 0; i < ctx.n; i++) if (g(i, 1) !== ctx.want) w++; after('hotCurApply'); return w },
  hotCurReflect: (f, ctx) => { let w = 0; for (let i = 0; i < ctx.n; i++) if (Reflect.apply(f, null, [i, 1]) !== ctx.want) w++; after('hotCurReflect'); return w },
  hotCurNewSpread: (K, ctx) => { const a = [1, 2]; let w = 0; for (let i = 0; i < ctx.n; i++) if (new K(...a).c !== ctx.want) w++; after('hotCurNewSpread'); return w },
  hotLoop: f => { let n = 0; for (let i = 0; i < 3000; i++) { f(); n++ } after('hotLoop'); return n },
  hotSpread: f => { const a = [1, 2]; let n = 0; for (let i = 0; i < 3000; i++) { f(...a); n++ } after('hotSpread'); return n },
  hotApply: f => { let n = 0; for (let i = 0; i < 3000; i++) { f.apply(null, [i]); n++ } after('hotApply'); return n },
  hotReflect: f => { let n = 0; for (let i = 0; i < 3000; i++) { Reflect.apply(f, null, [i]); n++ } after('hotReflect'); return n },
  useClass: K => { const o = new K(); void o.g; K.s(); o.method(); after('useClass') },
  subclass: K => { class Sub extends K { constructor() { super(); here('sub:ctor') } method() { here('sub:method'); return super.method() } } new Sub().method(); after('subclass') },
  reflectConstruct: K => { Reflect.construct(K, []).method(); after('reflectConstruct') },
  adoptProto: K => { const o = { mine: true }; Object.setPrototypeOf(o, K.prototype); o.method(); after('adoptProto') },
  useGen: g => { const it = g(); it.next(); it.next(); it.return(); after('useGen') },
  spreadGen: g => { const it = g(); const [a] = it; it.return?.(); void a; const it2 = g(); it2.next(); it2.next(); it2.next(); after('spreadGen') },
  useProxy: p => { void p.anything; p(); after('useProxy') },
}
// ---- complex ways: this graph's async, I/O and callback machinery runs the foreign value ------------------------
export const complex = {
  timeout: f => { setTimeout(f, 0) },
  timeoutArgs: f => { setTimeout(f, 1, 'a', 'b') },
  interval: f => { const t = setInterval(() => { clearInterval(t); after('interval:cb-before'); f(); after('interval') }, 1) },
  immediate: f => { setImmediate(f) },
  nextTick: f => { process.nextTick(f, 1, 2) },
  microtask: f => { queueMicrotask(f) },
  promiseThen: f => { Promise.resolve(1).then(f) },
  promiseFinally: f => { Promise.reject(new Error('x')).finally(f).catch(() => { after('promiseFinally') }) },
  awaitIt: f => { (async () => { await f(); after('awaitIt') })() },
  promiseAll: f => { Promise.all([1, 2].map(async () => null)).then(f) },
  timersPromises: f => { timersP.setTimeout(1).then(f) },
  timersPromisesImmediate: f => { timersP.setImmediate().then(f) },
  bunSleep: f => { Bun.sleep(1).then(f) },
  emitterNow: f => { const e = new EventEmitter(); e.once('x', f); e.emit('x', 1) },
  emitterLater: f => { emitter.once('later', f); setTimeout(() => emitter.emit('later', 1), 0) },
  eventTarget: f => { const t = new EventTarget(); t.addEventListener('x', f, { once: true }); t.dispatchEvent(new Event('x')) },
  abortSignal: f => { const ac = new AbortController(); ac.signal.addEventListener('abort', f); setTimeout(() => ac.abort(), 0) },
  abortTimeout: f => { AbortSignal.timeout(1).addEventListener('abort', f) },
  streamData: f => { Readable.from(['chunk']).on('data', f) },
  streamEnd: f => { Readable.from(['chunk']).on('data', () => {}).on('end', f) },
  fsReadFile: f => { fs.readFile(import.meta.path, f) },
  fsPromises: f => { fs.promises.readFile(import.meta.path).then(f) },
  fsStat: f => { fs.stat(import.meta.path, f) },
  bunFile: f => { Bun.file(import.meta.path).text().then(f) },
  zlibGzip: f => { zlib.gzip('payload', f) },
  cryptoRandom: f => { crypto.randomBytes(8, f) },
  cryptoPbkdf2: f => { crypto.pbkdf2('p', 's', 10, 8, 'sha256', f) },
  dnsLookup: f => { dns.lookup('localhost', f) },
  childExec: f => { child_process.execFile(process.execPath, ['-e', ''], f) },
  childExit: f => { child_process.spawn(process.execPath, ['-e', '']).on('exit', f) },
  bunSpawn: f => { Bun.spawn([process.execPath, '-e', ''], { stdout: 'ignore', stderr: 'ignore' }).exited.then(f) },
  fetchThen: (f, ctx) => { fetch(ctx.url).then(r => r.text()).then(f) },
  httpGet: (f, ctx) => { http.get(ctx.url, res => { res.resume(); res.on('end', f) }).on('error', () => {}) },
  asyncResource: f => { const r = new AsyncResource('scramble'); setTimeout(() => { r.runInAsyncScope(f); after('asyncResource') }, 0) },
  alsRun: f => { als.run({ id }, f); after('alsRun') },
  alsBind: f => { setTimeout(AsyncLocalStorage.bind(f), 0) },
  alsSnapshot: f => { const run = als.run({ id }, () => AsyncLocalStorage.snapshot()); setTimeout(() => run(f), 0) },
  messageChannel: f => { const mc = new MessageChannel(); mc.port1.on('message', m => { mc.port1.close(); f(m) }); mc.port2.postMessage('hi') },
  perfObserver: f => { const o = new PerformanceObserver(() => { o.disconnect(); f() }); o.observe({ entryTypes: ['mark'] }); performance.mark('scramble-' + id) },
  worker: f => { const w = new Worker('require("node:worker_threads").parentPort.postMessage(1)', { eval: true }); w.on('message', m => { w.terminate(); f(m) }) },
  forAwait: g => { (async () => { for await (const v of g()) void v; after('forAwait') })() },
  awaitThenable: t => { (async () => { await t; after('awaitThenable') })() },
  thenableInAll: t => { Promise.all([t, 1]).then(() => after('thenableInAll')) },
  httpServer: (h, ctx) => { const s = http.createServer(h); s.listen(0, '127.0.0.1', () => { fetch(`http://127.0.0.1:${s.address().port}/`).then(r => r.text()).then(t => { s.close(); after('httpServer'); ctx.check(t) }) }) },
  bunServe: (h, ctx) => { const s = Bun.serve({ port: 0, fetch: h }); fetch(`http://127.0.0.1:${s.port}/`).then(r => r.text()).then(t => { s.stop(true); after('bunServe'); ctx.check(t) }) },
  webSocket: (f, ctx) => { const ws = new WebSocket(ctx.wsUrl); ws.onopen = () => ws.send('x'); ws.onmessage = m => { ws.close(); f(m) } },
}
export const complexKinds = { forAwait: 'asyncGenFn', awaitThenable: 'thenable', thenableInAll: 'thenable', httpServer: 'httpHandler', bunServe: 'fetchHandler' }
export const simpleKinds = { hotCurPlain: 'tinyCur', hotCurSpread: 'tinyCur', hotCurApply: 'tinyCur', hotCurReflect: 'tinyCur', hotCurNewSpread: 'tinyCtor', hotLoop: 'counter', hotSpread: 'counter', hotApply: 'counter', hotReflect: 'counter', useClass: 'klass', subclass: 'klass', reflectConstruct: 'klass', adoptProto: 'klass', useGen: 'genFn', spreadGen: 'genFn', useProxy: 'proxy' }
export const armForDispose = f => { setTimeout(f, 30); setInterval(f, 30) }          // must never fire once this graph is disposed
// the same function in every graph, tail-calling the next graph's copy of itself
export function hopTail(n, peers) { here('hopTail'); if (n === 0) return id; return peers[n % peers.length](n - 1, peers) }
export const hotHop = (peers, reps, want) => { let wrong = 0; for (let r = 0; r < reps; r++) if (hopTail(7, peers) !== want) wrong++; after('hotHop'); return wrong }
// a fixed peer and a tiny body: the shape an optimizing compiler turns into a jump when the peer is a copy of this same function
export let peer
export const setPeer = p => { peer = p }
export function hopPeer(n) { if (n === 0) return Bun.ModuleGraph.current; return peer(n - 1) }
export const drivePeer = (reps, n, want) => { let wrong = 0; for (let r = 0; r < reps; r++) if (hopPeer(n) !== want) wrong++; after('drivePeer'); return wrong }
// a graph made by this graph's code
export const makeChild = async spec => { here('makeChild'); const g = new Bun.ModuleGraph({ onError() {} }); const c = await g.import(spec); here('makeChild:after-import'); return [g, c] }
// this graph answers tokens arriving on a port the host hands it (a Worker's parentPort)
export const onPort = port => { port.on('message', m => { if (!m || m.token !== true) return; here('port-message'); state++; port.postMessage({ relay: true, from: id, hop: m.hop + 1 }) }) }
export const ping = () => { here('ping'); return id }
